import Foundation

public struct ChatMessage: Identifiable, Codable, Hashable {
    public let id: String
    public let senderName: String
    public let senderId: String
    public let text: String
    public let timestamp: Double
    public let status: String

    public var isOutgoing: Bool {
        senderId == "me"
    }

    public var formattedTime: String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}

public struct CatChatInfo: Codable {
    public let id: String
    public let title: String
    public let chat_type: String
    public let unread_count: Int
}

public struct CatResult: Codable {
    public let chat: CatChatInfo
    public let messages: [ChatMessage]
}

public struct LsResponse: Codable {
    public let entries: [VfsEntry]
}
