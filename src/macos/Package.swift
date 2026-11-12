// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenChatApp",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "OpenChatApp", targets: ["OpenChatApp"])
    ],
    targets: [
        .executableTarget(
            name: "OpenChatApp",
            path: "Sources"
        )
    ]
)
