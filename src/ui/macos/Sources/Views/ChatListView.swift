import SwiftUI

public struct ChatListView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        Group {
            if viewModel.chats.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tray")
                        .font(.system(size: 36))
                        .foregroundColor(.secondary)
                    Text("No chats in this folder")
                        .font(.headline)
                        .foregroundColor(.secondary)
                    Text("Pointers linked into this folder will appear here.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: Binding(
                    get: { viewModel.selectedChat },
                    set: { newChat in
                        if let newChat = newChat {
                            Task {
                                await viewModel.selectChat(newChat)
                            }
                        }
                    }
                )) {
                    ForEach(viewModel.chats, id: \.name) { chat in
                        HStack(spacing: 10) {
                            // Platform Indicator
                            ZStack {
                                Circle()
                                    .fill(platformColor(for: chat.platform))
                                    .frame(width: 28, height: 28)
                                Image(systemName: platformIcon(for: chat.platform))
                                    .font(.system(size: 14))
                                    .foregroundColor(.white)
                            }

                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(chat.displayName)
                                        .font(.body.weight(.medium))
                                        .lineLimit(1)
                                    Spacer()
                                    Text(chat.formattedDate)
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }

                                HStack {
                                    Text(chat.chatType ?? "chat")
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 1)
                                        .background(RoundedRectangle(cornerRadius: 3).fill(Color.secondary.opacity(0.15)))

                                    Spacer()

                                    if chat.unreadCount > 0 {
                                        Text("\(chat.unreadCount)")
                                            .font(.caption2.bold())
                                            .foregroundColor(.white)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Capsule().fill(Color.blue))
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                        .tag(chat)
                    }
                }
            }
        }
        .navigationTitle(viewModel.selectedDirectoryPath)
    }

    private func platformColor(for platform: String?) -> Color {
        switch platform {
        case "whatsapp":
            return Color.green
        case "system":
            return Color.purple
        default:
            return Color.gray
        }
    }

    private func platformIcon(for platform: String?) -> String {
        switch platform {
        case "whatsapp":
            return "message.fill"
        case "system":
            return "gearshape.fill"
        default:
            return "bubble.left.fill"
        }
    }
}
