import { 
    makeWASocket, 
    useMultiFileAuthState as getMultiFileAuthState, 
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { EventHandler } from './EventHandler';

class MessageQueue {
    queue: (() => Promise<void>)[] = [];
    isProcessing = false;
    
    add(task: () => Promise<void>) {
        this.queue.push(task);
        this.process();
    }
    
    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                try {
                    await task();
                    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
                } catch (e) {
                    console.error("[MessageQueue] Task failed", e);
                }
            }
        }
        this.isProcessing = false;
    }
}

export class SocketManager {
    private static activeSockets: Record<string, any> = {};
    private static messageQueues: Record<string, MessageQueue> = {};
    private static sessionsDir: string;

    static init(sessionsDir: string) {
        this.sessionsDir = sessionsDir;
        EventHandler.setSessionsPath(sessionsDir);
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
    }

    static async startSession(businessId: string, pairingNumber?: string) {
        console.log(`[SocketManager] Starting session for ${businessId}`);
        const sessionPath = path.join(this.sessionsDir, `session-${businessId}`);

        // Prevent duplicate sessions
        await this.closeSession(businessId);

        if (pairingNumber && fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        const { state, saveCreds } = await getMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'info' }) as any,
            browser: ["PIPELIXR", "Chrome", "1.0.0"],
            syncFullHistory: true,
            shouldSyncHistoryMessage: () => true
        });

        this.activeSockets[businessId] = sock;
        this.messageQueues[businessId] = new MessageQueue();

        sock.ev.on('connection.update', (update) => 
            EventHandler.onConnectionUpdate(businessId, update, sock, (bid) => this.startSession(bid))
        );

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('contacts.upsert', (contacts) => 
            EventHandler.onContactsUpsert(businessId, contacts)
        );

        sock.ev.on('messages.upsert', (m) => 
            EventHandler.onMessagesUpsert(businessId, m, sock)
        );

        sock.ev.on('messaging-history.set', (data) => 
            EventHandler.onHistorySet(businessId, data, sock)
        );

        sock.ev.on('messages.update', async (updates) => {
            EventHandler.onMessagesUpdate(businessId, updates).catch(console.error);
        });

        sock.ev.on('message-receipt.update', (receipts) => {
            EventHandler.onMessageReceiptUpdate(businessId, receipts).catch(console.error);
        });

        return sock;
    }

    static getSocket(businessId: string) {
        return this.activeSockets[businessId];
    }

    static async enqueueTask(businessId: string, task: () => Promise<void>) {
        if (!this.messageQueues[businessId]) {
            this.messageQueues[businessId] = new MessageQueue();
        }
        this.messageQueues[businessId].add(task);
    }

    static async closeSession(businessId: string) {
        const sock = this.activeSockets[businessId];
        if (sock) {
            try {
                if (sock.ws) sock.ws.close();
            } catch (e) {}
            delete this.activeSockets[businessId];
            delete this.messageQueues[businessId];
        }
    }
}
