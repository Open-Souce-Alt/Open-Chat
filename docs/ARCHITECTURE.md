# System Architecture

## 1. System Objective & Roadmap
Open Chat aggregates messaging platforms into a single interface.
The system removes feed algorithms and social engagement features to isolate chat communications.
Initial host operating system: macOS.

### 1.1 Phased Delivery Roadmap
- **Phase 1 (Current)**:
  - Independent TypeScript aggregation engine daemon.
  - Interactive Terminal / CLI client for validation, testing, and operations.
- **Phase 2 (Subsequent)**:
  - Native macOS GUI application built in Swift.
  - Extensible community UI frontends.

---

## 2. Two-Tier System Architecture

```
+-------------------------------------------------------------+
| Client Layer (Presentation Only)                            |
| - Phase 1: CLI Client                                       |
| - Phase 2: Native macOS Swift App / Third-Party Frontends    |
+-------------------------------------------------------------+
                              |
                              | HTTP (REST) + WebSocket
                              | Configurable Backend URL
                              v
+-------------------------------------------------------------+
| Core Aggregation Engine (Independent Standalone Daemon)     |
| - Language: TypeScript (Node.js runtime)                    |
| - Platform integrations (WhatsApp, Telegram, etc.)         |
| - Data normalization & SQLite persistence                   |
| - Virtual filesystem DAG & pointer engine                   |
| - Host: Local macOS or remote VPS / Cloud                   |
+-------------------------------------------------------------+
```

### 2.1 Aggregation Engine (Backend Daemon)
- **Runtime**: Independent process decoupled from UI lifecycles. Can execute locally on macOS or be hosted remotely on a Linux/macOS VPS.
- **Integration Strategy**:
  - Phase 1: Wrap established 3rd-party integration libraries (e.g., `@wppconnect-team/wppconnect`).
  - Phase 2: Gradually replace 3rd-party dependencies with custom in-house extensions.
- **Responsibility**:
  - Connect to external chat platforms via integration modules.
  - Normalize incoming chat payloads into uniform data structures.
  - Expose HTTP + WebSocket endpoints for consumers.
  - Maintain message state and reference mappings.

### 2.2 Client Layer (Frontend Consumers)
- **Decoupling**:
  - Connects to the engine using a configurable backend base URL (e.g., `http://localhost:3000` or `https://remote-vps:3000`).
  - Pure presentation layer with zero direct database (SQLite) access.
- **Form Factors**:
  - Phase 1: CLI application (Node / TypeScript).
  - Phase 2: Native macOS application (Swift).

---

## 3. Data Representation Model (Virtual Filesystem)

The system organizes chats using a virtual filesystem paradigm inspired by macOS Finder.
This hierarchy is an internal database abstraction, not physical files or directories on macOS disk.
The relationship between directories and chats is a **many-to-many Directed Acyclic Graph (DAG)**.

### 3.1 Entities
- **Account Node**: 
  - Represents an authenticated user profile/session on a platform (e.g., WhatsApp Personal, WhatsApp Work, Telegram Personal).
  - The system supports connecting multiple accounts for the same platform concurrently.
- **Chat Node ("Canonical File")**: 
  - Represents an atomic, platform-independent conversation unit tied to an `Account`.
  - Carries a **Chat Type** analogous to a "file extension" (e.g., `direct_message`, `group`, `channel`, `broadcast_list`, `thread`).
  - Holds reference to origin account/adapter, but UI/shell treats operations uniformly.
- **Directory ("Folder / Category")**: 
  - Represents an organizational container. Directories can be nested to arbitrary depths (`/Work/Q3/Clients`).
  - Directories can be moved (`mv`), renamed, or duplicated (`cp -r`).
  - Copying a directory duplicates the directory node and clones all chat pointer edges into the new directory.
  - User-created directories are **heterogeneous**: they can hold pointers to chats from different platforms and accounts side-by-side (e.g., `/Projects` contains a WhatsApp Work group, a WhatsApp Personal chat, and an Instagram DM).
