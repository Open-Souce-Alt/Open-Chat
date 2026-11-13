import Foundation
import Combine

@MainActor
public final class AppViewModel: ObservableObject {
    @Published public var directories: [VfsEntry] = []
    @Published public var selectedDirectoryPath: String = "/"
    @Published public var chats: [VfsEntry] = []
    @Published public var selectedChat: VfsEntry?
    @Published public var selectedChatMessages: [ChatMessage] = []
    @Published public var selectedChatTitle: String = ""
    @Published public var isConnected: Bool = false
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String?

    public let client: OpenChatClient

    public init(client: OpenChatClient = OpenChatClient()) {
        self.client = client
        setupWebSocket()
    }

    private func setupWebSocket() {
        client.onEventReceived = { [weak self] eventText in
            Task { @MainActor in
                self?.handleWebSocketEvent(eventText)
            }
        }
        client.connectWebSocket()
    }

    private func handleWebSocketEvent(_ text: String) {
        // When VFS change or message arrive, refresh current views
        if text.contains("vfs:change") || text.contains("sync:complete") {
            Task {
                await loadDirectories()
                await loadChats(for: selectedDirectoryPath)
            }
        }
        if text.contains("message:new") {
            if let chat = selectedChat {
                Task {
                    await selectChat(chat)
                }
            }
        }
    }

    public func initialLoad() async {
        isLoading = true
        errorMessage = nil
        await loadDirectories()
        if let firstDir = directories.first(where: { !$0.isHidden }) {
            selectedDirectoryPath = "/" + firstDir.displayName
            await loadChats(for: selectedDirectoryPath)
        } else {
            await loadChats(for: "/")
        }
        isLoading = false
    }

    public func loadDirectories() async {
        do {
            let rootEntries = try await client.fetchLs(path: "/", all: true)
            self.directories = rootEntries.filter { $0.isDirectory }
            self.isConnected = true
        } catch {
            self.isConnected = false
            self.errorMessage = "Failed to load directories from daemon: \(error.localizedDescription)"
        }
    }

    public func selectDirectory(path: String) async {
        self.selectedDirectoryPath = path
        self.selectedChat = nil
        self.selectedChatMessages = []
        await loadChats(for: path)
    }

    public func loadChats(for path: String) async {
        do {
            let entries = try await client.fetchLs(path: path, all: true, sort: "time")
            self.chats = entries.filter { !$0.isDirectory }
        } catch {
            self.chats = []
            self.errorMessage = "Failed to load chats for \(path): \(error.localizedDescription)"
        }
    }

    public func selectChat(_ chat: VfsEntry) async {
        self.selectedChat = chat
        let fullPath = selectedDirectoryPath.hasSuffix("/")
            ? selectedDirectoryPath + chat.name
            : selectedDirectoryPath + "/" + chat.name

        do {
            let result = try await client.fetchCat(path: fullPath)
            self.selectedChatTitle = result.chat.title
            self.selectedChatMessages = result.messages
        } catch {
            self.selectedChatMessages = []
            self.errorMessage = "Failed to load messages for \(chat.name): \(error.localizedDescription)"
        }
    }
}
