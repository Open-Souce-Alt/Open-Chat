# Project Memory & Directives Log

This document tracks all project requirements, constraints, and architecture decisions.
- **Section 1: Inferred Directives (Authoritative Current State)**: The synthesized, conflict-resolved source of truth. Always consult this section first when resuming in a new session.
- **Section 2: Session Directives (Audit Log)**: The chronological record of raw directives captured across user sessions. Later directives may supersede earlier entries.

---

## 1. Inferred Directives (Current State of Truth)

| Domain | Inferred Directive | Authoritative Rules | Source Trace |
|---|---|---|---|
| **Mission & Scope** | Pure Chat Aggregation | Aggregate chats across platforms into one unified interface. Strip out feeds, stories, and engagement algorithms. | DIR-001 |
| **Phased Roadmap** | Phase 1 (Engine + CLI), Phase 2 / Goal 2 (Native macOS App) | **Goal 1 (Complete)**: Standalone TypeScript engine daemon + interactive virtual Unix shell REPL in `./src/ui/cli/` (`cd`, `ls`, `ln -s`, `cat`, `tail -f`, `send`). Default `ls` sorting orders entries by descending last message / activity time.<br>**Goal 2 (Current)**: Native macOS GUI application built in Swift/SwiftUI in `./src/ui/macos/` using a 3-column Finder-inspired split view, connecting via HTTP REST + WebSocket. | DIR-002, DIR-003, DIR-018, DIR-021, DIR-024, DIR-037, DIR-042 |
| **System Architecture** | Decoupled Daemon + Presentation Client | 2-tier client-server architecture. Engine runs as an independent daemon. UI/CLI has strictly zero database access. Client connects to engine via configurable base URL. Supported topologies: local loopback or remote VPS. | DIR-004, DIR-011, DIR-019, DIR-020 |
| **API & Transport** | Fastify HTTP REST + RFC WebSockets | Communication layer uses HTTP REST (queries, mutations) and standard WebSockets (bidirectional event streams, message delivery, auth challenges). No proprietary socket protocols (remove socket.io). | DIR-020, DIR-032 |
| **Storage Engine** | Native SQLite via `better-sqlite3` | On-device SQLite database at `~/.openchat/openchat.db`. Uses canonical `better-sqlite3` native C++ bindings for synchronous, low-latency execution. | DIR-009, DIR-031 |
| **Virtual Filesystem** | Many-to-Many DAG (Symlink Graph) | The filesystem is a virtual abstraction stored in SQLite, not disk files. A chat is an atomic conversation node holding a typed `platform` enum (`PlatformId = 'whatsapp' | 'system'`) for UI branding and filtering. Directories are containers that can nest recursively. A single chat can exist in multiple directories simultaneously via pointer edges (`chat_pointers`). | DIR-005, DIR-006, DIR-010, DIR-015, DIR-025, DIR-041 |
| **File Operations** | Strict Pointer Semantics | - `ln [-s]`: Creates pointer to chat in target directory.<br>- `rm`: Deletes pointer only; canonical chat remains in system archive.<br>- `cp -r`: Allowed only on directories (duplicates directory and clones pointer edges); **prohibited on individual chat files**.<br>- `mv`: Moves/renames directories or pointers. | DIR-006, DIR-015, DIR-026 |
| **Multi-Account & Roots** | Per-Account Isolated System Archives | Native multi-account support for any platform. Each account creates an isolated adapter session and an immutable system archive root directory (e.g., `/.whatsapp-personal/`). System roots cannot be deleted or renamed. | DIR-007, DIR-028 |
| **Cross-Platform Folders** | Heterogeneous Workspaces | User-created directories can mix chats from different platforms and accounts side-by-side (e.g., `/Work` contains WhatsApp Work and Instagram chats). | DIR-016 |
| **CLI Paradigm & Autocomplete** | Interactive Virtual Unix Shell REPL | Interactive prompt (`openchat:${cwd}$ `) with standard Unix commands (`cd`, `ls`, `ln -s`, `cat`, `mkdir -p`, `rmdir`, `rm`, `mv`, `cp -r`, `connect`, `status`). Full Tab Autocompletion (completes commands, directory paths, chat files, and respects dotfile visibility). Default `ls` sorting orders entries by descending last message / activity time (`-t`), with `-n` (by name) and `-r` (reverse) overrides. | DIR-021, DIR-037, DIR-038 |
| **Naming & Extensions** | Visual Extensions, Collisions & LID Mapping | Visual extensions (`.dm`, `.group`, `.channel`) are hints for monochrome terminal display. Name collisions in a folder are suffixed numerically (`alex.dm`, `alex-2.dm`). WhatsApp anonymous Local Identifiers (`@lid`) are mapped to phone numbers via `lidPnMappings` to ensure human-readable address book contact names. | DIR-017, DIR-022, DIR-023, DIR-039 |
| **Initial Hierarchy** | Seeded Defaults | Fresh database initialization automatically creates `/Personal/`, `/Work/`, and a virtual onboarding chat `/welcome.dm`. | DIR-033 |
| **Visibility** | Dot-Prefix Hidden Folders | Hidden directories use Unix dot prefixes (e.g., `/.whatsapp-personal/`). Omitted from default `ls`; revealed via `ls -a`. System archive roots are dot-prefixed by default to keep the root tidy. | DIR-008, DIR-034 |
| **Unread Propagation** | Recursive Bubble-Up | Unread counts on individual chats bubble up through every parent directory up to root (`ls /` shows `Work/ (3)`). | DIR-030 |
| **Interactivity & Receipts** | Bidirectional; Optional Receipts | Sending messages and replies back to external platforms is supported. Outbound read receipts (blue ticks) are optional/stealth by design (deferred from Phase 1). | DIR-012, DIR-029 |
| **Sync Strategy** | Complete Discovery + Continuous Sync | On connection: complete discovery of all contacts/groups into SQLite and system root; shallow message sync (latest 20–50 messages per chat); lazy on-demand backfill for older history. Mobile phone history chunks and DMs stream continuously into SQLite as they arrive (`onChatsUpdated`). Inbound read events on mobile (`chats.update`) synchronize unread counts to 0 live. | DIR-027, DIR-039, DIR-040 |
| **Auth Architecture** | Normalized State Machine & Protocol Sockets | Engine abstracts platform login flows (QR codes, SMS OTP, credentials) into a universal state machine streamed over WebSocket/HTTP. WhatsApp integration strictly uses protocol-level WebSockets (`@whiskeysockets/baileys`) rather than headless browser automation to prevent bot detection and account-wide companion device revocation. Handles protocol-level post-pairing reconnect handshakes (`restartRequired: 515`) automatically. | DIR-013, DIR-014, DIR-035, DIR-036 |
| **Workflow & Task Tracking** | GitHub Projects & Issues-Driven | All feature requests, roadmap milestones, and discovered issues are tracked on GitHub Project #1 (https://github.com/orgs/Open-Souce-Alt/projects/1) and GitHub Issues. The agent inspects the board, picks ready tasks, updates card status (Backlog -> Ready -> In progress -> Done), and references issue numbers in commit messages. | DIR-044 |
| **VCS & Release Policy** | Conventional Commits & Autonomous Issue Push | Changes are committed using Conventional Commits and pushed to origin/main upon verified completion of tasks, issues, and slices. | DIR-045 |

