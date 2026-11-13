import SwiftUI

public struct SidebarView: View {
    @ObservedObject var viewModel: AppViewModel

    public var body: some View {
        List(selection: Binding(
            get: { viewModel.selectedDirectoryPath },
            set: { newPath in
                if let newPath = newPath {
                    Task {
                        await viewModel.selectDirectory(path: newPath)
                    }
                }
            }
        )) {
            Section("Workspaces") {
                ForEach(viewModel.directories.filter { !$0.isHidden }, id: \.name) { dir in
                    let dirPath = "/" + dir.displayName
                    HStack {
                        Label(dir.displayName, systemImage: "folder.fill")
                            .foregroundColor(.accentColor)
                        Spacer()
                        if dir.unreadCount > 0 {
                            Text("\(dir.unreadCount)")
                                .font(.caption2.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.orange))
                        }
                    }
                    .tag(dirPath)
                }
            }

            let systemDirs = viewModel.directories.filter { $0.isHidden }
            if !systemDirs.isEmpty {
                Section("System Archives") {
                    ForEach(systemDirs, id: \.name) { dir in
                        let dirPath = "/" + dir.displayName
                        HStack {
                            Label(dir.displayName, systemImage: "archivebox.fill")
                                .foregroundColor(.secondary)
                            Spacer()
                            if dir.unreadCount > 0 {
                                Text("\(dir.unreadCount)")
                                .font(.caption2.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(Color.orange))
                            }
                        }
                        .tag(dirPath)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Open Chat")
    }
}
