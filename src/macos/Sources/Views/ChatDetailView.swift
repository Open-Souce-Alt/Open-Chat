import SwiftUI

public struct ChatDetailView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        Group {
            if let chat = viewModel.selectedChat {
                VStack(spacing: 0) {
                    // Header Bar
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(viewModel.selectedChatTitle.isEmpty ? chat.displayName : viewModel.selectedChatTitle)
                                .font(.title3.bold())
                            Text("\(chat.platform ?? "platform") • \(chat.chatType ?? "chat")")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                    }
                    .padding()
                    .background(.ultraThinMaterial)
                    Divider()

                    // Message Thread
                    if viewModel.selectedChatMessages.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "bubble.left.and.bubble.right")
                                .font(.system(size: 32))
                                .foregroundColor(.secondary)
                            Text("No messages in this chat")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(spacing: 12) {
                                    ForEach(viewModel.selectedChatMessages) { msg in
                                        MessageBubbleView(message: msg)
                                            .id(msg.id)
                                    }
                                }
                                .padding()
                            }
                            .onAppear {
                                if let last = viewModel.selectedChatMessages.last {
                                    proxy.scrollTo(last.id, anchor: .bottom)
                                }
                            }
                        }
                    }
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "message")
                        .font(.system(size: 48))
                        .foregroundColor(.secondary)
                    Text("Select a conversation")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    Text("Choose a chat from the list to view its message history.")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

struct MessageBubbleView: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isOutgoing {
                Spacer(minLength: 40)
            }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                if !message.isOutgoing {
                    Text(message.senderName)
                        .font(.caption2.bold())
                        .foregroundColor(.secondary)
                }

                Text(message.text)
                    .font(.body)
                    .foregroundColor(message.isOutgoing ? .white : .primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(message.isOutgoing ? Color.accentColor : Color(nsColor: .controlBackgroundColor))
                    )

                Text(message.formattedTime)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            if !message.isOutgoing {
                Spacer(minLength: 40)
            }
        }
    }
}
