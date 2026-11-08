# Phase 2: Client-Server API Decoupling (Fastify Daemon + Remote-Capable CLI)

## 1. Objective
Decouple the Virtual Filesystem engine and SQLite database from the CLI client.
1. Implement the Core Engine Daemon as an independent background service exposing Fastify HTTP REST + WebSocket endpoints.
2. Refactor the CLI into a thin client that performs zero direct database operations, communicating strictly over the network API.
3. Enable cross-terminal synchronization: changes made in one client session are broadcast in real time to all connected clients.

---

## 2. Architecture & Boundary Contract

```
+-------------------------------------------------------------+
| CLI Client Tab 1                                            |
| (No direct DB access)                                       |
+-------------------------------------------------------------+
               \
                \  HTTP REST (Commands) + WebSocket (Live Events)
                 \ Configurable URL: OPENCHAT_SERVER_URL
                  v
+-------------------------------------------------------------+
| Core Engine Daemon (Independent Background Service)         |
| - Fastify HTTP Server (:3000)                               |
| - Fastify WebSocket Gateway (/ws)                           |
| - VFS Engine & SQLite Store (~/.openchat/openchat.db)       |
+-------------------------------------------------------------+
                  ^
                 /  HTTP REST + WebSocket
                /
+-------------------------------------------------------------+
| CLI Client Tab 2 (Or future Swift macOS GUI)                |
| (No direct DB access)                                       |
+-------------------------------------------------------------+
```

---

## 3. Detailed Deliverables

### 3.1 Dependencies
- Install: `fastify`, `@fastify/websocket`, `ws`
- Remove: `socket.io` (incompatible with standard RFC 6455 WebSockets)
- Dev dependencies: `@types/ws`

### 3.2 Daemon Service (`src/server/`)
- **Server Entrypoint (`src/server/server.ts`)**:
  - Initializes Fastify instance with schema validation and logging.
  - Registers `@fastify/websocket`.
  - Connects to canonical SQLite database via `initDatabase()`.
  - Binds to host/port (default: `127.0.0.1:3000`, overridable via `OPENCHAT_HOST` and `OPENCHAT_PORT`).
  - Exports start and stop lifecycle handlers.
- **REST Endpoints (`src/server/routes/vfs.ts`)**:
  - `GET /api/vfs/cwd`: Returns current working directory.
  - `GET /api/vfs/ls`: Query params: `path`, `all` (boolean). Returns `VfsEntry[]`.
  - `POST /api/vfs/cd`: Body: `{ path: string }`. Validates and returns resolved path.
  - `POST /api/vfs/mkdir`: Body: `{ path: string, recursive?: boolean }`. Emits `vfs:change`.
  - `POST /api/vfs/rmdir`: Body: `{ path: string }`. Emits `vfs:change`.
  - `GET /api/vfs/cat`: Query params: `path: string`, `limit?: number`. Returns `{ chat, messages }`.
  - `POST /api/vfs/ln`: Body: `{ source: string, targetDir: string }`. Emits `vfs:change`.
  - `POST /api/vfs/rm`: Body: `{ path: string }`. Emits `vfs:change`.
  - `POST /api/vfs/mv`: Body: `{ source: string, destination: string }`. Emits `vfs:change`.
  - `POST /api/vfs/cp`: Body: `{ source: string, destination: string, recursive?: boolean }`. Emits `vfs:change`.
  - `GET /api/health`: Health status, uptime, and database metrics.
- **WebSocket Gateway (`src/server/routes/ws.ts`)**:
  - Endpoint: `/ws`.
  - Broadcasts structured JSON events to all active clients:
    - `{ type: "vfs:change", event: "mkdir" | "rm" | "ln" | "mv", path: string }`
    - `{ type: "message:new", chatId: string, message: ChatMessage }`
    - `{ type: "sync:status", platform: string, status: string }`

### 3.3 Remote-Capable CLI Client (`src/cli/`)
- **API Client Bridge (`src/cli/api-client.ts`)**:
  - Wraps native `fetch` and standard `ws` client.
  - Base URL resolved from `OPENCHAT_SERVER_URL` (default: `http://127.0.0.1:3000`).
  - Dispatches typed requests to daemon endpoints.
  - Subscribes to `/ws` stream and updates local prompt or notifies user on remote changes.
- **REPL Refactoring (`src/cli/repl.ts`)**:
  - Replaces direct `vfs` calls with `apiClient` calls.
  - Maintains client-side virtual `cwd` state synchronizing with server.
  - Handles daemon connection errors gracefully (e.g., "Cannot connect to Open Chat daemon at http://127.0.0.1:3000. Is the daemon running?").
- **Daemon Scripts (`package.json`)**:
  - `"daemon"`: `"tsc && node ./dist/server/index.js"`
  - `"cli"`: `"tsc && node ./dist/cli/index.js"`

---

## 4. Manual Verification Steps (User Acceptance Criteria)

Once Phase 2 is implemented, verify the vertical slice:

1. **Start Daemon (Terminal 1)**:
   ```bash
   npm run daemon
   ```
   - Confirms Fastify server listening on `http://127.0.0.1:3000`.

2. **Launch Client A (Terminal 2)**:
   ```bash
   npm run cli
   ```
   - Launches REPL, connects to daemon, and displays prompt `openchat:/$ `.
   - Run `ls -l` -> displays seeded `/Personal`, `/Work`, and `welcome.dm`.

3. **Launch Client B (Terminal 3)**:
   ```bash
   npm run cli
   ```
   - Connects as a second independent client to the same daemon.

4. **Verify Real-Time Cross-Client Sync**:
   - In **Terminal 2**, create a folder:
     ```text
     openchat:/$ mkdir -p Work/Clients/Acme
     ```
   - Look at **Terminal 3**:
     - Live notification appears: `[Live Event] Virtual filesystem updated: /Work/Clients/Acme`.
     - In Terminal 3, run `ls Work/Clients` -> displays `Acme/` immediately!

5. **Verify Remote Server Configuration**:
   - Launch client with explicit URL:
     ```bash
     OPENCHAT_SERVER_URL=http://localhost:3000 npm run cli
     ```
   - Confirms the client works seamlessly with environment-configured host endpoints.
