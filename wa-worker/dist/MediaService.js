"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
const baileys_1 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const BackendService_1 = require("./BackendService");
class MediaService {
    static async uploadMedia(businessId, message, sock) {
        const messageType = Object.keys(message.message || {})[0];
        if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType))
            return null;
        try {
            console.log(`[MediaService] Downloading media of type: ${messageType}`);
            const buffer = await (0, baileys_1.downloadMediaMessage)(message, 'buffer', {}, {
                logger: this.logger,
                reuploadRequest: sock.updateMediaMessage
            });
            // 1. Get upload URL from Convex
            const urlResponse = await BackendService_1.BackendService.generateUploadUrl(businessId);
            if (!urlResponse || !urlResponse.uploadUrl) {
                console.error("[MediaService] Failed to get upload URL");
                return null;
            }
            // 2. Upload to Convex
            const messageContent = message.message ? message.message[messageType] : null;
            const uploadResponse = await fetch(urlResponse.uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': messageContent?.mimetype || 'application/octet-stream' },
                body: buffer
            });
            if (!uploadResponse.ok) {
                console.error("[MediaService] Failed to upload media to Convex");
                return null;
            }
            const { storageId } = await uploadResponse.json();
            console.log(`[MediaService] Media uploaded successfully: ${storageId}`);
            return storageId;
        }
        catch (error) {
            console.error("[MediaService] Error uploading media:", error);
            return null;
        }
    }
}
exports.MediaService = MediaService;
MediaService.logger = (0, pino_1.default)({ level: 'silent' });
