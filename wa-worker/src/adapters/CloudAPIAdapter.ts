import { WhatsAppAdapter } from './WhatsAppAdapter';

export class CloudAPIAdapter implements WhatsAppAdapter {
    private businessId: string;

    constructor(businessId: string) {
        this.businessId = businessId;
    }

    onMessage(handler: (message: any) => Promise<void>): void {
        console.log(`[CloudAPIAdapter] Registered message handler for ${this.businessId}`);
    }

    onMediaMessage(handler: (message: any) => Promise<void>): void {
        console.log(`[CloudAPIAdapter] Registered media message handler for ${this.businessId}`);
    }

    async sendMessage(to: string, content: string): Promise<void> {
        console.log(`[CloudAPIAdapter] Sending message to ${to}: ${content}`);
        // TODO: Implement Meta Cloud API REST call
    }

    async sendMediaMessage(to: string, mediaUrl: string, caption?: string): Promise<void> {
        console.log(`[CloudAPIAdapter] Sending media to ${to}`);
        // TODO: Implement Meta Cloud API media upload and send
    }

    getConnectionStatus(): 'connected' | 'disconnected' | 'pending' | 'error' {
        return 'connected'; // Cloud API is stateless/always connected conceptually once configured
    }

    async requestReconnect(): Promise<void> {
        console.log(`[CloudAPIAdapter] Reconnect requested`);
    }
}