- **Chat Pointer ("Symlink")**: 
  - An edge linking a `Directory` to a canonical `Chat Node`.

### 3.2 Pointer Reference Model (Many-to-Many)
- **Multi-Directory & Cross-Platform Inclusion**: 
  - A single chat can exist in multiple user directories simultaneously.
  - Directories aggregate cross-platform chats arbitrarily based solely on user intent.
- **No Data Duplication**: Placing a chat into multiple directories creates multiple pointers to one canonical chat record. Messages and state are stored once.
- **Shared State Propagation**: Any status update (new message, read receipt, draft) on a chat immediately reflects across all directories referencing that chat.
- **Hierarchical Unread Bubble-Up**:
  - When a chat node receives an unread message, its unread counter increments.
  - Every directory containing a pointer to that chat inherits the unread count.
  - Unread counters recursively bubble up to ancestor directories (e.g., if `/Work/Clients/alex.dm` has 3 unread messages, `ls /` shows `Work/ (3)` and `ls /Work` shows `Clients/ (3)`).
- **Read Receipts Policy**:
  - Outbound read receipts to third-party platforms are optional/configurable (supporting stealth reading).
  - Outbound receipt synchronization is deferred from Phase 1 scope.
- **Reference Lifecycle and Deletions**:
  - Removing a chat from a custom user directory destroys that specific pointer only.
  - The canonical chat and all other directory pointers to it remain unaffected.
  - Deleting a directory removes the directory and its pointer edges; underlying chats remain untouched.

### 3.3 Integration Hierarchy vs. User Directories
- **Platform Account Root Directories (Immutable Archives)**:
  - Connecting an account generates an immutable system root directory named with a leading dot and the account identifier (e.g., `/.whatsapp-personal/` or `/.whatsapp-work/`).
  - Scoped strictly to that specific account.
  - Dot-prefixed by default so `ls /` displays only curated user workspaces (`/Personal`, `/Work`).
  - Marked `is_system_root = 1`: protected from deletion (`rmdir`), moving (`mv`), or unlinking. Discovered chats automatically receive a permanent pointer here.
- **User Directories (Cross-Platform Workspaces)**:
  - Created, renamed, structured, and deleted freely by user.
  - Free from platform or account silos.
- **Directory Visibility (Dot Prefix Convention)**:
  - Hidden directories follow the standard Unix dot-prefix naming convention (e.g., `.whatsapp-personal/`).
  - By default, hidden directories are omitted from standard `ls` output.
  - Passing `-a` or `-la` to `ls` reveals hidden directories.

### 3.4 Seeded Initial Hierarchy (Fresh Install)
When the SQLite database is initialized for the first time without any connected accounts, the engine automatically provisions a starter filesystem:
- `/Personal/`: Empty user directory for personal contacts.
- `/Work/`: Empty user directory for professional communications.
- `/welcome.dm`: An internal canonical system chat node containing onboarding instructions, quickstart commands (`connect whatsapp`, `ls -a`, `help`), and project principles.

### 3.5 Naming Conventions & Conflict Resolution
- **Visual File Extensions**:
  - Chat nodes display pseudo-extensions (e.g., `alex.dm`, `backend-team.group`, `announcements.channel`).
  - Extensions serve solely as visual disambiguation hints for monochrome shells and human/agent readability.
  - Functional chat characteristics (participants, permissions, capabilities) are stored strictly inside canonical chat metadata in SQLite.
- **Collision Disambiguation**:
  - Unique naming within a directory is enforced using numeric suffixes:
    - First collision: `alex-2.dm`
    - Second collision: `alex-3.dm`
    - Groups: `standup.group`, `standup-2.group`
- **Sanitization**:
  - Raw platform titles (emojis, slashes, whitespace) are normalized into valid virtual path slugs while preserving the original human display title in database metadata.

