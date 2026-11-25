import Foundation
import Combine

public struct MillerColumn: Identifiable, Equatable {
    public var id: String { path }
    public let path: String
    public var entries: [VfsEntry]
    public var selectedEntryName: String?

    public init(path: String, entries: [VfsEntry], selectedEntryName: String? = nil) {
        self.path = path
        self.entries = entries
        self.selectedEntryName = selectedEntryName
    }
}

@MainActor
public final class AppViewModel: ObservableObject {
    // Miller Columns Finder State
    @Published public var columns: [MillerColumn] = []
    @Published public var activeColumnIndex: Int = 0
    @Published public var showHiddenFiles: Bool = false
    @Published public var sortMode: String = "time"
    @Published public var searchQuery: String = ""

    // Navigation History
    @Published public var backStack: [String] = []
    @Published public var forwardStack: [String] = []
    private var currentNavigatedPath: String = "/"

    // Selected Chat Preview State
    @Published public var selectedChat: VfsEntry?
    @Published public var selectedChatPath: String?
    @Published public var selectedChatMessages: [ChatMessage] = []
    @Published public var selectedChatTitle: String = ""

    // Daemon & UI State
    @Published public var isConnected: Bool = false
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String?

    // New Folder Prompt State
    @Published public var isShowingNewFolderSheet: Bool = false
    @Published public var newFolderParentPath: String = "/"
    @Published public var newFolderName: String = ""

    // Auth / Pairing Sheet State
    @Published public var isShowingPairingSheet: Bool = false
    @Published public var pairingPlatform: String = "whatsapp"
    @Published public var pairingAccountLabel: String = "personal"
    @Published public var pairingAccountId: String?
    @Published public var pairingStatus: String = "idle"
    @Published public var pairingChallengeType: String?
    @Published public var pairingChallengeData: String?
    @Published public var pairingChallengePrompt: String?
    @Published public var pairingError: String?
    @Published public var isSubmittingAuth: Bool = false

    public let client: OpenChatClient

    public init(client: OpenChatClient = OpenChatClient()) {
        self.client = client
        setupWebSocket()
    }

    // MARK: - Computed Properties

    public var currentFolderPath: String {
        columns.last?.path ?? "/"
    }

