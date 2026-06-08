"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudAPIAdapter = void 0;
class CloudAPIAdapter {
    constructor(businessId) {
        this.businessId = businessId;
    }
    onMessage(handler) {
        console.log(`[CloudAPIAdapter] Registered message handler for ${this.businessId}`);
    }
    onMediaMessage(handler) {
        console.log(`[CloudAPIAdapter] Registered media message handler for ${this.businessId}`);
    }
    async sendMessage(to, content) {
        console.log(`[CloudAPIAdapter] Sending message to ${to}: ${content}`);
        // TODO: Implement Meta Cloud API REST call
    }
    async sendMediaMessage(to, mediaUrl, caption) {
        console.log(`[CloudAPIAdapter] Sending media to ${to}`);
        // TODO: Implement Meta Cloud API media upload and send
    }
    getConnectionStatus() {
        return 'connected'; // Cloud API is stateless/always connected conceptually once configured
    }
    async requestReconnect() {
        console.log(`[CloudAPIAdapter] Reconnect requested`);
    }
}
exports.CloudAPIAdapter = CloudAPIAdapter;