---

## 4. Storage and Data Pipeline

```
[External Platform] (WhatsApp, Instagram, etc.)
      ^            |
      | (Outbound) | (Inbound)
      |            v
[Platform Adapter] (TypeScript)
      ^            |
      |            v (Normalization)
[Local SQLite DB] (Canonical store + virtual hierarchy)
      ^            |
      |            v (HTTP REST + WebSocket)
[Client Layer] (Phase 1: CLI Shell / Phase 2: Swift GUI)
```

### 4.1 Storage Engine
- **Engine**: SQLite via native C/C++ SQLite3 engine (`better-sqlite3`).
- **Location**: On-device local storage (`~/.openchat/openchat.db`).
- **Driver Rationale**: Direct official SQLite engine binding; high-performance synchronous execution without query latency overhead.
- **Core Entities**:
  - `accounts`: Authenticated sessions (id, platform_id, label, session_data, status).
  - `chats`: Canonical conversation threads (id, account_id, external_id, title, type, metadata).
  - `messages`: Canonical chat messages (id, chat_id, sender_id, text, timestamp, status).
  - `directories`: Virtual filesystem directories (id, name, parent_id, is_system_root, is_hidden).
  - `chat_pointers`: Junction edges linking directories to chats (id, directory_id, chat_id, custom_name).
- **Media Asset Storage (Phase 2)**:
  - Binary media (images, voice notes, video, documents) will be stored on local disk under `~/.openchat/media/`.
  - SQLite stores local relative file path and MIME metadata.
  - **Phase 1 Scope**: Strictly text messages. Media rendering and download deferred.

### 4.2 Inbound Flow (Ingestion)
1. Dedicated platform adapter receives updates (real-time stream or backfill sync).
2. Adapter normalizes payload into standard Open Chat entity schema.
3. Engine writes entities to SQLite and associates new chat pointers with the integration root directory.
4. Engine emits a WebSocket event to notify clients of new messages or chats.

### 4.3 Outbound Flow (Egress / Bidirectional Action)
1. User composes a message or triggers an action in the CLI or UI.
2. Client sends an HTTP POST request or WebSocket action to the TypeScript engine.
3. Engine creates a pending message record in SQLite and broadcasts the event to clients (optimistic state).
4. Relevant platform adapter translates and transmits the message to the external service.
5. Adapter updates message status in SQLite (sent, delivered, failed) and broadcasts updates via WebSocket.

### 4.4 Sync & Backfill Strategy
- **Chat Node Discovery (Complete Sync)**:
  - When an adapter connects, it performs a complete sync of all available conversation threads (direct messages, groups, announcement channels).
  - Every discovered chat receives a canonical entry in SQLite and a pointer in the platform's root directory (`/whatsapp`).
  - Ensures the user has an exhaustive directory listing of contacts and groups immediately.
- **Message Ingestion (Shallow Sync + Lazy Backfill)**:
  - Initial connection ingests only recent messages (e.g., last 20–50 messages per chat) to conserve bandwidth, memory, and avoid platform rate limits.
  - Older messages are fetched on-demand (lazy backfill) when the client requests pagination beyond cached history (`cat --page`, scrolling up in UI).
- **Live Stream**:
  - Once connected, real-time message events are appended immediately to SQLite and broadcast via WebSocket.

---

## 5. Interface & API Boundary

- **Ownership**: The TypeScript engine holds exclusive ownership of SQLite connections, migrations, and platform adapter sessions.
- **Server Framework**: Fastify + WebSocket (`@fastify/websocket`) — chosen for minimal overhead, schema validation, and industry-standard adoption.
- **Protocol Suite**:
  - **HTTP (REST)**: Request-response operations (fetch tree, create directory, fetch chat page, submit outbound message).
  - **WebSocket**: Bidirectional real-time stream (incoming messages, delivery/read updates, live auth challenges, sync state).
