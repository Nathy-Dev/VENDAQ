"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const SocketManager_1 = require("./SocketManager");
const BackendService_1 = require("./BackendService");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const PORT = process.env.PORT || 3005;
const SESSIONS_DIR = process.env.SESSIONS_PATH || path_1.default.join(__dirname, '../sessions');
// Initialize SocketManager
SocketManager_1.SocketManager.init(SESSIONS_DIR);
// --- Basic Endpoints ---
app.get('/', (req, res) => {
    res.json({ status: 'active', service: 'wa-worker', version: '2.0.0' });
});
// Start a session
app.post('/session/start', async (req, res) => {
    const { businessId } = req.body;
    if (!businessId)
        return res.status(400).json({ error: 'businessId required' });
    if (SocketManager_1.SocketManager.getSocket(businessId)) {
        return res.json({ success: true, message: 'Session already active' });
    }
    try {
        await SocketManager_1.SocketManager.startSession(businessId);
        res.json({ success: true, message: `Session starting for ${businessId}` });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// Pairing code request
app.post("/pairing/request", async (req, res) => {
    const { businessId, phone } = req.body;
    if (!businessId || !phone)
        return res.status(400).json({ error: "Missing businessId or phone" });
    const phoneDigits = String(phone).replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        return res.status(400).json({ error: "Invalid phone format. Use country code + number (digits only)." });
    }
    await SocketManager_1.SocketManager.closeSession(businessId);
    try {
        await SocketManager_1.SocketManager.startSession(businessId, phone);
        const sock = SocketManager_1.SocketManager.getSocket(businessId);
        if (!sock) {
            throw new Error("WhatsApp socket unavailable for pairing request.");
        }
        await waitForSocketReady(sock);
        let code = "";
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (sock.authState?.creds?.registered) {
                    throw new Error("This WhatsApp session is already registered. Disconnect first, then retry pairing.");
                }
                code = await sock.requestPairingCode(phoneDigits);
                break;
            }
            catch (error) {
                lastError = error;
                if (attempt < 3) {
                    await new Promise((r) => setTimeout(r, 1200 * attempt));
                }
            }
        }
        if (!code) {
            throw lastError || new Error("Failed to generate pairing code.");
        }
        await BackendService_1.BackendService.updatePairingCode(businessId, code);
        res.json({ success: true, code });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
async function waitForSocketReady(sock, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (sock?.ws?.readyState === 1)
            return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("WhatsApp socket not ready for pairing request. Please retry.");
}
// --- Message Operations ---
app.post('/message/send', async (req, res) => {
    const { businessId, to, content } = req.body;
    if (!businessId || !to || !content)
        return res.status(400).json({ error: 'Missing parameters' });
    const adapter = SocketManager_1.SocketManager.getAdapter(businessId);
    if (!adapter)
        return res.status(404).json({ error: 'No active session' });
    try {
        SocketManager_1.SocketManager.enqueueTask(businessId, async () => {
            await adapter.sendMessage(to, content);
        });
        res.json({ success: true, queued: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// --- Chat States & Modification ---
app.post('/presence/update', async (req, res) => {
    const { businessId, to, state } = req.body; // state: 'composing' | 'recording' | 'paused'
    if (!businessId || !to || !state)
        return res.status(400).json({ error: 'Missing parameters' });
    const sock = SocketManager_1.SocketManager.getSocket(businessId);
    if (!sock)
        return res.status(404).json({ error: 'No active session' });
    try {
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendPresenceUpdate(state, jid);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
app.post('/chat/modify', async (req, res) => {
    const { businessId, to, action } = req.body; // action: 'archive' | 'unarchive' | 'mute' | 'unmute' | 'delete'
    if (!businessId || !to || !action)
        return res.status(400).json({ error: 'Missing parameters' });
    const sock = SocketManager_1.SocketManager.getSocket(businessId);
    if (!sock)
        return res.status(404).json({ error: 'No active session' });
    try {
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        if (action === 'archive') {
            await sock.chatModify({ archive: true }, jid);
        }
        else if (action === 'unarchive') {
            await sock.chatModify({ archive: false }, jid);
        }
        else if (action === 'mute') {
            // Mute for 8 hours by default if not specified
            await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid);
        }
        else if (action === 'unmute') {
            await sock.chatModify({ mute: null }, jid);
        }
        else if (action === 'delete') {
            await sock.chatModify({ delete: true }, jid);
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: String(error) });
    }
});
// --- Initialization ---
const server = http_1.default.createServer(app);
async function initWorker() {
    console.log("[Worker] Initializing, fetching connected businesses...");
    try {
        const businesses = await BackendService_1.BackendService.getConnectedBusinesses();
        for (const business of businesses) {
            console.log(`[Worker] Auto-starting session for ${business._id}`);
            SocketManager_1.SocketManager.startSession(business._id).catch(console.error);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    catch (e) {
        console.error("[Worker] Initialization failed", e);
    }
}
server.listen(PORT, () => {
    console.log(`WhatsApp Worker running on port ${PORT}`);
    initWorker();
});
