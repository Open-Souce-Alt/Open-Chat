import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
  isJidStatusBroadcast,
  isJidGroup,
  isJidNewsletter,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  type PlatformAdapter,
  type PlatformId,
  type AuthStatus,
  type AuthChallenge,
  type NormalizedChat,
  type NormalizedMessage,
} from '../adapter.interface.js';

interface WhatsAppChatInfo {
  id: string;
  name?: string | null | undefined;
  isGroup?: boolean | undefined;
  unreadCount?: number | undefined;
  conversationTimestamp?: number | null | undefined;
  lastMessageRecvTimestamp?: number | null | undefined;
}

export class WhatsAppAdapter implements PlatformAdapter {
  public readonly platformId: PlatformId = 'whatsapp';
  public readonly accountLabel: string;
  private status: AuthStatus = 'idle';
  private sock: WASocket | null = null;
  private isExplicitDisconnect: boolean = false;
  private discoveredChats: Map<string, WhatsAppChatInfo> = new Map();
  private contacts: Map<string, string> = new Map();
  private lidToPn: Map<string, string> = new Map();
  private cachedMessages: Map<string, NormalizedMessage[]> = new Map();
  private chatsUpdatedCallback: (() => void) | null = null;
  private unreadUpdatedCallback: ((externalId: string, count: number) => void) | null = null;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(accountLabel: string = 'personal') {
    this.accountLabel = accountLabel;
  }

  public getStatus(): AuthStatus {
    return this.status;
  }

  public onChatsUpdated(callback: () => void): void {
    this.chatsUpdatedCallback = callback;
  }

  public onChatUnreadUpdated(callback: (externalId: string, unreadCount: number) => void): void {
    this.unreadUpdatedCallback = callback;
  }

  private triggerChatsUpdated(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(() => {
      this.chatsUpdatedCallback?.();
    }, 1200);
  }

