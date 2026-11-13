import Foundation

public struct VfsEntry: Identifiable, Codable, Hashable {
    public var id: String { name }
    public let name: String
    public let type: String
    public let chatType: String?
    public let platform: String?
    public let unreadCount: Int
    public let isHidden: Bool
    public let isSystemRoot: Bool?
    public let updatedAt: Double?

    public var isDirectory: Bool {
        type == "directory"
    }

    public var displayName: String {
        if isDirectory && name.hasSuffix("/") {
            return String(name.dropLast())
        }
        return name
    }

    public var formattedDate: String {
        guard let updatedAt = updatedAt, updatedAt > 0 else { return "-" }
        let date = Date(timeIntervalSince1970: updatedAt / 1000)
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            let formatter = DateFormatter()
            formatter.dateFormat = "h:mm a"
            return formatter.string(from: date)
        } else if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d"
            return formatter.string(from: date)
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d, yyyy"
            return formatter.string(from: date)
        }
    }
}
