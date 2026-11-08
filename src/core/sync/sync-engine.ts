import { type Database } from 'better-sqlite3';
import { type PlatformAdapter, type NormalizedChat } from '../../integrations/adapter.interface.js';
import { type EventBroadcaster } from '../../server/events.js';
import { randomUUID } from 'crypto';

function sanitizeSlug(title: string, fallbackId?: string): string {
  const clean = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  if (clean) {
    return clean;
  }

  if (fallbackId) {
    const num = fallbackId.split('@')[0]?.replace(/\D/g, '');

    if (num) {
      return `contact-${num}`;
    }
  }

  return 'unnamed-chat';
}

function getExtension(chatType: NormalizedChat['chatType']): string {
  switch (chatType) {
    case 'direct_message':
      return '.dm';
    case 'group':
      return '.group';
    case 'channel':
      return '.channel';
    case 'broadcast_list':
      return '.broadcast';
    default:
      return '.chat';
  }
}

export class SyncEngine {
  private db: Database;
  private broadcaster: EventBroadcaster;

  constructor(db: Database, broadcaster: EventBroadcaster) {
    this.db = db;
    this.broadcaster = broadcaster;
  }

  public async runDiscoverySync(adapter: PlatformAdapter): Promise<{
    accountId: string;
    systemRootDir: string;
    chatCount: number;
    messageCount: number;
  }> {
    const now = Date.now();
    const accountId = `acc_${adapter.platformId}_${adapter.accountLabel}`;
    const systemDirName = `.${adapter.platformId}-${adapter.accountLabel}`;

    // 1. Upsert account record
    this.db
      .prepare(
        `
      INSERT INTO accounts (id, platform_id, label, status, session_data, created_at)
      VALUES (?, ?, ?, 'active', NULL, ?)
      ON CONFLICT(id) DO UPDATE SET status = 'active'
    `
      )
      .run(accountId, adapter.platformId, adapter.accountLabel, now);

    // 2. Ensure system root directory exists in root
    // SAFETY: Query selects directory id
    let rootDir = this.db
      .prepare('SELECT id FROM directories WHERE parent_id = ? AND name = ?')
      .get('root', systemDirName) as { id: string } | undefined;

    let rootDirId = rootDir?.id;

    if (!rootDirId) {
      rootDirId = 'dir_' + randomUUID().replace(/-/g, '').slice(0, 12);
      this.db
        .prepare(
          `
        INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
        VALUES (?, ?, 'root', 1, 1, ?)
      `
        )
        .run(rootDirId, systemDirName, now);
    }

    // 3. Fetch all chats from adapter
    const discoveredChats = await adapter.listChats();
    let totalMessages = 0;

    // Cache existing pointer names in system root to avoid collisions
    // SAFETY: Query selects pointer_name and chat_id
    const existingPointers = this.db
      .prepare('SELECT pointer_name, chat_id FROM chat_pointers WHERE directory_id = ?')
      .all(rootDirId) as { pointer_name: string; chat_id: string }[];

    const pointerNameMap = new Set(existingPointers.map((p) => p.pointer_name));
    const chatIdToPointerMap = new Map(existingPointers.map((p) => [p.chat_id, p.pointer_name]));

    for (const chat of discoveredChats) {
      const initialActivity = chat.lastMessageTimestamp || 0;

      // Upsert canonical chat
      // SAFETY: Query selects id and updated_at
      let chatRow = this.db
        .prepare('SELECT id, updated_at FROM chats WHERE account_id = ? AND external_id = ?')
        .get(accountId, chat.externalId) as { id: string; updated_at: number } | undefined;

      let canonicalChatId = chatRow?.id;
      const platformId = chat.platform || adapter.platformId;

      if (!canonicalChatId) {
        canonicalChatId = 'chat_' + randomUUID().replace(/-/g, '').slice(0, 12);
        this.db
          .prepare(
            `
          INSERT INTO chats (id, account_id, platform_id, external_id, title, chat_type, metadata, unread_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            canonicalChatId,
            accountId,
            platformId,
            chat.externalId,
            chat.title,
            chat.chatType,
            chat.metadata ? JSON.stringify(chat.metadata) : null,
            chat.unreadCount,
            now,
            initialActivity
          );
      } else {
        // Update unread count, platform, and title, and update timestamp if chat reported a newer activity
        if (chat.lastMessageTimestamp) {
          this.db
            .prepare(
              `
            UPDATE chats
            SET title = ?, platform_id = ?, unread_count = ?, updated_at = MAX(updated_at, ?)
            WHERE id = ?
          `
            )
            .run(chat.title, platformId, chat.unreadCount, chat.lastMessageTimestamp, canonicalChatId);
        } else {
          this.db
            .prepare(
              `
            UPDATE chats
            SET title = ?, platform_id = ?, unread_count = ?
            WHERE id = ?
          `
            )
            .run(chat.title, platformId, chat.unreadCount, canonicalChatId);
        }
      }

      // Check if pointer exists in system archive
      if (!chatIdToPointerMap.has(canonicalChatId)) {
        const slug = sanitizeSlug(chat.title, chat.externalId);
        const ext = getExtension(chat.chatType);
        let chosenName = `${slug}${ext}`;

        if (pointerNameMap.has(chosenName)) {
          let counter = 2;

          while (pointerNameMap.has(`${slug}-${counter}${ext}`)) {
            counter++;
          }

          chosenName = `${slug}-${counter}${ext}`;
        }

        const ptrId = 'ptr_' + randomUUID().replace(/-/g, '').slice(0, 12);
        this.db
          .prepare(
            `
          INSERT INTO chat_pointers (id, directory_id, chat_id, pointer_name, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
          )
          .run(ptrId, rootDirId, canonicalChatId, chosenName, now);

        pointerNameMap.add(chosenName);
        chatIdToPointerMap.set(canonicalChatId, chosenName);
      }

      // 4. Shallow sync recent messages (latest 20)
      const recentMessages = await adapter.fetchRecentMessages(chat.externalId, 20);

      const insertMsg = this.db.prepare(`
        INSERT OR IGNORE INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, status, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const msg of recentMessages) {
        const msgId = `msg_${accountId}_${msg.externalId}`;

        const result = insertMsg.run(
          msgId,
          canonicalChatId,
          msg.senderId,
          msg.senderName,
          msg.text,
          msg.timestamp,
          msg.status,
          msg.metadata ? JSON.stringify(msg.metadata) : null
        );

        if (result.changes > 0) {
          totalMessages++;
        }
      }

      // Update chat's updated_at to the latest message timestamp if messages exist
      if (recentMessages.length > 0) {
        const maxMsgTime = Math.max(...recentMessages.map((m) => m.timestamp));

        if (maxMsgTime > 0) {
          this.db
            .prepare('UPDATE chats SET updated_at = MAX(updated_at, ?) WHERE id = ?')
            .run(maxMsgTime, canonicalChatId);
        }
      }
    }

    // Broadcast completion events
    this.broadcaster.broadcastVfsChange('mkdir', `/${systemDirName}`);
    this.broadcaster.broadcast({
      type: 'vfs:change',
      action: 'mkdir',
      path: `/${systemDirName}`,
      timestamp: Date.now(),
    });

    return {
      accountId,
      systemRootDir: `/${systemDirName}`,
      chatCount: discoveredChats.length,
      messageCount: totalMessages,
    };
  }
}
