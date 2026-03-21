import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { 
    makeWASocket, 
    useMultiFileAuthState as getMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    proto
} from '@whiskeysockets/baileys';
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
// Configuration for Backend (Direct Convex HTTP Actions or Next.js Proxy)
// The Convex HTTP actions endpoint format: https://<deployment-name>.convex.site/api/worker
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || 'https://original-sparrow-842.eu-west-1.convex.site';
const NEXT_JS_URL = process.env.NEXT_JS_URL || 'http://localhost:3000/api/worker';

const BACKEND_URL = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT 
    ? `${CONVEX_SITE_URL}/api/worker` 
    : NEXT_JS_URL;

console.log(`[Worker] Using backend for sync: ${BACKEND_URL}`);

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Store active sockets in memory
const activeSockets: Record<string, any> = {};

interface BackendResponse {
    uploadUrl?: string;
    [key: string]: any;
}

// Helper to update backend
async function updateBackend(body: any): Promise<BackendResponse | null> {
    try {
        const response = await fetch(BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Worker DEBUG] Failed to sync ${body.action} with backend. Status: ${response.status}`, errorText);
            return null;
        } else {
            console.log(`[Worker DEBUG] Successfully synced ${body.action} with backend.`);
            try {
                return await response.json() as BackendResponse;
            } catch (e) {
                return null;
            }
        }
    } catch (e: any) {
        console.error('[Worker DEBUG] Failed to connect to backend:', e.message);
        return null;
    }
}

async function uploadMedia(businessId: string, message: proto.IWebMessageInfo) {
    const messageType = Object.keys(message.message || {})[0];
    if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) return null;

    try {
        console.log(`[Worker] Downloading media of type: ${messageType}`);
        const buffer = await downloadMediaMessage(
            message as any,
            'buffer',
            {},
            { 
                logger: pino({ level: 'silent' }) as any,
                reuploadRequest: (activeSockets[businessId] as any).updateMediaMessage
            }
        ) as Buffer;

        // 1. Get upload URL from Convex
        const urlResponse = await updateBackend({
            action: 'generateUploadUrl',
            businessId
        });

        if (!urlResponse || !urlResponse.uploadUrl) {
            console.error("[Worker] Failed to get upload URL");
            return null;
        }

        // 2. Upload to Convex
        const messageContent = message.message ? (message.message as any)[messageType] : null;
        const uploadResponse = await fetch(urlResponse.uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': messageContent?.mimetype || 'application/octet-stream' },
            body: buffer
        });

        if (!uploadResponse.ok) {
            console.error("[Worker] Failed to upload media to Convex");
            return null;
        }

        const { storageId } = await uploadResponse.json() as { storageId: string };
        console.log(`[Worker] Media uploaded successfully: ${storageId}`);
        return storageId;
    } catch (error) {
        console.error("[Worker] Error uploading media:", error);
        return null;
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
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true
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
            
            delete activeSockets[businessId];
            
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
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
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

    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            const name = contact.name || contact.verifiedName || (contact as any).publicName || (contact as any).notify;
            if (name && contact.id) {
                console.log(`[Worker] Updating contact name for ${contact.id}: ${name}`);
                await updateBackend({
                    action: 'receiveMessage', // use receiveMessage to update/create customer
                    businessId,
                    sender: contact.id,
                    content: "Contact updated",
                    timestamp: Date.now(),
                    fromMe: false,
                    isGroup: contact.id.endsWith('@g.us'),
                    name: name
                });
            }
        }
    });

    // Handle historical sync (like WhatsApp Web)
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
        console.log(`[Worker DEBUG] Received history sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages`);
        
        const syncData: any[] = [];
        const contactMap = new Map();
        contacts.forEach(c => {
            const name = c.name || c.verifiedName || (c as any).publicName || (c as any).notify;
            if (name) {
                contactMap.set(c.id, name);
                contactMap.set(c.id.split('@')[0], name);
            }
        });

        // Also try to get names from messages (pushName)
        messages.forEach(m => {
            if (m.key.remoteJid && m.pushName) {
                contactMap.set(m.key.remoteJid, m.pushName);
                contactMap.set(m.key.remoteJid.split('@')[0], m.pushName);
            }
        });

        for (const chat of chats) {
            const remoteJid = chat.id;
            if (!remoteJid) continue;
            
            const isGroup = remoteJid.endsWith('@g.us');
            const idKey = remoteJid.split('@')[0];
            const name = contactMap.get(remoteJid) || contactMap.get(idKey) || chat.name || (isGroup ? "Group Chat" : idKey);
            
            // Sync the last 10 messages for each chat
            const chatMessages = messages
                .filter(m => m.key && m.key.remoteJid === remoteJid)
                .sort((a, b) => ((a.messageTimestamp as number) || 0) - ((b.messageTimestamp as number) || 0))
                .slice(-10);

            if (chatMessages.length === 0) {
                // If no messages found, still record the chat existence
                if (chat.lastMessageRecvTimestamp) {
                    syncData.push({
                        sender: remoteJid,
                        content: "Existing conversation",
                        timestamp: (chat.lastMessageRecvTimestamp as number) * 1000,
                        fromMe: false,
                        name,
                        isGroup,
                        messageType: "text"
                    });
                }
                continue;
            }

            for (const msg of chatMessages) {
                const content = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text || 
                                msg.message?.imageMessage?.caption || 
                                msg.message?.videoMessage?.caption ||
                                "[Media]";
                
                let messageType: string = "text";
                if (msg.message?.imageMessage) messageType = "image";
                else if (msg.message?.videoMessage) messageType = "video";
                else if (msg.message?.audioMessage) messageType = "audio";
                else if (msg.message?.documentMessage) messageType = "document";

                syncData.push({
                    sender: remoteJid,
                    content,
                    timestamp: ((msg.messageTimestamp as number) || 0) * 1000 || Date.now(),
                    fromMe: !!msg.key.fromMe,
                    name,
                    isGroup,
                    messageType
                });
            }
        }

        if (syncData.length > 0) {
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
           const remoteJid = msg.key.remoteJid;
           if (!remoteJid) continue;

           // Handle Status
           if (remoteJid === 'status@broadcast') {
               console.log(`[Worker] New status from ${msg.pushName || msg.key.participant}`);
               const mediaId = await uploadMedia(businessId, msg);
               const content = msg.message?.conversation || 
                               msg.message?.extendedTextMessage?.text || 
                               msg.message?.imageMessage?.caption || 
                               msg.message?.videoMessage?.caption;
               
               await updateBackend({
                   action: 'syncStatus',
                   businessId,
                   sender: msg.pushName || (msg.key.participant as string) || "Unknown",
                   content,
                   mediaId,
                   mediaType: Object.keys(msg.message || {})[0],
                   timestamp: ((msg.messageTimestamp as number) || 0) * 1000 || Date.now()
               });
               continue;
           }

           const isGroup = remoteJid.endsWith('@g.us');
           let content = msg.message?.conversation || 
                          msg.message?.extendedTextMessage?.text || 
                          msg.message?.imageMessage?.caption ||
                          msg.message?.videoMessage?.caption;
            
           let messageType = "text";
           if (msg.message?.imageMessage) messageType = "image";
           else if (msg.message?.videoMessage) messageType = "video";
           else if (msg.message?.audioMessage) messageType = "audio";
           else if (msg.message?.documentMessage) messageType = "document";

           if (!content && messageType === "text") continue;
           if (!content) content = `[${messageType}]`;

           console.log(`[Worker] New message from ${remoteJid}: ${content.substring(0, 30)}...`);

           let mediaId = undefined;
           if (messageType !== "text") {
               mediaId = await uploadMedia(businessId, msg);
           }

           let groupMetadata = undefined;
           if (isGroup) {
               try {
                   const metadata = await sock.groupMetadata(remoteJid);
                   groupMetadata = {
                       owner: metadata.owner,
                       participants: metadata.participants.map(p => p.id)
                   };
               } catch (e) {
                   console.error(`[Worker] Failed to fetch group metadata for ${remoteJid}`);
               }
           }

           // Forward to backend
           await updateBackend({
               action: 'newMessage',
               businessId,
               sender: remoteJid,
               content,
               timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
               fromMe: msg.key.fromMe,
               isGroup,
               groupMetadata,
               messageType,
               mediaId,
               fileName: msg.message?.documentMessage?.fileName
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
    } catch (error: unknown) {
        console.error(`[Worker] Error starting session for ${businessId}:`, error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
});

// Health check
app.get("/", (req, res) => {
    res.send("PIPELIXR WhatsApp Worker is running");
});

// Pairing code request
app.post("/pairing/request", async (req, res) => {
    const { businessId, phone } = req.body;
    if (!businessId || !phone) {
        return res.status(400).json({ error: "Missing businessId or phone" });
    }

    const sock = activeSockets[businessId];
    if (!sock) {
        return res.status(404).json({ error: "Session not found. Start session first." });
    }

    try {
        const cleanedPhone = phone.replace(/\D/g, '');
        console.log(`[Worker] Generating pairing code for ${businessId} with cleaned phone: ${cleanedPhone}`);
        
        if (cleanedPhone.length < 8) {
            throw new Error("Phone number is too short or invalid");
        }

        const code = await sock.requestPairingCode(cleanedPhone);
        
        // Post code back to Convex
        await updateBackend({
            action: 'updatePairingCode',
            businessId,
            pairingCode: code
        });

        res.json({ success: true, code });
    } catch (error) {
        console.error(`[Worker] Pairing error for ${businessId}:`, error);
        res.status(500).json({ error: String(error) });
    }
});

// Outgoing message endpoint
app.post('/message/send', async (req, res) => {
    const { businessId, to, content } = req.body;
    
    if (!businessId || !to || !content) {
        return res.status(400).json({ error: 'businessId, to, and content are required' });
    }
    
    const sock = activeSockets[businessId];
    if (!sock) {
        return res.status(404).json({ error: `No active session for business ${businessId}` });
    }
    
    try {
        // Ensure ID is properly formatted for WhatsApp
        // 1. Strip '+' if present
        const cleanTo = to.startsWith('+') ? to.substring(1) : to;
        
        // 2. Add suffix if not present
        const jid = cleanTo.includes('@') ? cleanTo : `${cleanTo}@s.whatsapp.net`;
        
        if (!sock.user) {
            return res.status(503).json({ error: 'WhatsApp session is active but not fully connected' });
        }
        
        console.log(`[Worker] Attempting to send message to JID: "${jid}"`);
        console.log(`[Worker] Content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
        
        const result = await sock.sendMessage(jid, { text: content });
        
        console.log(`[Worker] Message sent successfully. Baileys result ID: ${result?.key?.id}`);
        console.log(`[Worker] Full result key:`, JSON.stringify(result?.key));
        
        res.json({ success: true, messageId: result?.key?.id });
    } catch (error: unknown) {
        console.error(`[Worker] Error sending message for ${businessId}:`, error);
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
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
