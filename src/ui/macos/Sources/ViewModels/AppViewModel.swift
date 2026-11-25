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

    // Auth / Pairing Sheet state
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
                await loadDirectories()
                await loadChats(for: selectedDirectoryPath)
            }
        case "message:new":
            if let chat = selectedChat {
                Task {
                    await selectChat(chat)
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
                            await loadDirectories()
                            await loadChats(for: selectedDirectoryPath)
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
