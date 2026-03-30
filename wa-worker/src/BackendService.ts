import dotenv from 'dotenv';

dotenv.config();

const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || 'https://original-sparrow-842.eu-west-1.convex.site';
const NEXT_JS_URL = process.env.NEXT_JS_URL || 'http://localhost:3000/api/worker';

const BACKEND_URL = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT 
    ? `${CONVEX_SITE_URL}/api/worker` 
    : NEXT_JS_URL;

export interface BackendResponse {
    uploadUrl?: string;
    businesses?: { _id: string }[];
    [key: string]: any;
}

export class BackendService {
    static async update(body: any): Promise<BackendResponse | null> {
        try {
            console.log(`[BackendService] Syncing ${body.action} with ${BACKEND_URL}`);
            const response = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[BackendService] Failed to sync ${body.action}. Status: ${response.status}`, errorText);
                return null;
            } else {
                try {
                    return await response.json() as BackendResponse;
                } catch (e) {
                    return { success: true };
                }
            }
        } catch (e: any) {
            console.error('[BackendService] Failed to connect to backend:', e.message);
            return null;
        }
    }

    static async getConnectedBusinesses(): Promise<{ _id: string }[]> {
        const response = await this.update({ action: 'getConnectedBusinesses' });
        return response?.businesses || [];
    }

    static async updateStatus(businessId: string, status: 'connected' | 'disconnected' | 'error') {
        return this.update({ action: 'updateStatus', businessId, status });
    }

    static async updateQRCode(businessId: string, qr: string) {
        return this.update({ action: 'updateQRCode', businessId, qrCodeString: qr });
    }

    static async updateContactName(businessId: string, phone: string, name: string, isGroup: boolean) {
        return this.update({ action: 'updateContactName', businessId, phone, name, isGroup });
    }

    static async newMessage(businessId: string, data: any) {
        return this.update({ action: 'newMessage', businessId, ...data });
    }

    static async syncHistory(businessId: string, history: any[]) {
        return this.update({ action: 'syncHistory', businessId, history });
    }

    static async syncStatus(businessId: string, data: any) {
        return this.update({ action: 'syncStatus', businessId, ...data });
    }

    static async syncStatusView(businessId: string, data: { whatsappStatusId: string, viewerPhone: string, timestamp: number }) {
        return this.update({ action: 'syncStatusView', businessId, ...data });
    }

    static async updateMessage(businessId: string, data: { whatsappMessageId: string, content?: string, isDeleted?: boolean }) {
        return this.update({ action: 'updateMessage', businessId, ...data });
    }

    static async generateUploadUrl(businessId: string) {
        return this.update({ action: 'generateUploadUrl', businessId });
    }
    
    static async updatePairingCode(businessId: string, code: string) {
        return this.update({ action: 'updatePairingCode', businessId, pairingCode: code });
    }
}
