"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventHandler = void 0;
const baileys_1 = require("@whiskeysockets/baileys");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const fs_1 = __importDefault(require("fs"));
const BackendService_1 = require("./BackendService");
const MediaService_1 = require("./MediaService");
const HISTORY_WINDOW_HOURS = Number(process.env.HISTORY_SYNC_WINDOW_HOURS || 24);
const HISTORY_BATCH_SIZE = Number(process.env.HISTORY_SYNC_BATCH_SIZE || 100);
const CONTACT_UPSERT_BATCH_SIZE = Number(process.env.HISTORY_CONTACT_BATCH_SIZE || 50);
const MAX_HISTORY_MESSAGES = Number(process.env.HISTORY_MAX_MESSAGES || 3000);
class EventHandler {
    static setSessionsPath(path) {
        this.sessionsPath = path;
    }
    static normalizeJid(jid) {
        if (!jid)
            return jid;
        if (jid.includes('@g.us'))
            return jid;
        const [user] = jid.split('@');
        const [number] = user.split(':');
        return `${number}@s.whatsapp.net`;
    }
    static isMe(jid, sock) {
        const myJid = sock.user?.id;
        if (!myJid)
            return false;
        const normJid = this.normalizeJid(jid);
        const normMe = this.normalizeJid(myJid);
        return normJid === normMe;
    }
    static async onConnectionUpdate(businessId, update, sock, onRestart) {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log(`[EventHandler] New QR for ${businessId}`);
            qrcode_terminal_1.default.generate(qr, { small: true });
            await BackendService_1.BackendService.updateQRCode(businessId, qr);
        }
        if (connection === 'close') {
            const errorReason = lastDisconnect?.error?.output?.statusCode;
            console.log(`[EventHandler] Connection closed for ${businessId}: Reason: ${errorReason}`);
            const isLoggedOut = errorReason === baileys_1.DisconnectReason.loggedOut || errorReason === 403;
            if (isLoggedOut) {
                console.log(`[EventHandler] Device logged out for ${businessId}`);
                await BackendService_1.BackendService.updateStatus(businessId, 'disconnected');
                const sessionPath = `${this.sessionsPath}/session-${businessId}`;
                if (fs_1.default.existsSync(sessionPath))
                    fs_1.default.rmSync(sessionPath, { recursive: true, force: true });
            }
            else if (errorReason === baileys_1.DisconnectReason.restartRequired) {
                console.log(`[EventHandler] Restart required for ${businessId}`);
                // Mark not connected immediately so UI doesn't stay stale.
                await BackendService_1.BackendService.updateStatus(businessId, 'pending');
                onRestart(businessId);
            }
            else {
                console.log(`[EventHandler] Connection lost for ${businessId}, will reconnect.`);
                // Mark not connected immediately while transport is down.
                await BackendService_1.BackendService.updateStatus(businessId, 'pending');
            }
        }
        else if (connection === 'open') {
            console.log(`[EventHandler] Connection opened for ${businessId}`);
            await BackendService_1.BackendService.updateStatus(businessId, 'connected');
        }
    }
    static async onContactsUpsert(businessId, contacts) {
        for (const contact of contacts) {
            const name = contact.name || contact.verifiedName || contact.publicName || contact.notify;
            if (name && contact.id) {
                await BackendService_1.BackendService.updateContactName(businessId, this.normalizeJid(contact.id), name, contact.id.endsWith('@g.us'), false);
            }
        }
    }
    static async onMessagesUpsert(businessId, m, sock) {
        if (m.type !== 'notify')
            return;
        for (const msg of m.messages) {
            const remoteJid = msg.key.remoteJid;
            if (!remoteJid)
                continue;
            // Fix self-conversation: Skip messages to/from ourselves
            if (this.isMe(remoteJid, sock)) {
                console.log(`[EventHandler] Skipping self-message to/from ${remoteJid}`);
                continue;
            }
            // Handle Status
            if (remoteJid === 'status@broadcast') {
                const mediaId = await MediaService_1.MediaService.uploadMedia(businessId, msg, sock);
                const content = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    msg.message?.videoMessage?.caption;
                await BackendService_1.BackendService.syncStatus(businessId, {
                    sender: msg.pushName || msg.key.participant || "Unknown",
                    content,
                    mediaId,
                    mediaType: Object.keys(msg.message || {})[0],
                    timestamp: (msg.messageTimestamp || 0) * 1000 || Date.now(),
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
            if (!content && messageType === "text")
                continue;
            if (!content)
                content = `[${messageType}]`;
            let mediaId = undefined;
            if (messageType !== "text" && messageType !== "location") {
                mediaId = await MediaService_1.MediaService.uploadMedia(businessId, msg, sock);
            }
            let groupMetadata = undefined;
            if (isGroup) {
                try {
                    const metadata = await sock.groupMetadata(remoteJid);
                    groupMetadata = {
                        owner: metadata.owner,
                        participants: metadata.participants.map((p) => p.id)
                    };
                }
                catch (e) {
                    // Fail silently for metadata errors
                }
            }
            if (msg.pushName && !msg.key.fromMe) {
                await BackendService_1.BackendService.updateContactName(businessId, this.normalizeJid(remoteJid), msg.pushName, isGroup, false);
            }
            await BackendService_1.BackendService.newMessage(businessId, {
                sender: this.normalizeJid(remoteJid),
                content,
                timestamp: msg.messageTimestamp * 1000 || Date.now(),
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
    static getMessageType(msg) {
        if (msg.message?.imageMessage)
            return "image";
        if (msg.message?.videoMessage)
            return "video";
        if (msg.message?.audioMessage)
            return "audio";
        if (msg.message?.documentMessage)
            return "document";
        if (msg.message?.locationMessage)
            return "location";
        return "text";
    }
    static async onHistorySet(businessId, { chats, contacts, messages }, sock) {
        console.log(`[EventHandler] Received history sync for ${businessId}`);
        const syncData = [];
        const contactMap = new Map();
        const cutoffMs = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
        const messagesByJid = new Map();
        const recentMessages = [];
        for (const message of messages || []) {
            const remoteJid = message?.key?.remoteJid;
            if (!remoteJid || remoteJid === "status@broadcast")
                continue;
            const normalizedJid = this.normalizeJid(remoteJid);
            const timestampMs = (message.messageTimestamp || 0) * 1000;
            if (timestampMs < cutoffMs)
                continue;
            recentMessages.push(message);
            const bucket = messagesByJid.get(normalizedJid) || [];
            bucket.push(message);
            messagesByJid.set(normalizedJid, bucket);
        }
        if (recentMessages.length > MAX_HISTORY_MESSAGES) {
            recentMessages.sort((a, b) => ((b.messageTimestamp || 0) - (a.messageTimestamp || 0)));
            const trimmed = recentMessages.slice(0, MAX_HISTORY_MESSAGES);
            messagesByJid.clear();
            for (const message of trimmed) {
                const jid = this.normalizeJid(message.key.remoteJid);
                const bucket = messagesByJid.get(jid) || [];
                bucket.push(message);
                messagesByJid.set(jid, bucket);
            }
        }
        contacts.forEach((c) => {
            const name = c.name || c.verifiedName || c.publicName || c.notify;
            if (name)
                contactMap.set(this.normalizeJid(c.id), name);
        });
        recentMessages.forEach((m) => {
            if (m.key.remoteJid && m.pushName) {
                const jid = this.normalizeJid(m.key.remoteJid);
                if (!contactMap.has(jid))
                    contactMap.set(jid, m.pushName);
            }
        });
        const contactEntries = Array.from(contactMap.entries());
        for (let i = 0; i < contactEntries.length; i += CONTACT_UPSERT_BATCH_SIZE) {
            const batch = contactEntries.slice(i, i + CONTACT_UPSERT_BATCH_SIZE);
            await Promise.all(batch.map(([jid, name]) => BackendService_1.BackendService.updateContactName(businessId, jid, name, jid.endsWith('@g.us'), false)));
        }
        for (const chat of chats) {
            const jid = this.normalizeJid(chat.id);
            if (!jid || this.isMe(jid, sock))
                continue;
            const isGroup = jid.endsWith('@g.us');
            const name = contactMap.get(jid) || chat.name || (isGroup ? "Group Chat" : undefined);
            const chatMessages = (messagesByJid.get(jid) || [])
                .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
                .slice(-10);
            if (chatMessages.length === 0 && chat.lastMessageRecvTimestamp && (chat.lastMessageRecvTimestamp * 1000) >= cutoffMs) {
                syncData.push({
                    sender: jid,
                    content: "Existing conversation",
                    timestamp: chat.lastMessageRecvTimestamp * 1000,
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
                    timestamp: (msg.messageTimestamp || 0) * 1000 || Date.now(),
                    fromMe: !!msg.key.fromMe,
                    name: name || msg.pushName,
                    isGroup,
                    messageType,
                    whatsappMessageId: msg.key.id
                });
            }
        }
        if (syncData.length > 0) {
            console.log(`[EventHandler] History sync window=${HISTORY_WINDOW_HOURS}h; messages=${syncData.length}; batchSize=${HISTORY_BATCH_SIZE}`);
            for (let i = 0; i < syncData.length; i += HISTORY_BATCH_SIZE) {
                await BackendService_1.BackendService.syncHistory(businessId, syncData.slice(i, i + HISTORY_BATCH_SIZE));
            }
        }
        else {
            console.log(`[EventHandler] No recent history to sync in the last ${HISTORY_WINDOW_HOURS}h for ${businessId}`);
        }
    }
    static async onMessagesUpdate(businessId, updates) {
        for (const update of updates) {
            const { key, update: msgUpdate } = update;
            if (!key.id)
                continue;
            // Handle deletions (Revoke)
            if (msgUpdate.messageStubType === 1 || msgUpdate.protocolMessage?.type === 0) {
                console.log(`[EventHandler] Message revoked/deleted: ${key.id}`);
                await BackendService_1.BackendService.updateMessage(businessId, {
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
                    await BackendService_1.BackendService.updateMessage(businessId, {
                        whatsappMessageId: key.id,
                        content: content
                    });
                }
            }
        }
    }
    static async onMessageReceiptUpdate(businessId, receipts) {
        for (const receipt of receipts) {
            const { key, receipt: r } = receipt;
            // We only care about receipts for statuses (views)
            if (key.remoteJid === 'status@broadcast' && !key.fromMe) {
                const viewerPhone = this.normalizeJid(key.participant || key.remoteJid);
                const whatsappStatusId = key.id;
                console.log(`[EventHandler] Status viewed by ${viewerPhone}: ${whatsappStatusId}`);
                await BackendService_1.BackendService.syncStatusView(businessId, {
                    whatsappStatusId,
                    viewerPhone,
                    timestamp: Date.now()
                });
            }
        }
    }
}
exports.EventHandler = EventHandler;
