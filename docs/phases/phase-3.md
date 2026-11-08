# Phase 3: Normalized Auth & WhatsApp Adapter Discovery Sync

## 1. Objective
Implement the platform adapter layer and normalized authentication state machine:
1. Connect external chat services starting with WhatsApp via native protocol WebSockets (`@whiskeysockets/baileys`).
2. Stream normalized auth challenges (ASCII QR code) across WebSocket to the CLI client.
3. Upon authentication, automatically generate the immutable hidden system archive root (`/.whatsapp-personal/`).
4. Perform complete chat discovery sync (all contacts and groups) and shallow message sync into SQLite.

---

## 2. Architecture & Boundary Flow

```
+-------------------------------------------------------------------------+
| CLI Client                                                              |
| - Command: `connect whatsapp [accountLabel]`                            |
| - Listens on WebSocket for `auth:challenge` & renders ASCII QR in term  |
+-------------------------------------------------------------------------+
                                    |
                                    | HTTP POST /api/auth/connect
                                    | WebSocket (/ws)
                                    v
+-------------------------------------------------------------------------+
| Fastify Core Engine Daemon                                              |
| - Normalized Auth State Machine (IDLE -> CHALLENGE -> AUTHENTICATED)    |
| - WhatsApp Adapter (Baileys WebSocket socket + mock mode for testing)   |
+-------------------------------------------------------------------------+
                                    |
                                    | Discovery Sync (Contacts & Groups)
                                    v
+-------------------------------------------------------------------------+
| SQLite Store (~/.openchat/openchat.db)                                  |
| - `accounts`: Stores session metadata and token pointers                |
| - `directories`: Provisions `/.whatsapp-<label>/` (is_system_root = 1)   |
| - `chats`: Canonical chat nodes for every discovered conversation       |
| - `chat_pointers`: Links all chats into `/.whatsapp-<label>/`           |
| - `messages`: Shallow sync of recent message history (last 20 messages) |
+-------------------------------------------------------------------------+
```

---

## 3. Detailed Deliverables

### 3.1 Dependencies
- Install: `@whiskeysockets/baileys`, `pino`, `qrcode-terminal`
- Remove: `@wppconnect-team/wppconnect`
- Dev dependencies: `@types/qrcode-terminal`

### 3.2 Normalized Auth State Machine (`src/core/auth/`)
- **State Definition**:
  - `IDLE` | `STARTING` | `AWAITING_CHALLENGE` | `AUTHENTICATED` | `FAILED` | `DISCONNECTED`
- **NormalizedChat Model**:
  - `externalId`: string
  - `platform`: `PlatformId` (`'whatsapp' | 'system'`)
  - `title`: string (human-readable contact/group name)
  - `chatType`: `'direct_message' | 'group' | 'channel' | 'broadcast_list'`
  - `unreadCount`: number
  - `lastMessageTimestamp`: number | undefined
  - `metadata`: Record<string, any>
- **Adapter Interface (`src/integrations/adapter.interface.ts`)**:
  - `platformId`: string (e.g. `'whatsapp'`)
  - `startAuth(accountLabel: string, onChallenge: (c: AuthChallenge) => void): Promise<void>`
  - `disconnect(accountLabel: string): Promise<void>`
  - `listChats(): Promise<NormalizedChat[]>`
  - `fetchRecentMessages(externalChatId: string, limit: number): Promise<NormalizedMessage[]>`

