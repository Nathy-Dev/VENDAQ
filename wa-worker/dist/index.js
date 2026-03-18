"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const baileys_1 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const PORT = process.env.PORT || 3001;
const SESSIONS_DIR = path_1.default.join(__dirname, '../sessions');
// The Convex HTTP actions endpoint format: <CONVEX_URL>/api/mutation_name
// Since we don't have HTTP actions setup yet, we will use a workaround or we need to setup HTTP actions in Convex.
// Wait, Convex mutations can be called directly if we use the convex client, but in a raw node script it's easier to use fetch with HTTP Actions.
// Let's actually create the fetch calls to a standard Next.js API route as a proxy, OR set up Convex HTTP actions. 
// Actually, setting up Convex HTTP actions is best practices for external webhooks. Let's use a placeholder URL for now and we will create a Next.js API route to proxy to Convex.
// Wait, the client is already running on localhost:3000. It's much easier to just create an API route in Next.js.
const NEXT_JS_URL = 'http://localhost:3000/api/worker';
// Ensure sessions directory exists
if (!fs_1.default.existsSync(SESSIONS_DIR)) {
    fs_1.default.mkdirSync(SESSIONS_DIR, { recursive: true });
}
// Store active sockets in memory
const activeSockets = {};
// Helper to update backend
async function updateBackend(body) {
    try {
        const response = await fetch(NEXT_JS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Worker] Failed to sync with backend. Status: ${response.status}`, errorText);
        }
    }
    catch (e) {
        console.error('[Worker] Failed to connect to backend:', e.message);
    }
}
async function startSession(businessId) {
    console.log(`[Worker] Starting session for business: ${businessId}`);
    // Path for this specific business's auth state
    const sessionPath = path_1.default.join(SESSIONS_DIR, `session-${businessId}`);
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionPath);
    const sock = (0, baileys_1.makeWASocket)({
        auth: state,
        logger: (0, pino_1.default)({ level: 'silent' }) // Suppress noisy logs
    });
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log(`[Worker] New QR generated for business: ${businessId}`);
            // Render in terminal for testing
            qrcode_terminal_1.default.generate(qr, { small: true });
            // Post QR to backend
            await updateBackend({
                action: 'updateQRCode',
                businessId,
                qrCodeString: qr
            });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== baileys_1.DisconnectReason.loggedOut;
            console.log(`[Worker] Connection closed for ${businessId}: ${shouldReconnect ? 'reconnecting' : 'logged out'}`);
            delete activeSockets[businessId];
            // Reconnect if not explicitly logged out
            if (shouldReconnect) {
                setTimeout(() => startSession(businessId), 3000);
            }
            else {
                // Update backend to disconnected
                await updateBackend({
                    action: 'updateStatus',
                    businessId,
                    status: 'disconnected'
                });
                // Clean up session files if logged out to force re-scan
                fs_1.default.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`[Worker] Deleted session files for ${businessId}`);
            }
        }
        else if (connection === 'open') {
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
    // TODO: Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        console.log(`[Worker] Received message for ${businessId}`);
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
    }
    catch (error) {
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
app.listen(PORT, () => {
    console.log(`WhatsApp Worker running on port ${PORT}`);
});