    public var currentFolderTitle: String {
        let path = currentFolderPath
        if path == "/" {
            return "Open Chat"
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }

    public var pathBreadcrumbs: [(name: String, path: String)] {
        var crumbs: [(String, String)] = [("Open Chat", "/")]
        let activePath = selectedChatPath ?? currentFolderPath
        let parts = activePath.split(separator: "/").map(String.init)
        var running = ""
        for part in parts {
            running += "/\(part)"
            crumbs.append((part, running))
        }
        return crumbs
    }

    public var topLevelWorkspaces: [VfsEntry] {
        guard let rootCol = columns.first else { return [] }
        return rootCol.entries.filter { $0.isDirectory && !$0.isHidden }
    }

    public var activeColumnSummary: String {
        guard columns.indices.contains(activeColumnIndex) else {
            return "0 items"
        }
        let entries = filteredEntries(for: columns[activeColumnIndex])
        let totalUnread = entries.reduce(0) { $0 + $1.unreadCount }
        let itemLabel = entries.count == 1 ? "1 item" : "\(entries.count) items"
        if totalUnread > 0 {
            return "\(itemLabel), \(totalUnread) unread"
        }
        return itemLabel
    }

    public var canGoBack: Bool { !backStack.isEmpty }
    public var canGoForward: Bool { !forwardStack.isEmpty }

    public func filteredEntries(for column: MillerColumn) -> [VfsEntry] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            return column.entries
        }
        return column.entries.filter { $0.displayName.lowercased().contains(query) }
    }

    // MARK: - WebSocket

    private func setupWebSocket() {
        client.onEventReceived = { [weak self] eventText in
            Task { @MainActor in
                self?.handleWebSocketEvent(eventText)
            }
        }
        client.connectWebSocket()
    }

    private func handleWebSocketEvent(_ text: String) {
        guard let data = text.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(EventTypeEnvelope.self, from: data) else {
            return
        }

        switch envelope.type {
        case "vfs:change", "sync:complete":
            Task {
                await refreshOpenColumns()
            }
        case "message:new":
            if let chatPath = selectedChatPath {
                Task {
                    await loadChatMessages(at: chatPath)
                }
            }
        case "auth:challenge":
            if let event = try? JSONDecoder().decode(AuthChallengeEvent.self, from: data) {
                if pairingAccountId == nil || pairingAccountId == event.accountId {
                    pairingAccountId = event.accountId
                    pairingStatus = "awaiting_challenge"
                    pairingChallengeType = event.challenge.challengeType
                    pairingChallengeData = event.challenge.data
                    pairingChallengePrompt = event.challenge.prompt
                    pairingError = nil
                    isSubmittingAuth = false
                }
            }
        case "auth:status":
            if let event = try? JSONDecoder().decode(AuthStatusEvent.self, from: data) {
                if pairingAccountId == nil || pairingAccountId == event.accountId {
                    pairingStatus = event.status
                    if event.status == "failed" {
                        pairingError = event.error ?? "Authentication failed."
                        isSubmittingAuth = false
                    } else if event.status == "authenticated" {
                        pairingError = nil
                        pairingChallengeType = nil
                        pairingChallengeData = nil
                        isSubmittingAuth = false

                        Task {
                            await refreshOpenColumns()
                            try? await Task.sleep(nanoseconds: 1_200_000_000)
                            if self.pairingStatus == "authenticated" {
                                self.isShowingPairingSheet = false
                            }
                        }
                    }
                }
            }
        default:
            break
        }
    }

    // MARK: - Miller Column Navigation

    public func initialLoad() async {
        isLoading = true
        errorMessage = nil

        do {
            let rootEntries = try await client.fetchLs(path: "/", all: showHiddenFiles, sort: sortMode)
            self.columns = [MillerColumn(path: "/", entries: rootEntries)]
            self.activeColumnIndex = 0
            self.selectedChat = nil
            self.selectedChatPath = nil
            self.selectedChatMessages = []
            self.currentNavigatedPath = "/"
            self.isConnected = true
        } catch {
            self.isConnected = false
            self.errorMessage = "Failed to connect to Open Chat daemon: \(error.localizedDescription)"
        }

        isLoading = false
    }

    public func refreshOpenColumns() async {
        guard !columns.isEmpty else {
            await initialLoad()
            return
        }

        var updated: [MillerColumn] = []
        for col in columns {
            do {
                let entries = try await client.fetchLs(path: col.path, all: showHiddenFiles, sort: sortMode)
                var newCol = col
                newCol.entries = entries
                if let selected = col.selectedEntryName, !entries.contains(where: { $0.name == selected }) {
                    newCol.selectedEntryName = nil
                }
                updated.append(newCol)
            } catch {
                break
            }
        }

        if !updated.isEmpty {
            self.columns = updated
            self.activeColumnIndex = min(self.activeColumnIndex, updated.count - 1)
            self.isConnected = true
        }
    }

    public func selectEntry(_ entry: VfsEntry, inColumnAt index: Int, recordHistory: Bool = true) async {
        guard columns.indices.contains(index) else { return }

        // Trim any columns to the right of the clicked column
        columns = Array(columns.prefix(index + 1))
        columns[index].selectedEntryName = entry.name
        activeColumnIndex = index

        let parentPath = columns[index].path
        let childPath = parentPath == "/"
            ? "/\(entry.displayName)"
            : "\(parentPath)/\(entry.displayName)"

        if entry.isDirectory {
            selectedChat = nil
            selectedChatPath = nil
            selectedChatMessages = []
            selectedChatTitle = ""

            if recordHistory && childPath != currentNavigatedPath {
                backStack.append(currentNavigatedPath)
                forwardStack.removeAll()
                currentNavigatedPath = childPath
            }

            do {
                let childEntries = try await client.fetchLs(path: childPath, all: showHiddenFiles, sort: sortMode)
                columns.append(MillerColumn(path: childPath, entries: childEntries))
                activeColumnIndex = columns.count - 1
                isConnected = true
            } catch {
                errorMessage = "Failed to open \(childPath): \(error.localizedDescription)"
            }
        } else {
            let filePath = parentPath == "/" ? "/\(entry.name)" : "\(parentPath)/\(entry.name)"
            selectedChat = entry
            selectedChatPath = filePath
            await loadChatMessages(at: filePath)
        }
    }

    public func navigateToPath(_ targetPath: String, recordHistory: Bool = true) async {
        if recordHistory && targetPath != currentNavigatedPath {
            backStack.append(currentNavigatedPath)
            forwardStack.removeAll()
            currentNavigatedPath = targetPath
        }

        selectedChat = nil
        selectedChatPath = nil
        selectedChatMessages = []
        selectedChatTitle = ""

        do {
            let rootEntries = try await client.fetchLs(path: "/", all: showHiddenFiles, sort: sortMode)
            var builtColumns: [MillerColumn] = [MillerColumn(path: "/", entries: rootEntries)]

            let parts = targetPath.split(separator: "/").map(String.init)
            var currentPath = ""

            for part in parts {
                let parentColIndex = builtColumns.count - 1
                if let match = builtColumns[parentColIndex].entries.first(where: { $0.displayName == part || $0.name == part }) {
                    builtColumns[parentColIndex].selectedEntryName = match.name
                    currentPath += "/\(match.displayName)"

                    if match.isDirectory {
                        let nextEntries = try await client.fetchLs(path: currentPath, all: showHiddenFiles, sort: sortMode)
                        builtColumns.append(MillerColumn(path: currentPath, entries: nextEntries))
                    } else {
                        selectedChat = match
                        selectedChatPath = currentPath
                        await loadChatMessages(at: currentPath)
                        break
                    }
                } else {
                    break
                }
            }

            self.columns = builtColumns
            self.activeColumnIndex = builtColumns.count - 1
            self.isConnected = true
        } catch {
            self.errorMessage = "Failed to navigate to \(targetPath): \(error.localizedDescription)"
        }
    }

    public func goBack() async {
        guard let prev = backStack.popLast() else { return }
        forwardStack.append(currentNavigatedPath)
        currentNavigatedPath = prev
        await navigateToPath(prev, recordHistory: false)
    }

    public func goForward() async {
        guard let next = forwardStack.popLast() else { return }
        backStack.append(currentNavigatedPath)
        currentNavigatedPath = next
        await navigateToPath(next, recordHistory: false)
    }

    public func toggleHiddenFiles() async {
        showHiddenFiles.toggle()
        await refreshOpenColumns()
    }

    public func setSortMode(_ mode: String) async {
        sortMode = mode
        await refreshOpenColumns()
    }

    private func loadChatMessages(at path: String) async {
        do {
            let result = try await client.fetchCat(path: path)
            self.selectedChatTitle = result.chat.title
            self.selectedChatMessages = result.messages
        } catch {
            self.selectedChatMessages = []
            self.errorMessage = "Failed to load messages for \(path): \(error.localizedDescription)"
        }
    }

    // MARK: - VFS Actions (mkdir, rmdir, rm, ln)

    public func promptNewFolder(in parentPath: String? = nil) {
        newFolderParentPath = parentPath ?? currentFolderPath
        newFolderName = ""
        isShowingNewFolderSheet = true
    }

    public func createNewFolder() async {
        let trimmed = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let target = newFolderParentPath == "/" ? "/\(trimmed)" : "\(newFolderParentPath)/\(trimmed)"
        do {
            try await client.mkdir(path: target)
            isShowingNewFolderSheet = false
            await refreshOpenColumns()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func deleteEntry(_ entry: VfsEntry, inColumnPath colPath: String) async {
        let fullPath = colPath == "/" ? "/\(entry.displayName)" : "\(colPath)/\(entry.displayName)"
        do {
            if entry.isDirectory {
                try await client.rmdir(path: fullPath)
            } else {
                let chatFilePath = colPath == "/" ? "/\(entry.name)" : "\(colPath)/\(entry.name)"
                try await client.rm(path: chatFilePath)
                if selectedChatPath == chatFilePath {
                    selectedChat = nil
                    selectedChatPath = nil
                    selectedChatMessages = []
                }
            }
            await refreshOpenColumns()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func linkChat(_ entry: VfsEntry, fromColumnPath colPath: String, toWorkspace workspace: VfsEntry) async {
        let sourcePath = colPath == "/" ? "/\(entry.name)" : "\(colPath)/\(entry.name)"
        let targetDir = "/\(workspace.displayName)"
        do {
            try await client.ln(source: sourcePath, targetDir: targetDir)
            await refreshOpenColumns()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Pairing / Auth Actions

    public func openPairingSheet() {
        resetPairingState()
        isShowingPairingSheet = true
    }

    public func resetPairingState() {
        pairingAccountId = nil
        pairingStatus = "idle"
        pairingChallengeType = nil
        pairingChallengeData = nil
        pairingChallengePrompt = nil
        pairingError = nil
        isSubmittingAuth = false
    }

    public func startPairing(clean: Bool = false) async {
        let trimmedLabel = pairingAccountLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = trimmedLabel.isEmpty ? "personal" : trimmedLabel

        isSubmittingAuth = true
        pairingError = nil
        pairingChallengeType = nil
        pairingChallengeData = nil
        pairingChallengePrompt = nil
        pairingStatus = "starting"

        do {
            let accountId = try await client.connectAuth(
                platform: pairingPlatform,
                accountLabel: label,
                clean: clean
            )
            self.pairingAccountId = accountId
        } catch {
            self.pairingStatus = "failed"
            self.pairingError = error.localizedDescription
            self.isSubmittingAuth = false
        }
    }

    public func submitChallengeResponse(_ code: String) async {
        guard let accountId = pairingAccountId else { return }
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isSubmittingAuth = true
        pairingError = nil

        do {
            try await client.submitChallengeResponse(accountId: accountId, response: trimmed)
        } catch {
            self.pairingError = error.localizedDescription
            self.isSubmittingAuth = false
        }
    }
}