  public async startAuth(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string | undefined) => void,
    clean?: boolean | undefined
  ): Promise<void> {
    this.isExplicitDisconnect = false;
    this.status = 'starting';
    onStatus('starting');

    const sessionDir = path.join(os.homedir(), '.openchat', 'sessions', `whatsapp_${this.accountLabel}`);

    if (clean && fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    await this.initSocket(onChallenge, onStatus);
  }

  private async initSocket(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string | undefined) => void
  ): Promise<void> {
    const sessionDir = path.join(os.homedir(), '.openchat', 'sessions', `whatsapp_${this.accountLabel}`);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      // Fetch dynamic WhatsApp Web protocol version to avoid handshake rejection
      // SAFETY: Fallback version matches WhatsApp Web semver tuple [major, minor, patch]
      const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1043857760] as [number, number, number],
      }));

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        // Legitimate WhatsApp Desktop macOS companion device descriptor
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: true, // Enables full history sync for 1-on-1 DMs and contacts
        generateHighQualityLinkPreview: false,
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'awaiting_challenge';
          onStatus('awaiting_challenge');
          onChallenge({
            challengeType: 'qr_code',
            data: qr,
            prompt: 'Scan this QR code with WhatsApp (Settings > Linked Devices)',
            timestamp: Date.now(),
          });
        }

        if (connection === 'open') {
          this.status = 'authenticated';
          onStatus('authenticated');
        } else if (connection === 'close') {
          if (this.isExplicitDisconnect) {
            this.status = 'disconnected';
            onStatus('disconnected');

            return;
          }

          // SAFETY: Boom error object carries output status code
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          if (isLoggedOut || statusCode === DisconnectReason.badSession) {
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }

            this.status = 'disconnected';
            onStatus('disconnected', 'Session expired or logged out by device. Run connect again to pair.');
          } else {
            // Post-pairing handshake: WhatsApp servers close pairing socket with
            // 515 (restartRequired) or 428 (connectionClosed) once keys are saved.
            // Reconnect immediately using the saved creds to complete authentication.
            setTimeout(() => {
              if (!this.isExplicitDisconnect) {
                this.initSocket(onChallenge, onStatus).catch((err) => {
                  console.error('[WhatsApp] Reconnect failed:', err.message);
                });
              }
            }, 600);
          }
        }
      });

      // Capture historical initial data sync (DMs, Groups, Contacts, Messages)
      sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings }) => {
        if (lidPnMappings) {
          for (const m of lidPnMappings) {
            if (m.lid && m.pn) {
              this.lidToPn.set(jidNormalizedUser(m.lid), jidNormalizedUser(m.pn));
            }
          }
        }

        for (const c of contacts) {
          if (!c.id) {
            continue;
          }

          const normId = jidNormalizedUser(c.id);
          const name = c.name || c.notify || c.verifiedName;

          if (name && normId) {
            this.contacts.set(normId, String(name));
          }
        }

        for (const c of chats) {
          if (!c || !c.id) {
            continue;
          }

          const normId = jidNormalizedUser(c.id);

          if (!isJidStatusBroadcast(normId)) {
            // SAFETY: Baileys chat object conforms to WhatsAppChatInfo structure
            this.discoveredChats.set(normId, c as WhatsAppChatInfo);
          }
        }

        for (const m of messages) {
          this.cacheMessage(m);
        }

        this.triggerChatsUpdated();
      });

      // Capture contact updates
      sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
          if (!c.id) {
            continue;
          }

          const normId = jidNormalizedUser(c.id);
          const name = c.name || c.notify || c.verifiedName;

          if (name && normId) {
            this.contacts.set(normId, String(name));
          }
        }

        this.triggerChatsUpdated();
      });

      // Capture chat updates (new conversations)
      sock.ev.on('chats.upsert', (chats) => {
        for (const c of chats) {
          if (!c || !c.id) {
            continue;
          }

          const normId = jidNormalizedUser(c.id);

          if (!isJidStatusBroadcast(normId)) {
            // SAFETY: Baileys chat object conforms to WhatsAppChatInfo structure
            this.discoveredChats.set(normId, c as WhatsAppChatInfo);
          }
        }

        this.triggerChatsUpdated();
      });

      // Capture chat status and unread count updates (e.g. read on mobile app)
      sock.ev.on('chats.update', (updates) => {
        for (const update of updates) {
          if (!update.id) {
            continue;
          }

          const normId = jidNormalizedUser(update.id);
          const existing = this.discoveredChats.get(normId);

          if (update.unreadCount !== undefined && update.unreadCount !== null) {
            const count = Math.max(0, update.unreadCount);

            if (existing) {
              existing.unreadCount = count;
            }

            this.unreadUpdatedCallback?.(normId, count);
          }
        }
      });

      // Capture real-time messages
      sock.ev.on('messages.upsert', ({ messages }) => {
        for (const m of messages) {
          this.cacheMessage(m);
        }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = 'failed';
      onStatus('failed', message);
      throw err;
    }
  }

  private cacheMessage(m: WAMessage): void {
    const text =
      m.message?.conversation ||
      m.message?.extendedTextMessage?.text ||
      m.message?.imageMessage?.caption ||
      '';

    if (!text || !m.key?.remoteJid) {
      return;
    }

    const rawJid = m.key.remoteJid;
    const remoteJid = jidNormalizedUser(rawJid);

    if (!remoteJid || isJidStatusBroadcast(remoteJid)) {
      return;
    }

    // Ensure DM conversation is discovered if message exists
    if (!this.discoveredChats.has(remoteJid)) {
      this.discoveredChats.set(remoteJid, {
        id: remoteJid,
        name: m.pushName || this.contacts.get(remoteJid),
      });
      this.triggerChatsUpdated();
    }

    const senderId = m.key.fromMe ? 'me' : m.key.participant || remoteJid;

    const senderName = m.key.fromMe
      ? 'Me'
      : m.pushName || this.contacts.get(remoteJid) || 'Contact';

    // SAFETY: Baileys WAMessage.messageTimestamp is epoch seconds
    const timestampSec = Number(m.messageTimestamp) || 0;
    const timestampMs = timestampSec > 0 ? timestampSec * 1000 : Date.now();

    const normalized: NormalizedMessage = {
      externalId: m.key.id || String(Date.now()),
      senderId,
      senderName,
      text,
      timestamp: timestampMs,
      status: m.status === 4 ? 'read' : m.status === 3 ? 'delivered' : 'sent',
    };

    const list = this.cachedMessages.get(remoteJid) || [];
    list.push(normalized);
    this.cachedMessages.set(remoteJid, list);
  }

  public async disconnect(): Promise<void> {
    this.isExplicitDisconnect = true;

    if (this.sock) {
      try {
        await this.sock.logout();
        this.sock.end(undefined);
      } catch {
        // ignore disconnect cleanup errors
      }

      this.sock = null;
    }

    this.status = 'disconnected';
  }

  public async listChats(): Promise<NormalizedChat[]> {
    if (!this.sock) {
      throw new Error('WhatsApp client is not authenticated');
    }

    // Fetch active participating groups
    try {
      const groups = await this.sock.groupFetchAllParticipating();

      for (const [id, meta] of Object.entries(groups)) {
        const normId = jidNormalizedUser(id);
        this.discoveredChats.set(normId, {
          id: normId,
          name: meta.subject,
          isGroup: true,
          unreadCount: 0,
        });
      }
    } catch {
      // Group fetch non-critical
    }

    const normalized: NormalizedChat[] = [];

    for (const [id, chat] of this.discoveredChats.entries()) {
      if (isJidStatusBroadcast(id)) {
        continue;
      }

      const isGroup = isJidGroup(id) || chat.isGroup;
      const isChannel = isJidNewsletter(id);
      let chatType: NormalizedChat['chatType'] = 'direct_message';

      if (isGroup) {
        chatType = 'group';
      } else if (isChannel) {
        chatType = 'channel';
      }

      // Contact name resolution
      let title = chat.name;

      if (!title) {
        title = this.contacts.get(id);
      }

      if (!title && this.lidToPn.has(id)) {
        const pn = this.lidToPn.get(id)!;
        title = this.contacts.get(pn) || (pn.split('@')[0] ? `+${pn.split('@')[0]}` : undefined);
      }

      if (!title) {
        title = isGroup ? 'WhatsApp Group' : id.split('@')[0] || 'Unknown Contact';
      }

      // Extract conversation timestamp (seconds to milliseconds)
      let lastMessageTimestamp: number | undefined = undefined;
      const rawTimestamp = chat.conversationTimestamp || chat.lastMessageRecvTimestamp;

      if (rawTimestamp) {
        const num = Number(rawTimestamp);

        if (!Number.isNaN(num) && num > 0) {
          lastMessageTimestamp = num > 10000000000 ? num : num * 1000;
        }
      }

      normalized.push({
        externalId: id,
        platform: this.platformId,
        title,
        chatType,
        unreadCount: chat.unreadCount || 0,
        lastMessageTimestamp,
        metadata: {
          isGroup: !!isGroup,
          id: String(id),
        },
      });
    }

    return normalized;
  }

  public async fetchRecentMessages(
    externalChatId: string,
    limit: number = 20
  ): Promise<NormalizedMessage[]> {
    const normId = jidNormalizedUser(externalChatId);
    const cached = this.cachedMessages.get(normId) || [];

    return cached.slice(-limit);
  }
}
