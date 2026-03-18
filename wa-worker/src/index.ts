import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { makeWASocket, useMultiFileAuthState as getMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3005;
const SESSIONS_DIR = process.env.SESSIONS_PATH || path.join(__dirname, '../sessions');

// Health Check for Render/Fly.io
app.get('/', (req, res) => {
    res.json({ status: 'active', service: 'wa-worker' });
});
// The Convex HTTP actions endpoint format: <CONVEX_URL>/api/mutation_name
// Since we don't have HTTP actions setup yet, we will use a workaround or we need to setup HTTP actions in Convex.
// Wait, Convex mutations can be called directly if we use the convex client, but in a raw node script it's easier to use fetch with HTTP Actions.
// Let's actually create the fetch calls to a standard Next.js API route as a proxy, OR set up Convex HTTP actions. 
// Actually, setting up Convex HTTP actions is best practices for external webhooks. Let's use a placeholder URL for now and we will create a Next.js API route to proxy to Convex.
// Wait, the client is already running on localhost:3000. It's much easier to just create an API route in Next.js.
const NEXT_JS_URL = process.env.NEXT_JS_URL || 'http://localhost:3000/api/worker';

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Store active sockets in memory
const activeSockets: Record<string, any> = {};

// Helper to update backend
async function updateBackend(body: any) {
    try {
        const response = await fetch(NEXT_JS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Worker DEBUG] Failed to sync ${body.action} with backend. Status: ${response.status}`, errorText);
        } else {
            console.log(`[Worker DEBUG] Successfully synced ${body.action} with backend.`);
        }
    } catch (e: any) {
        console.error('[Worker DEBUG] Failed to connect to backend:', e.message);
    }
}

async function startSession(businessId: string) {
    console.log(`[Worker] Starting session for business: ${businessId}`);
    
    // Path for this specific business's auth state
    const sessionPath = path.join(SESSIONS_DIR, `session-${businessId}`);
    
    const { state, saveCreds } = await getMultiFileAuthState(sessionPath);
    
    // Fetch the latest version to avoid 405 errors
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Worker] Using WhatsApp Web version: ${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'info' }) as any, // Re-enabled logs for debugging
        browser: ["VENDAQ", "Chrome", "114.0.5735.199"]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log(`[Worker] New QR generated for business: ${businessId}`);
            // Render in terminal for testing
            qrcode.generate(qr, { small: true });
            
            // Post QR to backend
            await updateBackend({
                action: 'updateQRCode',
                businessId,
                qrCodeString: qr
            });
        }
        
        if (connection === 'close') {
            const errorReason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = errorReason !== DisconnectReason.loggedOut;
            console.log(`[Worker] Connection closed for ${businessId}: ${shouldReconnect ? 'reconnecting' : 'logged out'}, Reason: ${errorReason}`);
            console.error("[Worker Baileys Error]:", lastDisconnect?.error);
            
            delete activeSockets[businessId];
            
            // Force delete corrupted session on 401 or 500 errors to prevent infinite loops
            if (errorReason === 401 || errorReason === 500 || errorReason === 440) {
                 console.log(`[Worker] Destroying corrupted session folder for ${businessId}`);
                 fs.rmSync(sessionPath, { recursive: true, force: true });
            }

            // Reconnect if not explicitly logged out
            if (shouldReconnect) {
                setTimeout(() => startSession(businessId), 5000);
            } else {
                // Update backend to disconnected
                await updateBackend({
                    action: 'updateStatus',
                    businessId,
                    status: 'disconnected'
                });

                // Clean up session files if logged out to force re-scan
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`[Worker] Deleted session files for ${businessId}`);
            }
        } else if (connection === 'open') {
            console.log(`[Worker] Connection opened for business: ${businessId}`);
            // Update backend to connected
            await updateBackend({
                action: 'updateStatus',
                businessId,
                status: 'connected'
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle historical sync (like WhatsApp Web)
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
        console.log(`[Worker DEBUG] Received history sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages`);
        
        if (chats.length === 0) {
            console.log(`[Worker DEBUG] No chats found in history sync.`);
        } else {
            console.log(`[Worker DEBUG] First chat raw sample:`, JSON.stringify(chats[0]).substring(0, 200));
        }

        if (messages.length > 0) {
            console.log(`[Worker DEBUG] First message raw sample:`, JSON.stringify(messages[0]).substring(0, 200));
        }
        
        const syncData: any[] = [];
        const contactMap = new Map();
        contacts.forEach(c => contactMap.set(c.id, c.name || c.verifiedName || c.publicName));

        // Process each chat to find its last message
        for (const chat of chats) {
            const remoteJid = chat.id;
            if (remoteJid.endsWith('@g.us')) continue; // Skip groups for now
            
            const sender = remoteJid.split('@')[0];
            const name = contactMap.get(remoteJid) || chat.name;
            
            // Find the latest message for this chat in the synced messages
            const chatMessages = messages.filter(m => m.key.remoteJid === remoteJid);
            const latestMsg = chatMessages.length > 0 
                ? chatMessages[chatMessages.length - 1] 
                : null;
            
            let content = "";
            let timestamp = Date.now();
            let fromMe = false;

            if (latestMsg) {
                content = latestMsg.message?.conversation || 
                          latestMsg.message?.extendedTextMessage?.text || 
                          latestMsg.message?.imageMessage?.caption || 
                          "[Media/Other]";
                timestamp = (latestMsg.messageTimestamp as number) * 1000 || Date.now();
                fromMe = !!latestMsg.key.fromMe;
            } else if (chat.lastMessageRecvTimestamp) {
                // Fallback if no message content but we have a timestamp
                content = "Existing conversation";
                timestamp = (chat.lastMessageRecvTimestamp as number) * 1000;
            } else {
                continue; // No useful data for this chat
            }

            console.log(`[Worker DEBUG] Found ${latestMsg ? 'real message' : 'timestamp fallback'} for chat ${sender}`);
            syncData.push({
                sender,
                content,
                timestamp,
                fromMe,
                name
            });
        }

        console.log(`[Worker DEBUG] Total chats processed: ${chats.length}, Valid sync entries: ${syncData.length}`);

        if (syncData.length > 0) {
            console.log(`[Worker] Sending ${syncData.length} historical chat entries to backend`);
            // Send in chunks of 25 to avoid payload limits
            for (let i = 0; i < syncData.length; i += 25) {
                const chunk = syncData.slice(i, i + 25);
                await updateBackend({
                    action: 'syncHistory',
                    businessId,
                    history: chunk
                });
            }
        }
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        
        for (const msg of m.messages) {
           // Skip if no message content or if it's a protocol message
           const content = msg.message?.conversation || 
                          msg.message?.extendedTextMessage?.text || 
                          msg.message?.imageMessage?.caption;
                          
           if (!content) continue;

           const sender = msg.key.remoteJid?.split('@')[0] || "unknown";
           const isGroup = msg.key.remoteJid?.endsWith('@g.us');
           
           if (isGroup) continue; // Skip group messages for now

           console.log(`[Worker] New message from ${sender}: ${content.substring(0, 30)}...`);

           // Forward to backend
           await updateBackend({
               action: 'newMessage',
               businessId,
               sender,
               content,
               timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
               fromMe: msg.key.fromMe
           });
        }
    });

    activeSockets[businessId] = sock;

    return { success: true, message: `Session starting for ${businessId}` };
}


// --- API Endpoints ---

// Start or retrieve a session for a business
app.post('/session/start', async (req, res) => {
    const { businessId } = req.body;
    
    if (!businessId) {
        return res.status(400).json({ error: 'businessId is required' });
    }
    
    if (activeSockets[businessId]) {
        return res.json({ success: true, message: 'Session already active' });
    }
    
    try {
        const result = await startSession(businessId);
        res.json(result);
    } catch (error: any) {
        console.error(`[Worker] Error starting session for ${businessId}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Check status of a session
app.get('/session/status/:businessId', (req, res) => {
    const { businessId } = req.params;
    const isActive = !!activeSockets[businessId];
    res.json({ businessId, active: isActive });
});

import http from 'http';

const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`WhatsApp Worker running on port ${PORT}`);
});

// Force event loop to stay alive (Wait workaround for Node 24 / ts-node clean exit issue)
setInterval(() => {
   // Keep alive
}, 1000 * 60 * 60);
