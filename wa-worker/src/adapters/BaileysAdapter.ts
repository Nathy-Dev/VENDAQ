import { WhatsAppAdapter } from './WhatsAppAdapter';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

export class BaileysAdapter implements WhatsAppAdapter {
    private businessId: string;
    private sessionsDir: string;
    public sock: any;
    private messageHandler?: (message: any) => Promise<void>;
    private connectionStatus: 'connected' | 'disconnected' | 'pending' | 'error' = 'disconnected';

    constructor(businessId: string, sessionsDir: string) {
        this.businessId = businessId;
        this.sessionsDir = sessionsDir;
    }

    async init(pairingNumber?: string, onConnectionUpdate?: (update: any) => void, onEvents?: any) {
        const sessionPath = path.join(this.sessionsDir, `session-${this.businessId}`);
        if (pairingNumber && fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'info' }) as any,
            browser: ["Pipelixr", "Chrome", "1.0.0"],
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => true
        });

        this.sock.ev.on('creds.update', saveCreds);

        if (onConnectionUpdate) {
            this.sock.ev.on('connection.update', (update: any) => {
                if (update.connection === 'open') this.connectionStatus = 'connected';
                if (update.connection === 'close') this.connectionStatus = 'disconnected';
                if (update.qr || update.isNewLogin) this.connectionStatus = 'pending';
                onConnectionUpdate(update);
            });
        }

        if (onEvents?.onContactsUpsert) this.sock.ev.on('contacts.upsert', onEvents.onContactsUpsert);
        if (onEvents?.onMessagesUpsert) this.sock.ev.on('messages.upsert', onEvents.onMessagesUpsert);
        if (onEvents?.onHistorySet) this.sock.ev.on('messaging-history.set', onEvents.onHistorySet);
        if (onEvents?.onMessagesUpdate) this.sock.ev.on('messages.update', onEvents.onMessagesUpdate);
        if (onEvents?.onMessageReceiptUpdate) this.sock.ev.on('message-receipt.update', onEvents.onMessageReceiptUpdate);

        return this.sock;
    }

    onMessage(handler: (message: any) => Promise<void>): void {
        this.messageHandler = handler;
    }

    onMediaMessage(handler: (message: any) => Promise<void>): void {
        // Not used separately in current implementation, handled in messages.upsert
    }

    async sendMessage(to: string, content: string): Promise<void> {
        if (!this.sock) throw new Error("Socket not initialized");
        const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        await this.sock.sendMessage(jid, { text: content });
    }

    async sendMediaMessage(to: string, mediaUrl: string, caption?: string): Promise<void> {
        // Implement later
    }

    getConnectionStatus(): 'connected' | 'disconnected' | 'pending' | 'error' {
        return this.connectionStatus;
    }

    async requestReconnect(): Promise<void> {
        if (this.sock?.ws) this.sock.ws.close();
        await this.init();
    }
}