---

## 2. Session Directives (Chronological Audit Log)

| ID | Topic | Raw Directive / Constraint | Date / Origin | Status |
|---|---|---|---|---|
| DIR-001 | Product Mission | Aggregate chats only. Exclude social feeds, stories, and engagement algorithms. | Initial Spec | Active |
| DIR-002 | Platform Target | First target is a native macOS application. | Initial Spec | Superseded by DIR-018 for Phase 1 |
| DIR-003 | Tech Stack | Internal aggregation engine: **TypeScript**. Native UI: **Swift**. | Initial Spec | Active (Swift in Phase 2) |
| DIR-004 | Architecture | Strict 2-tier separation. Engine is decoupled to allow extensible UI packages. | Initial Spec | Active |
| DIR-005 | Data Model | Filesystem paradigm. Chats are files; categories are directories. | Initial Spec | Active |
| DIR-006 | References | Chats in user folders are pointers (symlinks). Never copy chat data. | Initial Spec | Active |
| DIR-007 | Integration Roots | Integrations auto-create a root directory (e.g., `/whatsapp`). Deleting a user pointer retains the source chat in this root. | Initial Spec | Refined by DIR-028 & DIR-034 |
| DIR-008 | Visibility | Support hiding directories without deleting data. | Initial Spec | Refined by DIR-034 |
| DIR-009 | Storage Engine | On-device **SQLite** stores canonical chats, messages, and the virtual directory tree. | Clarification 1 | Active |
| DIR-010 | Virtual Filesystem | Filesystem is purely a virtual database abstraction, not physical macOS disk files. | Clarification 1 | Active |
| DIR-011 | UI Boundary | Swift UI is strictly presentation with zero direct DB access. All data & actions flow over local IPC/API. | Clarification 2 | Refined by DIR-020 (HTTP/WS) |
| DIR-012 | Interactivity | System is **bidirectional**. Supports sending messages, replies, and actions back to platforms. | Clarification 3 | Active |
| DIR-013 | Integration Tech | Initial phase uses 3rd-party integration libs (e.g., wppconnect), later replaced by in-house extensions. | Clarification 4 | Active |
| DIR-014 | Normalized Auth | Engine abstracts all login flows (QR, OTP, OAuth) into a universal auth state machine served over IPC/API. | Clarification 4 | Active |
| DIR-015 | Pointer Semantics | Many-to-many DAG. A single chat can exist in multiple user directories simultaneously. | Clarification 5 | Active |
| DIR-016 | Cross-Platform | User directories are platform-agnostic and can mix chats from any connected service. | Clarification 6 | Active |
| DIR-017 | Chat File Types | Chat categories (DM, Group, Channel, Broadcast) map to virtual "file types/extensions". | Clarification 6 | Active |
| DIR-018 | Phase 1 Roadmap | Do NOT touch Swift macOS app yet. Build standalone engine daemon + CLI client first. Swift macOS app is Phase 2. | Clarification 7 | Active (Supersedes DIR-002) |
| DIR-019 | Process Model | Core engine is an independent standalone daemon (runs separately from UI/CLI lifecycle). | Clarification 7 | Active |
| DIR-020 | API Protocol | HTTP (REST) + WebSocket. Supports local or remote VPS hosting via configurable backend URL. | Clarification 7 | Active (Supersedes pure local IPC) |
| DIR-021 | CLI Paradigm | Interactive virtual Unix shell REPL (`cd`, `ls`, `ln`, `cat`, `tail -f`, `send`). Friendly to both humans and AI agents. | Clarification 8 | Active |
| DIR-022 | Naming Collisions | Duplicate names in a directory are auto-suffixed with `-2`, `-3` (e.g., `alex-2.dm`, `standup-2.group`). | Clarification 9 | Active |
| DIR-023 | Visual Extensions | Chat extensions (`.dm`, `.group`, `.channel`) are visual aids for monochrome shells, not file-type drivers. | Clarification 9 | Active |
| DIR-024 | Media Scope | Phase 1 focuses strictly on **text messages**. Media asset disk storage (`~/.openchat/media/`) deferred to Phase 2. | Clarification 10 | Active |
| DIR-025 | Recursive Directories | Virtual directories support arbitrary nested sub-directories (`/A/B/C`). | Clarification 10 | Active |
| DIR-026 | Directory Manipulation | Directories can be moved (`mv`), renamed, or copied (`cp -r` duplicates folder and clones pointers). | Clarification 10 | Active |
| DIR-027 | Sync Strategy | **Complete sync for chats** (full contact/group tree) + **Shallow sync for messages** (recent 20-50 messages; lazy backfill for history). | Clarification 11 | Active |
| DIR-028 | Multi-Account Support | Multi-account support per platform is native. Each account forms an isolated session & immutable root directory. | Clarification 12 | Active |
| DIR-029 | Read Receipts | Outbound read receipts are optional/stealth by design; deferred from Phase 1. | Clarification 13 | Active |
| DIR-030 | Unread Bubble-Up | Unread counts recursively bubble up from chats through all parent directories to root in listings. | Clarification 13 | Active |
| DIR-031 | SQLite Library | Use official native SQLite bindings (`better-sqlite3`) over LibSQL or third-party forks. | Clarification 14 | Active |
| DIR-032 | Server Framework | Fastify + `@fastify/websocket` for lightweight, industry-standard HTTP REST + WebSocket daemon. | Clarification 14 | Active |
| DIR-033 | Seeded Filesystem | Fresh install provisions `/Personal/`, `/Work/`, and `/welcome.dm` (onboarding guide). | Clarification 15 | Active |
| DIR-034 | Hidden Directories | Dot-prefix convention (`.whatsapp-personal/`). Omitted by default; revealed via `ls -a`. | Clarification 15 | Active |
| DIR-035 | WhatsApp Protocol Adapter | Use protocol-level socket library (`@whiskeysockets/baileys`) instead of Puppeteer browser automation (`wppconnect`) to avoid bot detection and account-wide device logouts. | Security Fix | Active (Refines DIR-013) |
| DIR-036 | Post-Pairing Handshake Loop | Adapter must handle post-pairing socket close (code 515 restartRequired) by auto-reconnecting with saved credentials to reach authenticated state. | Bug Fix | Active |
| DIR-037 | Default Sorting Policy | `ls` sorts entries by descending order of last message/activity timestamp by default (most recent first). Supports `-n` (`--sort=name`), `-t` (`--sort=time`), and `-r` (`--reverse`). | User Directive | Active |
| DIR-038 | Tab Autocompletion | REPL supports native Unix tab autocompletion: command names, directories (filtered for `cd`/`rmdir`), chat files (filtered for `cat`), paths, and dotfile exclusion. | UX Directive | Active |
| DIR-039 | WhatsApp LID Mapping & Continuous Sync | Map WhatsApp `@lid` anonymous IDs to phone numbers using `lidPnMappings` to resolve contact names. Stream DMs continuously into SQLite as phone sends history chunks. | Bug Fix | Active |
| DIR-040 | Mobile Read Receipt Sync | Listen for WhatsApp `chats.update` events so messages viewed on mobile app immediately reset unread count to 0 in SQLite and update parent directories live. | Bug Fix | Active |
| DIR-041 | Typed Platform Enum | Platform is defined as a strict union type (`PlatformId = 'whatsapp' | 'system'`) rather than generic string, ensuring compile-time safety and clean UI package extensions. | Refinement | Active |
| DIR-042 | UI Layer Package Locations | Presentation packages live under `./src/ui/`: CLI shell in `./src/ui/cli/` and native macOS SwiftUI app in `./src/ui/macos/`. Both connect strictly as network clients to the engine daemon. | Goal 2 Directive | Active |
| DIR-043 | Explicit Commit & Push Permission | Commits, squashes into published history, and git/jj pushes require explicit user authorization beforehand. | Operational Directive | Superseded by DIR-045 |
| DIR-044 | GitHub Projects & Issue-Driven Workflow | Development requirements and backlog are tracked on GitHub Project #1 (https://github.com/orgs/Open-Souce-Alt/projects/1) and repository issues. The assistant reads issues, can open discovered issues/cards, updates card status (Backlog -> Ready -> In progress -> Done), and links conventional commits to issues. | Workflow Directive | Active |
| DIR-045 | Autonomous Commit & Push for Task Slices | With the GitHub Projects issue-driven workflow active, commits and pushes proceed autonomously upon verified completion of each issue, task, or slice using Conventional Commits. | Workflow Directive | Active (Supersedes DIR-043) |

---

## 3. Maintenance Protocol for Future Sessions

When a user provides instructions or says "remember [X]":
1. Log the raw directive in **Section 2 (Session Directives)** with an incremental ID (`DIR-XXX`), and note if it supersedes prior directives.
2. Synthesize and update **Section 1 (Inferred Directives)** to reflect the new reconciled state of truth.
3. Update `docs/ARCHITECTURE.md` if the change impacts technical models, diagrams, or command contracts.
