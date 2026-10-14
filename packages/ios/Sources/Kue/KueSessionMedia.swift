import Foundation

/// Session findings live in memory. Only abandoned SDK preview/recorder files survive a process crash.
/// Purge once per process so creating a second window never deletes the first window's active media.
@MainActor enum KueSessionMedia {
    private static var cleaned = false
    static func cleanOnce() {
        guard !cleaned else { return }; cleaned = true
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        for name in ["kue-recordings", "kue-previews"] { purgeOrphans(in: caches.appendingPathComponent(name, isDirectory: true)) }
    }
    static func purgeOrphans(in directory: URL) {
        let manager = FileManager.default
        guard (try? manager.attributesOfItem(atPath: directory.path)[.type] as? FileAttributeType) == .typeDirectory,
              let files = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else { return }
        for file in files where file.pathExtension == "mp4" && UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil {
            guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                  values.isRegularFile == true, values.isSymbolicLink != true else { continue }
            try? manager.removeItem(at: file)
        }
    }
    static func owns(_ file: URL, directory name: String) -> Bool {
        let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(name, isDirectory: true)
        guard file.isFileURL, file.pathExtension == "mp4", UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil,
              file.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL,
              (try? FileManager.default.attributesOfItem(atPath: root.path)[.type] as? FileAttributeType) == .typeDirectory,
              (try? FileManager.default.attributesOfItem(atPath: file.path)[.type] as? FileAttributeType) == .typeRegular else { return false }
        return true
    }
}
