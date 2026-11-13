import SwiftUI

@main
struct OpenChatApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 850, minHeight: 550)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
    }
}
