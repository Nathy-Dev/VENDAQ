import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { SocketManager } from './SocketManager';
import { BackendService } from './BackendService';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3005;
const SESSIONS_DIR = process.env.SESSIONS_PATH || path.join(__dirname, '../sessions');

// Initialize SocketManager
SocketManager.init(SESSIONS_DIR);

// --- Basic Endpoints ---

app.get('/', (req, res) => {
    res.json({ status: 'active', service: 'wa-worker', version: '2.0.0' });
});

// Start a session
app.post('/session/start', async (req, res) => {
    const { businessId } = req.body;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    
    if (SocketManager.getSocket(businessId)) {
        return res.json({ success: true, message: 'Session already active' });
    }
    
    try {
        await SocketManager.startSession(businessId);
        res.json({ success: true, message: `Session starting for ${businessId}` });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Pairing code request
app.post("/pairing/request", async (req, res) => {
    const { businessId, phone } = req.body;
    if (!businessId || !phone) return res.status(400).json({ error: "Missing businessId or phone" });
    const phoneDigits = String(phone).replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        return res.status(400).json({ error: "Invalid phone format. Use country code + number (digits only)." });
    }

    await SocketManager.closeSession(businessId);

    try {
        await SocketManager.startSession(businessId, phone);
        const sock = SocketManager.getSocket(businessId);
        if (!sock) {
            throw new Error("WhatsApp socket unavailable for pairing request.");
        }
        await waitForSocketReady(sock);
        let code = "";
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (sock.authState?.creds?.registered) {
                    throw new Error("This WhatsApp session is already registered. Disconnect first, then retry pairing.");
                }
                code = await sock.requestPairingCode(phoneDigits);
                break;
            } catch (error) {
                lastError = error;
                if (attempt < 3) {
                    await new Promise((r) => setTimeout(r, 1200 * attempt));
                }
            }
        }
        if (!code) {
            throw lastError || new Error("Failed to generate pairing code.");
        }
        
        await BackendService.updatePairingCode(businessId, code);
        res.json({ success: true, code });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

async function waitForSocketReady(sock: any, timeoutMs: number = 12000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (sock?.ws?.readyState === 1) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("WhatsApp socket not ready for pairing request. Please retry.");
}

// --- Message Operations ---

app.post('/message/send', async (req, res) => {
    const { businessId, to, content } = req.body;
    if (!businessId || !to || !content) return res.status(400).json({ error: 'Missing parameters' });
    
    const adapter = SocketManager.getAdapter(businessId);
    if (!adapter) return res.status(404).json({ error: 'No active session' });
    
    try {
        SocketManager.enqueueTask(businessId, async () => {
            await adapter.sendMessage(to, content);
        });
        
        res.json({ success: true, queued: true });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// --- Chat States & Modification ---

app.post('/presence/update', async (req, res) => {
    const { businessId, to, state } = req.body; // state: 'composing' | 'recording' | 'paused'
    if (!businessId || !to || !state) return res.status(400).json({ error: 'Missing parameters' });

    const sock = SocketManager.getSocket(businessId);
    if (!sock) return res.status(404).json({ error: 'No active session' });

    try {
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendPresenceUpdate(state, jid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

app.post('/chat/modify', async (req, res) => {
    const { businessId, to, action } = req.body; // action: 'archive' | 'unarchive' | 'mute' | 'unmute' | 'delete'
    if (!businessId || !to || !action) return res.status(400).json({ error: 'Missing parameters' });

    const sock = SocketManager.getSocket(businessId);
    if (!sock) return res.status(404).json({ error: 'No active session' });

    try {
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        
        if (action === 'archive') {
            await sock.chatModify({ archive: true }, jid);
        } else if (action === 'unarchive') {
            await sock.chatModify({ archive: false }, jid);
        } else if (action === 'mute') {
            // Mute for 8 hours by default if not specified
            await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid);
        } else if (action === 'unmute') {
            await sock.chatModify({ mute: null }, jid);
        } else if (action === 'delete') {
            await sock.chatModify({ delete: true }, jid);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// --- Initialization ---

const server = http.createServer(app);

async function initWorker() {
    console.log("[Worker] Initializing, fetching connected businesses...");
    try {
        const businesses = await BackendService.getConnectedBusinesses();
        for (const business of businesses) {
            console.log(`[Worker] Auto-starting session for ${business._id}`);
            SocketManager.startSession(business._id).catch(console.error);
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {
        console.error("[Worker] Initialization failed", e);
    }
}

server.listen(PORT, () => {
    console.log(`WhatsApp Worker running on port ${PORT}`);
    initWorker();
});
