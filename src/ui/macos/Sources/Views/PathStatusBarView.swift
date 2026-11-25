import SwiftUI

public struct PathStatusBarView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        VStack(spacing: 0) {
            Divider()

            // Finder Path Bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(viewModel.pathBreadcrumbs.enumerated()), id: \.offset) { index, crumb in
                        if index > 0 {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundColor(.secondary.opacity(0.7))
                        }

                        Button {
                            Task {
                                await viewModel.navigateToPath(crumb.path)
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: crumbIcon(index: index, isLast: index == viewModel.pathBreadcrumbs.count - 1))
                                    .font(.system(size: 11))
                                    .foregroundColor(crumbColor(index: index, isLast: index == viewModel.pathBreadcrumbs.count - 1))
                                Text(crumb.name)
                                    .font(.system(size: 11))
                                    .foregroundColor(index == viewModel.pathBreadcrumbs.count - 1 ? .primary : .secondary)
                            }
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
            }
            .frame(height: 24)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            // Finder Status Bar
            HStack {
                HStack(spacing: 6) {
                    Circle()
                        .fill(viewModel.isConnected ? Color.green : Color.red)
                        .frame(width: 7, height: 7)
                    Text(viewModel.isConnected ? "Daemon Connected" : "Daemon Disconnected")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }

                Spacer()

                Text(viewModel.activeColumnSummary)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                Spacer()

                if let err = viewModel.errorMessage {
                    Text(err)
                        .font(.system(size: 11))
                        .foregroundColor(.red)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: 260, alignment: .trailing)
                } else {
                    Text(viewModel.showHiddenFiles ? "Showing hidden archives" : "Hidden archives concealed")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary.opacity(0.8))
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 24)
            .background(Color(nsColor: .windowBackgroundColor))
        }
    }

    private func crumbIcon(index: Int, isLast: Bool) -> String {
        if index == 0 {
            return "externaldrive.fill"
        }
        if isLast && viewModel.selectedChat != nil {
            return "message.fill"
        }
        return "folder.fill"
    }

    private func crumbColor(index: Int, isLast: Bool) -> Color {
        if index == 0 {
            return .secondary
        }
        if isLast && viewModel.selectedChat != nil {
            return .green
        }
        return Color(red: 0.29, green: 0.67, blue: 0.97)
    }
}
