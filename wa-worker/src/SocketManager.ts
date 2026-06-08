import { EventHandler } from './EventHandler';
import fs from 'fs';
import path from 'path';
import { BaileysAdapter } from './adapters/BaileysAdapter';
import { WhatsAppAdapter } from './adapters/WhatsAppAdapter';

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
                    // Randomized delay between 3 and 12 seconds as per PRD
                    const delayMs = 3000 + Math.random() * 9000;
                    await new Promise(r => setTimeout(r, delayMs));
                } catch (e) {
                    console.error("[MessageQueue] Task failed", e);
                }
            }
        }
        this.isProcessing = false;
    }
}

export class SocketManager {
    private static adapters: Record<string, WhatsAppAdapter> = {};
    private static messageQueues: Record<string, MessageQueue> = {};
    private static sessionsDir: string;

    static init(sessionsDir: string) {
        this.sessionsDir = sessionsDir;
        EventHandler.setSessionsPath(sessionsDir);
        if (!fs.existsSync(sessionsDir)) {
            fs.mkdirSync(sessionsDir, { recursive: true });
        }
    }

    static async startSession(businessId: string, pairingNumber?: string, mode: 'official' | 'unofficial' = 'unofficial') {
        console.log(`[SocketManager] Starting session for ${businessId} in mode ${mode}`);
        
        await this.closeSession(businessId);

        let adapter: WhatsAppAdapter;
        
        if (mode === 'unofficial') {
            const baileysAdapter = new BaileysAdapter(businessId, this.sessionsDir);
            await baileysAdapter.init(pairingNumber, 
                (update) => EventHandler.onConnectionUpdate(businessId, update, baileysAdapter.sock, (bid) => this.startSession(bid)),
                {
                    onContactsUpsert: (contacts: any) => EventHandler.onContactsUpsert(businessId, contacts),
                    onMessagesUpsert: (m: any) => EventHandler.onMessagesUpsert(businessId, m, baileysAdapter.sock),
                    onHistorySet: (data: any) => EventHandler.onHistorySet(businessId, data, baileysAdapter.sock),
                    onMessagesUpdate: async (updates: any) => { EventHandler.onMessagesUpdate(businessId, updates).catch(console.error); },
                    onMessageReceiptUpdate: (receipts: any) => { EventHandler.onMessageReceiptUpdate(businessId, receipts).catch(console.error); }
                }
            );
            adapter = baileysAdapter;
        } else {
            // Cloud API would go here eventually
            throw new Error("Cloud API adapter not fully implemented in SocketManager yet");
        }

        this.adapters[businessId] = adapter;
        this.messageQueues[businessId] = new MessageQueue();

        return adapter;
    }

    static getAdapter(businessId: string): WhatsAppAdapter {
        return this.adapters[businessId];
    }

    static getSocket(businessId: string): any {
        // Compatibility for existing code
        const adapter = this.adapters[businessId];
        if (adapter instanceof BaileysAdapter) {
            return adapter.sock;
        }
        return null;
    }

    static async enqueueTask(businessId: string, task: () => Promise<void>) {
        if (!this.messageQueues[businessId]) {
            this.messageQueues[businessId] = new MessageQueue();
        }
        this.messageQueues[businessId].add(task);
    }

    static async closeSession(businessId: string) {
        const adapter = this.adapters[businessId];
        if (adapter) {
            try {
                if (adapter instanceof BaileysAdapter && adapter.sock?.ws) {
                    adapter.sock.ws.close();
                }
            } catch (e) {}
            delete this.adapters[businessId];
            delete this.messageQueues[businessId];
        }
    }
}

