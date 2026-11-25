import SwiftUI

public struct ContentView: View {
    @StateObject private var viewModel = AppViewModel()

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            MillerColumnsView(viewModel: viewModel)
            PathStatusBarView(viewModel: viewModel)
        }
        .navigationTitle(viewModel.currentFolderTitle)
        .searchable(text: $viewModel.searchQuery, placement: .toolbar, prompt: "Search")
        .task {
            await viewModel.initialLoad()
        }
        .sheet(isPresented: $viewModel.isShowingPairingSheet) {
            PairingSheetView(viewModel: viewModel)
        }
        .sheet(isPresented: $viewModel.isShowingNewFolderSheet) {
            NewFolderSheetView(viewModel: viewModel)
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button {
                    Task { await viewModel.goBack() }
                } label: {
                    Image(systemName: "chevron.left")
                }
                .disabled(!viewModel.canGoBack)
                .help("Back")

                Button {
                    Task { await viewModel.goForward() }
                } label: {
                    Image(systemName: "chevron.right")
                }
                .disabled(!viewModel.canGoForward)
                .help("Forward")
            }

            ToolbarItemGroup(placement: .automatic) {
                Button {
                    Task { await viewModel.toggleHiddenFiles() }
                } label: {
                    Label(
                        viewModel.showHiddenFiles ? "Hide System Archives" : "Show System Archives",
                        systemImage: viewModel.showHiddenFiles ? "eye.fill" : "eye.slash"
                    )
                }
                .keyboardShortcut(".", modifiers: [.command, .shift])
                .help("Toggle Hidden Archives (⌘⇧.)")

                Menu {
                    Picker("Sort By", selection: Binding(
                        get: { viewModel.sortMode },
                        set: { newSort in
                            Task { await viewModel.setSortMode(newSort) }
                        }
                    )) {
                        Text("Last Activity").tag("time")
                        Text("Name").tag("name")
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
                .help("Sort Columns")

                Button {
                    viewModel.promptNewFolder()
                } label: {
                    Label("New Folder", systemImage: "folder.badge.plus")
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .help("New Folder (⌘⇧N)")

                Button {
                    viewModel.openPairingSheet()
                } label: {
                    Label("Connect Account", systemImage: "qrcode.viewfinder")
                }
                .help("Connect WhatsApp or Instagram")

                Button {
                    Task { await viewModel.refreshOpenColumns() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .help("Refresh (⌘R)")
            }
        }
    }
}

struct NewFolderSheetView: View {
    @ObservedObject var viewModel: AppViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Folder")
                .font(.headline)
            Text("Location: \(viewModel.newFolderParentPath)")
                .font(.caption)
                .foregroundColor(.secondary)

            TextField("Folder Name", text: $viewModel.newFolderName)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    Task { await viewModel.createNewFolder() }
                }

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    Task { await viewModel.createNewFolder() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 340)
    }
}
