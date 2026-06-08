export interface WhatsAppAdapter {
    onMessage(handler: (message: any) => Promise<void>): void;
    onMediaMessage(handler: (message: any) => Promise<void>): void;
    sendMessage(to: string, content: string): Promise<void>;
    sendMediaMessage(to: string, mediaUrl: string, caption?: string): Promise<void>;
    getConnectionStatus(): 'connected' | 'disconnected' | 'pending' | 'error';
    requestReconnect(): Promise<void>;
}
