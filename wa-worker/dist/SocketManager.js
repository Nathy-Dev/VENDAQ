"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketManager = void 0;
const EventHandler_1 = require("./EventHandler");
const fs_1 = __importDefault(require("fs"));
const BaileysAdapter_1 = require("./adapters/BaileysAdapter");
class MessageQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }
    add(task) {
        this.queue.push(task);
        this.process();
    }
    async process() {
        if (this.isProcessing)
            return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                try {
                    await task();
                    // Randomized delay between 3 and 12 seconds as per PRD
                    const delayMs = 3000 + Math.random() * 9000;
                    await new Promise(r => setTimeout(r, delayMs));
                }
                catch (e) {
                    console.error("[MessageQueue] Task failed", e);
                }
            }
        }
        this.isProcessing = false;
    }
}
class SocketManager {
    static init(sessionsDir) {
        this.sessionsDir = sessionsDir;
        EventHandler_1.EventHandler.setSessionsPath(sessionsDir);
        if (!fs_1.default.existsSync(sessionsDir)) {
            fs_1.default.mkdirSync(sessionsDir, { recursive: true });
        }
    }
    static async startSession(businessId, pairingNumber, mode = 'unofficial') {
        console.log(`[SocketManager] Starting session for ${businessId} in mode ${mode}`);
        await this.closeSession(businessId);
        let adapter;
        if (mode === 'unofficial') {
            const baileysAdapter = new BaileysAdapter_1.BaileysAdapter(businessId, this.sessionsDir);
            await baileysAdapter.init(pairingNumber, (update) => EventHandler_1.EventHandler.onConnectionUpdate(businessId, update, baileysAdapter.sock, (bid) => this.startSession(bid)), {
                onContactsUpsert: (contacts) => EventHandler_1.EventHandler.onContactsUpsert(businessId, contacts),
                onMessagesUpsert: (m) => EventHandler_1.EventHandler.onMessagesUpsert(businessId, m, baileysAdapter.sock),
                onHistorySet: (data) => EventHandler_1.EventHandler.onHistorySet(businessId, data, baileysAdapter.sock),
                onMessagesUpdate: async (updates) => { EventHandler_1.EventHandler.onMessagesUpdate(businessId, updates).catch(console.error); },
                onMessageReceiptUpdate: (receipts) => { EventHandler_1.EventHandler.onMessageReceiptUpdate(businessId, receipts).catch(console.error); }
            });
            adapter = baileysAdapter;
        }
        else {
            // Cloud API would go here eventually
            throw new Error("Cloud API adapter not fully implemented in SocketManager yet");
        }
        this.adapters[businessId] = adapter;
        this.messageQueues[businessId] = new MessageQueue();
        return adapter;
    }
    static getAdapter(businessId) {
        return this.adapters[businessId];
    }
    static getSocket(businessId) {
        // Compatibility for existing code
        const adapter = this.adapters[businessId];
        if (adapter instanceof BaileysAdapter_1.BaileysAdapter) {
            return adapter.sock;
        }
        return null;
    }
    static async enqueueTask(businessId, task) {
        if (!this.messageQueues[businessId]) {
            this.messageQueues[businessId] = new MessageQueue();
        }
        this.messageQueues[businessId].add(task);
    }
    static async closeSession(businessId) {
        const adapter = this.adapters[businessId];
        if (adapter) {
            try {
                if (adapter instanceof BaileysAdapter_1.BaileysAdapter && adapter.sock?.ws) {
                    adapter.sock.ws.close();
                }
            }
            catch (e) { }
            delete this.adapters[businessId];
            delete this.messageQueues[businessId];
        }
    }
}
exports.SocketManager = SocketManager;
SocketManager.adapters = {};
SocketManager.messageQueues = {};
