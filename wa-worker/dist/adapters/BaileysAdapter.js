"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysAdapter = void 0;
const baileys_1 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class BaileysAdapter {
    constructor(businessId, sessionsDir) {
        this.connectionStatus = 'disconnected';
        this.businessId = businessId;
        this.sessionsDir = sessionsDir;
    }
    async init(pairingNumber, onConnectionUpdate, onEvents) {
        const sessionPath = path_1.default.join(this.sessionsDir, `session-${this.businessId}`);
        if (pairingNumber && fs_1.default.existsSync(sessionPath)) {
            fs_1.default.rmSync(sessionPath, { recursive: true, force: true });
        }
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionPath);
        const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
        this.sock = (0, baileys_1.makeWASocket)({
            version,
            auth: state,
            logger: (0, pino_1.default)({ level: 'info' }),
            browser: ["Pipelixr", "Chrome", "1.0.0"],
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => true
        });
        this.sock.ev.on('creds.update', saveCreds);
        if (onConnectionUpdate) {
            this.sock.ev.on('connection.update', (update) => {
                if (update.connection === 'open')
                    this.connectionStatus = 'connected';
                if (update.connection === 'close')
                    this.connectionStatus = 'disconnected';
                if (update.qr || update.isNewLogin)
                    this.connectionStatus = 'pending';
                onConnectionUpdate(update);
            });
        }
        if (onEvents?.onContactsUpsert)
            this.sock.ev.on('contacts.upsert', onEvents.onContactsUpsert);
        if (onEvents?.onMessagesUpsert)
            this.sock.ev.on('messages.upsert', onEvents.onMessagesUpsert);
        if (onEvents?.onHistorySet)
            this.sock.ev.on('messaging-history.set', onEvents.onHistorySet);
        if (onEvents?.onMessagesUpdate)
            this.sock.ev.on('messages.update', onEvents.onMessagesUpdate);
        if (onEvents?.onMessageReceiptUpdate)
            this.sock.ev.on('message-receipt.update', onEvents.onMessageReceiptUpdate);
        return this.sock;
    }
    onMessage(handler) {
        this.messageHandler = handler;
    }
    onMediaMessage(handler) {
        // Not used separately in current implementation, handled in messages.upsert
    }
    async sendMessage(to, content) {
        if (!this.sock)
            throw new Error("Socket not initialized");
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        await this.sock.sendMessage(jid, { text: content });
    }
    async sendMediaMessage(to, mediaUrl, caption) {
        // Implement later
    }
    getConnectionStatus() {
        return this.connectionStatus;
    }
    async requestReconnect() {
        if (this.sock?.ws)
            this.sock.ws.close();
        await this.init();
    }
}
exports.BaileysAdapter = BaileysAdapter;
