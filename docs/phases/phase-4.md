# Phase 4: Native macOS Application (Swift & SwiftUI)

## 1. Objective
Deliver the native macOS GUI application in `./src/ui/macos/` conforming to the 2-tier architecture:
1. Pure presentation layer in Swift / SwiftUI with zero direct database access.
2. 3-column Finder-inspired navigation split view (Directory Tree $\rightarrow$ Chat Files $\rightarrow$ Conversation Thread).
3. Connects to the Core Engine Daemon via HTTP REST (`http://127.0.0.1:3000`) and subscribes to real-time events via `URLSessionWebSocketTask` (`/ws`).

---

## 2. Directory Layout & Tech Stack

- **Location**: `./src/ui/macos/`
- **Build System**: Swift Package Manager (`Package.swift` executable target).
- **Target OS**: macOS 13.0+ (Ventura / Sonoma / Sequoia).
- **UI Framework**: SwiftUI (`NavigationSplitView`).
- **Network Engine**: Native `URLSession` + `URLSessionWebSocketTask` (no third-party dependencies required).

```
src/ui/macos/
├── Package.swift
└── Sources/
    ├── App.swift                  # App entrypoint (@main)
    ├── Models/
    │   ├── VfsEntry.swift         # Directory and Chat entity models
    │   ├── ChatMessage.swift      # Message history model
    │   └── ServerEvent.swift      # WebSocket live event definitions
    ├── Services/
    │   └── OpenChatClient.swift   # HTTP REST and WebSocket API client
    ├── ViewModels/
    │   └── AppViewModel.swift     # Observable state manager
    └── Views/
        ├── ContentView.swift      # 3-column NavigationSplitView
        ├── SidebarView.swift      # Pane 1: Directory Tree & System Archives
        ├── ChatListView.swift     # Pane 2: Chat Files in current folder
        └── ChatDetailView.swift   # Pane 3: Message History Viewer
```

---

## 3. Vertical Slice Plan

```
+-----------------------------------------------------------------------------------+
| Slice 1: 3-Column Finder SplitView & Live Daemon Ingestion                        |
| -> User verifies: Native macOS window launches (`swift run`); connects to daemon; |
|    displays directories in Sidebar, chat files with platform badges in Column 2,  |
|    and conversation history in Column 3.                                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 2: Real-Time WebSocket Streaming & Live Unread Badges                       |
| -> User verifies: macOS app receives live WebSocket events; new incoming         |
|    messages appear immediately; mobile reads update unread badges live.           |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 3: Folder Management & Pointer Linking (GUI Actions)                        |
| -> User verifies: Context menus and toolbars allow creating virtual folders,      |
|    linking chats (`ln -s`), and moving/deleting pointers.                         |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Slice 4: Outbound Messaging & Native QR Pairing Sheet                             |
| -> User verifies: Send text replies directly from native UI; native pairing sheet  |
|    displays QR code for adding WhatsApp accounts.                                 |
+-----------------------------------------------------------------------------------+
```

---

## 4. Slice 1: Detailed Specification (First Level)

### 4.1 Scope
Build the SwiftPM package foundation, the `OpenChatClient` networking layer, and the 3-column `NavigationSplitView` SwiftUI interface.

### 4.2 User Acceptance Criteria
1. Start engine daemon: `npm run daemon`.
2. In `./src/ui/macos/`, run: `swift run OpenChatApp`.
3. Native macOS window opens.
4. **Sidebar**: Displays `/Personal`, `/Work`, and toggle for hidden archives (`/.whatsapp-personal/`).
5. **Chat List**: Selecting a directory populates the chat list sorted by last activity, showing contact names, `[whatsapp]` / `[system]` badges, and formatted timestamps.
6. **Detail View**: Clicking a chat displays the scrollable conversation history with message bubbles and sender headers.
