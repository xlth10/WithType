// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VibeVoiceInput",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "VibeVoiceInput",
            path: "Sources/VibeVoiceInput"
        ),
        .testTarget(name: "VibeVoiceInputTests", dependencies: ["VibeVoiceInput"])
    ]
)
