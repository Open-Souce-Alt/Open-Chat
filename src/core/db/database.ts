import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { DDL_SCHEMA } from './schema.js';

export function getDatabasePath(): string {
  if (process.env.OPENCHAT_DB_PATH) {
    return process.env.OPENCHAT_DB_PATH;
  }
  const baseDir = path.join(os.homedir(), '.openchat');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return path.join(baseDir, 'openchat.db');
}

export function initDatabase(dbPath?: string): DatabaseType {
  const resolvedPath = dbPath || getDatabasePath();
  const dbDir = path.dirname(resolvedPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(resolvedPath);

  // Enable WAL mode and foreign keys for high performance and integrity
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute schema DDL
  db.exec(DDL_SCHEMA);

  // Run initial seed if root directory does not exist
  seedInitialData(db);

  return db;
}

function seedInitialData(db: DatabaseType): void {
  const rootCheck = db.prepare('SELECT id FROM directories WHERE id = ?').get('root');
  if (rootCheck) {
    return; // Already initialized
  }

  const now = Date.now();

  const seedTransaction = db.transaction(() => {
    // 1. Root directory
    db.prepare(`
      INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('root', '', null, 1, 0, now);

    // 2. Default user directories
    db.prepare(`
      INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('dir_personal', 'Personal', 'root', 0, 0, now);

    db.prepare(`
      INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('dir_work', 'Work', 'root', 0, 0, now);

    // 3. System account
    db.prepare(`
      INSERT INTO accounts (id, platform_id, label, status, session_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('acc_system', 'system', 'Open Chat System', 'active', null, now);

    // 4. Welcome chat node
    db.prepare(`
      INSERT INTO chats (id, account_id, external_id, title, chat_type, metadata, unread_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('chat_welcome', 'acc_system', 'system:welcome', 'Welcome to Open Chat', 'direct_message', null, 0, now, now);

    // 5. Welcome messages
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, chat_id, sender_id, sender_name, text, timestamp, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertMsg.run(
      'msg_welcome_1',
      'chat_welcome',
      'system',
      'Open Chat Bot',
      'Welcome to Open Chat! A unified, distraction-free chat aggregator.',
      now - 3000,
      'read',
      null
    );

    insertMsg.run(
      'msg_welcome_2',
      'chat_welcome',
      'system',
      'Open Chat Bot',
      'In this system, chats are treated as files inside a virtual filesystem.',
      now - 2000,
      'read',
      null
    );

    insertMsg.run(
      'msg_welcome_3',
      'chat_welcome',
      'system',
      'Open Chat Bot',
      `Available commands:
  ls [-l] [-a] [path]  - List directories and chat files
  cd <path>            - Change virtual directory
  pwd                  - Print current virtual directory
  mkdir [-p] <path>    - Create a new virtual directory
  rmdir <path>         - Remove an empty directory
  cat <chat_file>      - Read messages in a chat
  ln [-s] <src> <dest> - Create pointer to chat in target folder
  rm <chat_pointer>    - Delete pointer (preserves canonical chat)
  help                 - Display command help
  exit                 - Exit shell`,
      now - 1000,
      'read',
      null
    );

    // 6. Root pointer to welcome.dm
    db.prepare(`
      INSERT INTO chat_pointers (id, directory_id, chat_id, pointer_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('ptr_welcome', 'root', 'chat_welcome', 'welcome.dm', now);
  });

  seedTransaction();
}
