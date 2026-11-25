import SwiftUI

public struct MillerColumnsView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(spacing: 0) {
                    ForEach(Array(viewModel.columns.enumerated()), id: \.element.id) { index, column in
                        MillerColumnPane(
                            viewModel: viewModel,
                            column: column,
                            columnIndex: index,
                            isActiveColumn: index == viewModel.activeColumnIndex && viewModel.selectedChat == nil
                        )
                        .id(column.id)

                        Divider()
                    }

                    if viewModel.selectedChat != nil {
                        ChatDetailView(viewModel: viewModel)
                            .frame(minWidth: 400, idealWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
                            .id("chat-preview-pane")
                    } else {
                        // Subtle Finder trailing empty column space
                        Spacer(minLength: 240)
                    }
                }
                .frame(maxHeight: .infinity)
            }
            .background(Color(nsColor: .controlBackgroundColor))
            .onChange(of: viewModel.columns.count) { _ in
                if let last = viewModel.columns.last {
                    withAnimation(.easeOut(duration: 0.18)) {
                        proxy.scrollTo(viewModel.selectedChat != nil ? "chat-preview-pane" : last.id, anchor: .trailing)
                    }
                }
            }
            .onChange(of: viewModel.selectedChatPath) { newPath in
                if newPath != nil {
                    withAnimation(.easeOut(duration: 0.18)) {
                        proxy.scrollTo("chat-preview-pane", anchor: .trailing)
                    }
                }
            }
        }
    }
}

struct MillerColumnPane: View {
    @ObservedObject var viewModel: AppViewModel
    let column: MillerColumn
    let columnIndex: Int
    let isActiveColumn: Bool

    var body: some View {
        let entries = viewModel.filteredEntries(for: column)

        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(spacing: 2) {
                if entries.isEmpty {
                    Text(viewModel.searchQuery.isEmpty ? "Empty folder" : "No matches")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 24)
                } else {
                    ForEach(entries) { entry in
                        let isSelected = column.selectedEntryName == entry.name
                        let isFocusedSelection = isSelected && (isActiveColumn || (viewModel.selectedChat != nil && columnIndex == viewModel.columns.count - 1))

                        MillerRowView(
                            entry: entry,
                            isSelected: isSelected,
                            isFocusedSelection: isFocusedSelection
                        )
                        .contentShape(Rectangle())
                        .onTapGesture {
                            Task {
                                await viewModel.selectEntry(entry, inColumnAt: columnIndex)
                            }
                        }
                        .contextMenu {
                            if entry.isDirectory {
                                let dirPath = column.path == "/" ? "/\(entry.displayName)" : "\(column.path)/\(entry.displayName)"
                                Button("New Folder Inside...") {
                                    viewModel.promptNewFolder(in: dirPath)
                                }
                                if entry.isSystemRoot != true {
                                    Divider()
                                    Button("Delete Empty Folder", role: .destructive) {
                                        Task {
                                            await viewModel.deleteEntry(entry, inColumnPath: column.path)
                                        }
                                    }
                                }
                            } else {
                                Menu("Link to Folder") {
                                    ForEach(viewModel.topLevelWorkspaces) { ws in
                                        Button(ws.displayName) {
                                            Task {
                                                await viewModel.linkChat(entry, fromColumnPath: column.path, toWorkspace: ws)
                                            }
                                        }
                                    }
                                }
                                Divider()
                                Button("Remove Pointer", role: .destructive) {
                                    Task {
                                        await viewModel.deleteEntry(entry, inColumnPath: column.path)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(6)
        }
        .frame(width: 245)
        .frame(maxHeight: .infinity)
        .background(Color(nsColor: .controlBackgroundColor))
        .contextMenu {
            Button("New Folder...") {
                viewModel.promptNewFolder(in: column.path)
            }
        }
    }
}

struct MillerRowView: View {
    let entry: VfsEntry
    let isSelected: Bool
    let isFocusedSelection: Bool

    var body: some View {
        HStack(spacing: 8) {
            iconView
                .frame(width: 18, height: 18)

            Text(entry.displayName)
                .font(.system(size: 13))
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundColor(isFocusedSelection ? .white : (entry.isHidden ? .secondary : .primary))

            Spacer(minLength: 4)

            if entry.unreadCount > 0 {
                Text("\(entry.unreadCount)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(isFocusedSelection ? .accentColor : .white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        Capsule().fill(isFocusedSelection ? Color.white : Color.orange)
                    )
            }

            if entry.isDirectory {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(isFocusedSelection ? .white.opacity(0.9) : .secondary.opacity(0.75))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(backgroundColor)
        )
    }

    private var backgroundColor: Color {
        if isFocusedSelection {
            return Color.accentColor
        } else if isSelected {
            return Color.secondary.opacity(0.22)
        }
        return Color.clear
    }

    @ViewBuilder
    private var iconView: some View {
        if entry.isDirectory {
            if entry.isHidden {
                Image(systemName: "archivebox.fill")
                    .font(.system(size: 13))
                    .foregroundColor(isFocusedSelection ? .white : .secondary)
            } else {
                Image(systemName: "folder.fill")
                    .font(.system(size: 14))
                    .foregroundColor(isFocusedSelection ? .white : Color(red: 0.29, green: 0.67, blue: 0.97))
            }
        } else {
            Image(systemName: platformIcon(for: entry.platform))
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(isFocusedSelection ? .white : platformColor(for: entry.platform))
        }
    }

    private func platformColor(for platform: String?) -> Color {
        switch platform {
        case "whatsapp":
            return Color.green
        case "instagram":
            return Color.pink
        case "system":
            return Color.purple
        default:
            return Color.secondary
        }
    }

    private func platformIcon(for platform: String?) -> String {
        switch platform {
        case "whatsapp":
            return "message.fill"
        case "instagram":
            return "camera.fill"
        case "system":
            return "gearshape.fill"
        default:
            return "bubble.left.fill"
        }
    }
}
