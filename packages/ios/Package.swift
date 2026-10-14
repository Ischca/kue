// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Kue",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "Kue", targets: ["Kue"]), .library(name: "KueRecorder", targets: ["KueRecorder"])],
    targets: [.target(name: "Kue", resources: [.process("Resources")]),
              .target(name: "KueRecorder", dependencies: ["Kue"])],
    swiftLanguageVersions: [.v5]
)
