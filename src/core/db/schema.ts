export type PlatformId = 'whatsapp' | 'system';

export interface AccountRow {
  id: string;
  platform_id: PlatformId;
  label: string;
  status: string;
  session_data: string | null;
  created_at: number;
}

export interface ChatRow {
  id: string;
  account_id: string;
  platform_id: PlatformId;
  external_id: string;
  title: string;
  chat_type: "direct_message" | "group" | "channel" | "broadcast_list";
  metadata: string | null;
  unread_count: number;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  timestamp: number;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  metadata: string | null;
}

export interface DirectoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  is_system_root: number; // 0 or 1
  is_hidden: number;      // 0 or 1
  created_at: number;
}

export interface ChatPointerRow {
  id: string;
  directory_id: string;
  chat_id: string;
  pointer_name: string;
  created_at: number;
}

export const DDL_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  session_data TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  platform_id TEXT NOT NULL DEFAULT 'whatsapp',
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  metadata TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'read',
  metadata TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS directories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  is_system_root INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES directories(id) ON DELETE CASCADE,
  UNIQUE(parent_id, name)
);

CREATE TABLE IF NOT EXISTS chat_pointers (
  id TEXT PRIMARY KEY,
  directory_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  pointer_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (directory_id) REFERENCES directories(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  UNIQUE(directory_id, pointer_name)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pointers_dir ON chat_pointers(directory_id);
CREATE INDEX IF NOT EXISTS idx_directories_parent ON directories(parent_id);
`;
