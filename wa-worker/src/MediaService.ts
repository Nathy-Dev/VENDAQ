import { downloadMediaMessage, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import { BackendService } from './BackendService';

export class MediaService {
    private static logger = pino({ level: 'silent' });

    static async uploadMedia(businessId: string, message: proto.IWebMessageInfo, sock: any) {
        const messageType = Object.keys(message.message || {})[0];
        if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) return null;

        try {
            console.log(`[MediaService] Downloading media of type: ${messageType}`);
            const buffer = await downloadMediaMessage(
                message as any,
                'buffer',
                {},
                { 
                    logger: this.logger as any,
                    reuploadRequest: sock.updateMediaMessage
                }
            ) as Buffer;

            // 1. Get upload URL from Convex
            const urlResponse = await BackendService.generateUploadUrl(businessId);

            if (!urlResponse || !urlResponse.uploadUrl) {
                console.error("[MediaService] Failed to get upload URL");
                return null;
            }

            // 2. Upload to Convex
            const messageContent = message.message ? (message.message as any)[messageType] : null;
            const uploadResponse = await fetch(urlResponse.uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': messageContent?.mimetype || 'application/octet-stream' },
                body: buffer
            });

            if (!uploadResponse.ok) {
                console.error("[MediaService] Failed to upload media to Convex");
                return null;
            }

            const { storageId } = await uploadResponse.json() as { storageId: string };
            console.log(`[MediaService] Media uploaded successfully: ${storageId}`);
            return storageId;
        } catch (error) {
            console.error("[MediaService] Error uploading media:", error);
            return null;
        }
    }
}
