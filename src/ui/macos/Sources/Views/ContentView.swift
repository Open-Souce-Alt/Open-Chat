import SwiftUI

public struct ContentView: View {
    @StateObject private var viewModel = AppViewModel()

    public init() {}

    public var body: some View {
        NavigationSplitView {
            SidebarView(viewModel: viewModel)
        } content: {
            ChatListView(viewModel: viewModel)
        } detail: {
            ChatDetailView(viewModel: viewModel)
        }
        .task {
            await viewModel.initialLoad()
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button(action: {
                    Task {
                        await viewModel.initialLoad()
                    }
                }) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
    }
}
