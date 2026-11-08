# Phase 1: Engine Daemon & Virtual Unix Shell REPL

## 1. Objective
Deliver a functioning, two-tier text messaging aggregator consisting of:
1. An independent TypeScript engine daemon backed by SQLite and Fastify (HTTP + WebSocket).
2. An interactive terminal Virtual Unix Shell REPL (`openchat`) enabling users and agents to navigate and manage chats as virtual files.

---

## 2. Vertical Slice Delivery Plan

Each slice delivers an end-to-end, user-verifiable capability.

```
+-----------------------------------------------------------------------------------+
| Slice 1: Virtual Shell & SQLite Foundation (Offline / Seeded Mode)                |
| -> User verifies: Interactive REPL, seeded directories (/Personal, /Work),        |
|    commands: ls, ls -a, cd, pwd, mkdir, cat /welcome.dm, persistence across runs. |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 2: Client-Server API Decoupling (Daemon + Remote-Capable CLI)               |
| -> User verifies: Standalone daemon runs on Fastify HTTP + WS. CLI connects       |
|    over network. Two terminal windows see real-time state sync.                   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 3: Normalized Auth & WhatsApp Adapter Discovery Sync                        |
| -> User verifies: `connect whatsapp personal` displays ASCII QR in terminal;      |
|    phone scan authenticates; discovers chats into hidden `/.whatsapp-personal/`.  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 4: Virtual Pointer DAG Engine (Cross-Platform Linking & Organization)       |
| -> User verifies: `ln -s` links chat to /Personal; `rm` deletes pointer while     |
|    preserving source; `mv`, `cp -r` on directories; collision suffixes (-2).      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 5: Bidirectional Messaging & Live Stream (`tail -f`, `send`)               |
| -> User verifies: `cat` reads history; `tail -f` streams incoming text live;      |
|    `send` dispatches message to real WhatsApp recipient; unread bubble-up.        |
+-----------------------------------------------------------------------------------+
```

---

## 3. Slice 1: Detailed Specification (First Level)

### 3.1 Scope & Goal
Implement the core virtual filesystem DAG and interactive REPL locally.
Verify all file system semantics, persistence, and command ergonomics before introducing network daemons or external platform APIs.

### 3.2 Deliverables
1. **SQLite Database Layer (`src/core/db/`)**:
   - Engine: `better-sqlite3`.
   - File path: `~/.openchat/openchat.db`.
   - Schema tables: `accounts`, `chats`, `messages`, `directories`, `chat_pointers`.
   - Migration runner: creates schema if not exists.
   - Fresh install seeder: provisions `/Personal/`, `/Work/`, and canonical chat `/welcome.dm`.
2. **Virtual Filesystem Engine (`src/core/vfs/`)**:
   - Path resolution (relative paths, absolute paths `/`, `..`, `.`).
   - Directory traversal and DAG pointer lookup.
   - Hierarchy operations: `mkdir -p`, `rmdir`, `rm`, `mv`, `cp -r`, `ln -s`.
   - Collision resolution: auto-suffixes duplicate names (`alex.dm` -> `alex-2.dm`).
   - Dot-prefix visibility filtering (`.folder/` hidden unless `-a` flag passed).
3. **Interactive REPL (`src/cli/repl.ts`)**:
   - Terminal prompt displaying current virtual working directory: `openchat:/$ `.
   - Command dispatcher for:
     - `pwd`: Prints current virtual path.
     - `cd <path>`: Changes virtual working directory.
     - `ls [-l] [-a] [path]`: Lists folders and chat files with types and unread counts.
     - `mkdir [-p] <path>`: Creates virtual directory.
     - `rmdir <path>`: Removes empty virtual directory.
     - `cat <chat_file>`: Prints text messages of a chat.
     - `exit` / `quit`: Closes REPL.

### 3.3 Manual Verification Steps (User Acceptance Criteria)
After building Slice 1, run `npm run cli` and verify:
1. **Prompt**: Shell launches and displays `openchat:/$ `.
2. **Default Listing (`ls`)**:
   - Displays `Personal/` and `Work/`.
   - Does NOT display dot-prefixed directories.
3. **Hidden Listing (`ls -a`)**:
   - Displays all directories including dot-prefixed items.
4. **Read Welcome Message (`cat welcome.dm`)**:
   - Outputs formatted onboarding text explaining Open Chat commands.
5. **Directory Navigation & Creation**:
   - `mkdir /Work/Projects`
   - `cd Work/Projects`
   - Prompt updates to `openchat:/Work/Projects$ `.
   - `pwd` returns `/Work/Projects`.
   - `cd ..` returns to `/Work`.
6. **Persistence**:
   - Exit the REPL (`exit`).
   - Re-launch `npm run cli`.
   - `ls /Work` shows `Projects/` still exists.
