"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendService = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL || 'https://original-sparrow-842.eu-west-1.convex.site';
const NEXT_JS_URL = process.env.NEXT_JS_URL || 'http://localhost:3000/api/worker';
const BACKEND_URL = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT
    ? `${CONVEX_SITE_URL}/api/worker`
    : NEXT_JS_URL;
class BackendService {
    static async update(body) {
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
            }
            else {
                try {
                    return await response.json();
                }
                catch (e) {
                    return { success: true };
                }
            }
        }
        catch (e) {
            console.error('[BackendService] Failed to connect to backend:', e.message);
            return null;
        }
    }
    static async getConnectedBusinesses() {
        const response = await this.update({ action: 'getConnectedBusinesses' });
        return response?.businesses || [];
    }
    static async updateStatus(businessId, status) {
        return this.update({ action: 'updateStatus', businessId, status });
    }
    static async updateQRCode(businessId, qr) {
        return this.update({ action: 'updateQRCode', businessId, qrCodeString: qr });
    }
    static async updateContactName(businessId, phone, name, isGroup, createIfMissing = true) {
        return this.update({ action: 'updateContactName', businessId, phone, name, isGroup, createIfMissing });
    }
    static async newMessage(businessId, data) {
        return this.update({ action: 'newMessage', businessId, ...data });
    }
    static async syncHistory(businessId, history) {
        return this.update({ action: 'syncHistory', businessId, history });
    }
    static async syncStatus(businessId, data) {
        return this.update({ action: 'syncStatus', businessId, ...data });
    }
    static async syncStatusView(businessId, data) {
        return this.update({ action: 'syncStatusView', businessId, ...data });
    }
    static async updateMessage(businessId, data) {
        return this.update({ action: 'updateMessage', businessId, ...data });
    }
    static async generateUploadUrl(businessId) {
        return this.update({ action: 'generateUploadUrl', businessId });
    }
    static async updatePairingCode(businessId, code) {
        return this.update({ action: 'updatePairingCode', businessId, pairingCode: code });
    }
}
exports.BackendService = BackendService;
