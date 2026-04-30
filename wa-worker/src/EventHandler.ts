import { 
    DisconnectReason, 
    proto 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { BackendService } from './BackendService';
import { MediaService } from './MediaService';

const HISTORY_WINDOW_HOURS = Number(process.env.HISTORY_SYNC_WINDOW_HOURS || 24);
const HISTORY_BATCH_SIZE = Number(process.env.HISTORY_SYNC_BATCH_SIZE || 100);
const CONTACT_UPSERT_BATCH_SIZE = Number(process.env.HISTORY_CONTACT_BATCH_SIZE || 50);
const MAX_HISTORY_MESSAGES = Number(process.env.HISTORY_MAX_MESSAGES || 3000);

export class EventHandler {
    private static sessionsPath: string;

    static setSessionsPath(path: string) {
        this.sessionsPath = path;
    }

    static normalizeJid(jid: string): string {
        if (!jid) return jid;
        if (jid.includes('@g.us')) return jid;
        const [user] = jid.split('@');
        const [number] = user.split(':');
        return `${number}@s.whatsapp.net`;
    }

    static isMe(jid: string, sock: any): boolean {
        const myJid = sock.user?.id;
        if (!myJid) return false;
        
        const normJid = this.normalizeJid(jid);
        const normMe = this.normalizeJid(myJid);
        
        return normJid === normMe;
    }

    static async onConnectionUpdate(businessId: string, update: any, sock: any, onRestart: (bid: string) => void) {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log(`[EventHandler] New QR for ${businessId}`);
            qrcode.generate(qr, { small: true });
            await BackendService.updateQRCode(businessId, qr);
        }
        
        if (connection === 'close') {
            const errorReason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            console.log(`[EventHandler] Connection closed for ${businessId}: Reason: ${errorReason}`);
            
            const isLoggedOut = errorReason === DisconnectReason.loggedOut || errorReason === 403;

            if (isLoggedOut) {
                console.log(`[EventHandler] Device logged out for ${businessId}`);
                await BackendService.updateStatus(businessId, 'disconnected');
                const sessionPath = `${this.sessionsPath}/session-${businessId}`;
                if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
            } else if (errorReason === DisconnectReason.restartRequired) {
                console.log(`[EventHandler] Restart required for ${businessId}`);
                // Mark not connected immediately so UI doesn't stay stale.
                await BackendService.updateStatus(businessId, 'pending');
                onRestart(businessId);
            } else {
                console.log(`[EventHandler] Connection lost for ${businessId}, will reconnect.`);
                // Mark not connected immediately while transport is down.
                await BackendService.updateStatus(businessId, 'pending');
            }
        } else if (connection === 'open') {
            console.log(`[EventHandler] Connection opened for ${businessId}`);
            await BackendService.updateStatus(businessId, 'connected');
        }
    }

    static async onContactsUpsert(businessId: string, contacts: any[]) {
        for (const contact of contacts) {
            const name = contact.name || contact.verifiedName || contact.publicName || contact.notify;
            if (name && contact.id) {
                await BackendService.updateContactName(
                    businessId, 
                    this.normalizeJid(contact.id), 
                    name, 
                    contact.id.endsWith('@g.us'),
                    false
                );
            }
        }
    }

    static async onMessagesUpsert(businessId: string, m: any, sock: any) {
        if (m.type !== 'notify') return;
        
        for (const msg of m.messages) {
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid) continue;

            // Fix self-conversation: Skip messages to/from ourselves
            if (this.isMe(remoteJid, sock)) {
                console.log(`[EventHandler] Skipping self-message to/from ${remoteJid}`);
                continue;
            }

            // Handle Status
            if (remoteJid === 'status@broadcast') {
                const mediaId = await MediaService.uploadMedia(businessId, msg, sock);
                const content = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text || 
                                msg.message?.imageMessage?.caption || 
                                msg.message?.videoMessage?.caption;
                
                await BackendService.syncStatus(businessId, {
                    sender: msg.pushName || (msg.key.participant as string) || "Unknown",
                    content,
                    mediaId,
                    mediaType: Object.keys(msg.message || {})[0],
                    timestamp: ((msg.messageTimestamp as number) || 0) * 1000 || Date.now(),
                    whatsappMessageId: msg.key.id
                });
                continue;
            }

            const isGroup = remoteJid.endsWith('@g.us');
            const messageType = this.getMessageType(msg);
            
            let content = msg.message?.conversation || 
                           msg.message?.extendedTextMessage?.text || 
                           msg.message?.imageMessage?.caption ||
                           msg.message?.videoMessage?.caption;

            if (!content && messageType === "text") continue;
            if (!content) content = `[${messageType}]`;

            let mediaId = undefined;
            if (messageType !== "text" && messageType !== "location") {
                mediaId = await MediaService.uploadMedia(businessId, msg, sock);
            }

            let groupMetadata = undefined;
            if (isGroup) {
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    groupMetadata = {
                        owner: metadata.owner,
                        participants: metadata.participants.map((p: any) => p.id)
                    };
                } catch (e) {
                    // Fail silently for metadata errors
                }
            }

            if (msg.pushName && !msg.key.fromMe) {
                await BackendService.updateContactName(
                    businessId, 
                    this.normalizeJid(remoteJid), 
                    msg.pushName, 
                    isGroup,
                    false
                );
            }

            await BackendService.newMessage(businessId, {
                sender: this.normalizeJid(remoteJid),
                content,
                timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
                fromMe: !!msg.key.fromMe,
                isGroup,
                groupMetadata,
                messageType,
                mediaId,
                fileName: msg.message?.documentMessage?.fileName,
                name: msg.key.fromMe ? undefined : msg.pushName, // Don't use our own name for recipients
                whatsappMessageId: msg.key.id
            });
        }
    }

    private static getMessageType(msg: proto.IWebMessageInfo): string {
        if (msg.message?.imageMessage) return "image";
        if (msg.message?.videoMessage) return "video";
        if (msg.message?.audioMessage) return "audio";
        if (msg.message?.documentMessage) return "document";
        if (msg.message?.locationMessage) return "location";
        return "text";
    }

    static async onHistorySet(businessId: string, { chats, contacts, messages }: any, sock: any) {
        console.log(`[EventHandler] Received history sync for ${businessId}`);
        const syncData: any[] = [];
        const contactMap = new Map<string, string>();
        const cutoffMs = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
        const messagesByJid = new Map<string, any[]>();
        const recentMessages: any[] = [];

        for (const message of messages || []) {
            const remoteJid = message?.key?.remoteJid;
            if (!remoteJid || remoteJid === "status@broadcast") continue;
            const normalizedJid = this.normalizeJid(remoteJid);
            const timestampMs = ((message.messageTimestamp as number) || 0) * 1000;
            if (timestampMs < cutoffMs) continue;

            recentMessages.push(message);
            const bucket = messagesByJid.get(normalizedJid) || [];
            bucket.push(message);
            messagesByJid.set(normalizedJid, bucket);
        }

        if (recentMessages.length > MAX_HISTORY_MESSAGES) {
            recentMessages.sort((a, b) => (((b.messageTimestamp as number) || 0) - ((a.messageTimestamp as number) || 0)));
            const trimmed = recentMessages.slice(0, MAX_HISTORY_MESSAGES);
            messagesByJid.clear();
            for (const message of trimmed) {
                const jid = this.normalizeJid(message.key.remoteJid);
                const bucket = messagesByJid.get(jid) || [];
                bucket.push(message);
                messagesByJid.set(jid, bucket);
            }
        }

        contacts.forEach((c: any) => {
            const name = c.name || c.verifiedName || c.publicName || c.notify;
            if (name) contactMap.set(this.normalizeJid(c.id), name);
        });

        recentMessages.forEach((m: any) => {
            if (m.key.remoteJid && m.pushName) {
                const jid = this.normalizeJid(m.key.remoteJid);
                if (!contactMap.has(jid)) contactMap.set(jid, m.pushName);
            }
        });

        const contactEntries = Array.from(contactMap.entries());
        for (let i = 0; i < contactEntries.length; i += CONTACT_UPSERT_BATCH_SIZE) {
            const batch = contactEntries.slice(i, i + CONTACT_UPSERT_BATCH_SIZE);
            await Promise.all(
                batch.map(([jid, name]) =>
                    BackendService.updateContactName(businessId, jid, name, jid.endsWith('@g.us'), false)
                )
            );
        }

        for (const chat of chats) {
            const jid = this.normalizeJid(chat.id);
            if (!jid || this.isMe(jid, sock)) continue;
            
            const isGroup = jid.endsWith('@g.us');
            const name = contactMap.get(jid) || chat.name || (isGroup ? "Group Chat" : undefined);
            
            const chatMessages = (messagesByJid.get(jid) || [])
                .sort((a: any, b: any) => ((a.messageTimestamp as number) || 0) - ((b.messageTimestamp as number) || 0))
                .slice(-10);

            if (chatMessages.length === 0 && chat.lastMessageRecvTimestamp && ((chat.lastMessageRecvTimestamp as number) * 1000) >= cutoffMs) {
                syncData.push({
                    sender: jid,
                    content: "Existing conversation",
                    timestamp: (chat.lastMessageRecvTimestamp as number) * 1000,
                    fromMe: false,
                    name,
                    isGroup,
                    messageType: "text"
                });
                continue;
            }

            for (const msg of chatMessages) {
                const content = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text || 
                                msg.message?.imageMessage?.caption || 
                                msg.message?.videoMessage?.caption ||
                                "[Media]";
                
                const messageType = this.getMessageType(msg);

                syncData.push({
                    sender: jid,
                    content,
                    timestamp: ((msg.messageTimestamp as number) || 0) * 1000 || Date.now(),
                    fromMe: !!msg.key.fromMe,
                    name: name || msg.pushName,
                    isGroup,
                    messageType,
                    whatsappMessageId: msg.key.id
                });
            }
        }

        if (syncData.length > 0) {
            console.log(
                `[EventHandler] History sync window=${HISTORY_WINDOW_HOURS}h; messages=${syncData.length}; batchSize=${HISTORY_BATCH_SIZE}`
            );
            for (let i = 0; i < syncData.length; i += HISTORY_BATCH_SIZE) {
                await BackendService.syncHistory(businessId, syncData.slice(i, i + HISTORY_BATCH_SIZE));
            }
        } else {
            console.log(`[EventHandler] No recent history to sync in the last ${HISTORY_WINDOW_HOURS}h for ${businessId}`);
        }
    }

    static async onMessagesUpdate(businessId: string, updates: any[]) {
        for (const update of updates) {
            const { key, update: msgUpdate } = update;
            if (!key.id) continue;

            // Handle deletions (Revoke)
            if (msgUpdate.messageStubType === 1 || msgUpdate.protocolMessage?.type === 0) {
                console.log(`[EventHandler] Message revoked/deleted: ${key.id}`);
                await BackendService.updateMessage(businessId, {
                    whatsappMessageId: key.id,
                    isDeleted: true
                });
            } 
            // Handle edits
            else if (msgUpdate.message?.editedMessage || msgUpdate.editedMessage) {
                const edited = msgUpdate.message?.editedMessage || msgUpdate.editedMessage;
                const content = edited.conversation || edited.extendedTextMessage?.text || edited.protocolMessage?.editedMessage?.conversation;
                if (content) {
                    console.log(`[EventHandler] Message edited: ${key.id}`);
                    await BackendService.updateMessage(businessId, {
                        whatsappMessageId: key.id,
                        content: content
                    });
                }
            }
        }
    }
    
    static async onMessageReceiptUpdate(businessId: string, receipts: any[]) {
        for (const receipt of receipts) {
            const { key, receipt: r } = receipt;
            
            // We only care about receipts for statuses (views)
            if (key.remoteJid === 'status@broadcast' && !key.fromMe) {
                const viewerPhone = this.normalizeJid(key.participant || key.remoteJid);
                const whatsappStatusId = key.id;
                
                console.log(`[EventHandler] Status viewed by ${viewerPhone}: ${whatsappStatusId}`);
                
                await BackendService.syncStatusView(businessId, {
                    whatsappStatusId,
                    viewerPhone,
                    timestamp: Date.now()
                });
            }
        }
    }
}