- **Network Topologies Supported**:
  - Local mode: Engine and client run on the same macOS machine via loopback (`127.0.0.1:3000`).
  - Remote mode: Engine runs on a VPS / cloud server; client connects over secure HTTP/WS with configurable endpoint URL.
- **Capabilities required over API**:
  - **Directory/Tree Operations**: List tree, create folder, move pointer, hide folder.
  - **Chat Operations**: Fetch message page, mark read, post message.
  - **Event Streaming**: Push new messages, connection status changes, and sync status in real time.

---

## 6. Authentication Architecture

Different messaging platforms require distinct authentication mechanisms (QR code, SMS OTP, credentials, OAuth).
The engine abstracts platform specifics through a unified state machine.

```
+--------------------+      WebSocket Event          +--------------------+
|  Platform Adapter  |  -------------------------->  |    Client Layer    |
| (wppconnect, etc.) |  <--------------------------  | (CLI REPL / Swift) |
+--------------------+     HTTP / WS Action          +--------------------+
```

### 6.1 Normalized Auth Challenge Model
The engine pushes a normalized challenge payload across WebSocket:
- `challengeType`:
  - `qr_code`: Transmits raw base64/ASCII QR code for UI rendering.
  - `otp_input`: Transmits prompt for one-time passcode (SMS/Email/Authenticator).
  - `credentials`: Requests username/password or token input.
  - `web_view_url`: Requests OAuth/SSO login via embedded or external browser.
- `status`: `IDLE` | `PENDING_CHALLENGE` | `AUTHENTICATING` | `AUTHENTICATED` | `FAILED`.

### 6.2 Auth Flow
1. Client invokes `auth:connect(platformId)` via API.
2. Engine starts adapter; adapter emits challenge (e.g., QR string).
3. Engine normalizes challenge and pushes to client via WebSocket / HTTP event.
4. Client displays the challenge corresponding to `challengeType` (e.g., ASCII QR in terminal or native Swift view).
5. Client submits user input (or user scans QR on external device).
6. Adapter establishes session, stores tokens securely, and emits `AUTHENTICATED`.

---

## 7. Phase 1 CLI Client: Virtual Unix Shell

The Phase 1 frontend is an interactive virtual shell / REPL.
It provides a familiar paradigm for human users and AI agents to navigate the virtual filesystem.

### 7.1 Virtual Command Mappings
| Command | Arguments | Behavior |
|---|---|---|
| `ls` | `[-l] [-a] [path]` | List virtual directories and chat files. `-a` reveals dot-prefixed hidden directories (`.folder/`). Shows unread badges and timestamps. |
| `cd` | `<path>` | Navigate virtual filesystem (`/`, `..`, relative, absolute paths). |
| `pwd` | None | Display current virtual directory path. |
| `mkdir` | `[-p] <path>` | Create a new virtual directory (supports nested paths). |
| `rmdir` | `<path>` | Delete an empty virtual directory. |
| `cp` | `-r <source_dir> <dest_dir>` | Duplicate a directory tree and clone its chat pointer edges. (Note: `cp` on individual chat files is prohibited; use `ln`). |
| `mv` | `<source_path> <dest_path>` | Move or rename a directory or chat pointer. |
| `ln` | `[-s] <source_chat> <dest_dir>` | Create a new pointer (symlink) to an existing chat inside target directory. |
| `rm` | `<chat_pointer>` | Remove pointer from current/target directory. Underlying chat in platform root remains intact. |
| `cat` | `<chat_file>` | Print message history of a chat. Supports pagination / limits. |
| `tail` | `[-f] <chat_file>` | Follow/stream new incoming and outgoing messages in real time via WebSocket. |
| `send` | `<chat_file> "<text>"` | Dispatch an outbound message to the external platform. |
| `connect` | `<platform>` | Initiate normalized authentication session (renders ASCII QR code in terminal). |
| `status` | None | Display adapter connection states, active sync workers, and backend health. |

