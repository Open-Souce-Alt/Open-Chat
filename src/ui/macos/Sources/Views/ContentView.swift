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
        .sheet(isPresented: $viewModel.isShowingPairingSheet) {
            PairingSheetView(viewModel: viewModel)
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button(action: {
                    viewModel.openPairingSheet()
                }) {
                    Label("Connect Account", systemImage: "qrcode.viewfinder")
                }
                .help("Connect WhatsApp or Instagram")
            }
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