### 3.3 WhatsApp Adapter (`src/integrations/whatsapp/`)
- **Real Adapter (`@whiskeysockets/baileys`)**:
  - Connects directly to WhatsApp servers via WebSocket using the Noise protocol and Protocol Buffers.
  - Multi-file auth state stored locally in `~/.openchat/sessions/whatsapp_<accountLabel>/`.
  - Captures raw QR string from `connection.update` and emits normalized `qr_code` challenge.
  - Registers legitimately as a companion device (e.g. `['Open Chat', 'macOS', '1.0.0']`), eliminating headless browser bot flags and avoiding device session revocation.
  - Implements automatic post-pairing reconnect loop: when WhatsApp closes the initial pairing socket (`restartRequired: 515`), the adapter automatically re-initializes using the newly written credentials to transition to `authenticated`.
  - Maps WhatsApp anonymous `@lid` identifiers to phone numbers via `lidPnMappings` to resolve human-readable contact address book names.
  - On `connection === 'open'`, assigns socket, initiates history sync, and triggers continuous discovery sync as DMs stream in.
- **Mock/Test Adapter (`mock-whatsapp`)**:
  - Deterministic fixture adapter for automated tests and offline development.
  - Emits sample QR, simulates instant scan, and loads realistic chat fixtures.

### 3.4 Ingestion & Discovery Sync Engine (`src/core/sync/`)
- On successful authentication:
  1. Records or updates `accounts` record (`status: 'active'`).
  2. Ensures system archive root exists: `/.<platform>-<accountLabel>/` with `is_system_root = 1`, `is_hidden = 1`.
  3. Fetches all conversation threads via adapter.
  4. Inserts canonical `chats` rows.
  5. Inserts permanent `chat_pointers` in `/.<platform>-<accountLabel>/`.
  6. Shallow-syncs the latest 20 messages for each chat into `messages`.
  7. Continuous Sync (`onChatsUpdated`): As the mobile phone streams additional history sync chunks and 1-on-1 DMs, updates SQLite and VFS pointers live.
  8. Live Read Receipt Sync (`onChatUnreadUpdated`): Captures `chats.update` from mobile device to reset unread counters to 0 live.
  9. Broadcasts WebSocket events:
     - `auth:status`: `{ status: 'authenticated', accountId }`
     - `vfs:change`: `{ action: 'mkdir', path: '/.whatsapp-personal' }`
     - `sync:complete`: `{ accountId, chatCount, messageCount }`

### 3.5 API Endpoints (`src/server/routes/auth.ts`)
- `POST /api/auth/connect`: `{ platform: string, accountLabel?: string, mock?: boolean }`
- `GET /api/auth/status`: `?accountId=...`
- `POST /api/auth/disconnect`: `{ accountId: string }`

### 3.6 CLI Client Integration (`src/cli/`)
- Add `connect <platform> [label] [--clean]` command to virtual shell REPL.
- Add `status` command to display connected platform accounts and health.
- Add Tab Autocompletion for commands, directory navigation, and chat files.
- Add Default Sorting to `ls`: sorts by descending last message time (most recent first); supports `-n` (by name), `-t` (by time), `-r` (reverse).
- When `auth:challenge` event arrives with `challengeType: 'qr_code'`:
  - Print terminal-friendly ASCII QR code.
  - Instruct user: *"Scan this QR code with your WhatsApp mobile app (Settings > Linked Devices)"*.

---

## 4. Manual Verification Steps (User Acceptance Criteria)

1. **Start Daemon**:
   ```bash
   npm run daemon
   ```
2. **Launch CLI**:
   ```bash
   npm run cli
   ```
3. **Trigger Auth**:
   ```text
   openchat:/$ connect whatsapp personal
   ```
   - Terminal renders ASCII QR code.
4. **Scan or Mock Complete**:
   - Status updates: `[Live Event] Authenticated whatsapp (personal)! 15 chats synced.`
5. **Inspect System Archive Root**:
   - `openchat:/$ ls` -> Shows `/Personal` and `/Work` (system archive is hidden).
   - `openchat:/$ ls -a` -> Shows `/.whatsapp-personal/`.
   - `openchat:/$ ls -la /.whatsapp-personal` -> Lists all discovered WhatsApp contacts and groups with visual extensions (`.dm`, `.group`) and `[system archive]` label.
6. **Read Messages**:
   - `openchat:/$ cat /.whatsapp-personal/<contact>.dm` -> Displays the last 20 messages.
