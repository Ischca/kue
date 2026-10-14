import Foundation
import Darwin
import CryptoKit
import ImageIO

/// File bytes stay native. A callback URI is a bounded lease, never a general file reader.
final class KueRNMedia {
    private let root: URL, alias: URL, leases: URL, copies: URL
    private var live: [String: [String: URL]] = [:]
    init(sandbox: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true), owner: String = UUID().uuidString) throws {
        alias = sandbox.standardizedFileURL
        root = alias.resolvingSymlinksInPath()
        leases = root.appendingPathComponent("Library/Caches/kue-bare-leases/\(try KueRNWire.id(owner))", isDirectory: true)
        copies = root.appendingPathComponent("Library/Application Support/kue-bare-copies", isDirectory: true)
        try directory(leases); try directory(copies)
    }
    private func directory(_ url: URL) throws {
        guard url.path.hasPrefix(root.path + "/") else { throw KueRNFailure("invalid_media") }
        var current = root
        for component in url.pathComponents.dropFirst(root.pathComponents.count) {
            current.appendPathComponent(component)
            var status = stat()
            if lstat(current.path, &status) != 0 {
                guard errno == ENOENT else { throw KueRNFailure("invalid_media") }
                do { try FileManager.default.createDirectory(at: current, withIntermediateDirectories: false) }
                catch { throw KueRNFailure("invalid_media") }
                guard lstat(current.path, &status) == 0 else { throw KueRNFailure("invalid_media") }
            }
            guard status.st_mode & S_IFMT == S_IFDIR else { throw KueRNFailure("invalid_media") }
        }
    }
    private func checkedURL(_ uri: String) throws -> URL {
        guard let url = URL(string: uri), url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost",
              url.query == nil, url.fragment == nil, !url.path.contains("\0"),
              !url.pathComponents.contains(".."), !url.pathComponents.contains(".") else { throw KueRNFailure("invalid_media") }
        let supplied = url.standardizedFileURL
        let path: URL
        if supplied.path.hasPrefix(root.path + "/") { path = supplied }
        else if supplied.path.hasPrefix(alias.path + "/") {
            path = root.appendingPathComponent(String(supplied.path.dropFirst(alias.path.count + 1)))
        } else { throw KueRNFailure("invalid_media") }
        var current = root
        for component in path.pathComponents.dropFirst(root.pathComponents.count) {
            current.appendPathComponent(component)
            var status = stat()
            guard lstat(current.path, &status) == 0, status.st_mode & S_IFMT != S_IFLNK else { throw KueRNFailure("invalid_media") }
        }
        guard path.resolvingSymlinksInPath().path == path.path else { throw KueRNFailure("invalid_media") }
        return path
    }
    func read(_ uri: String, maximum: Int) throws -> Data {
        let url = try checkedURL(uri)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw KueRNFailure("invalid_media") }; defer { Darwin.close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_mode & S_IFMT == S_IFREG,
              status.st_size > 0, status.st_size <= maximum else { throw KueRNFailure("invalid_media") }
        var data = Data(); data.reserveCapacity(Int(status.st_size))
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            guard count > 0, data.count <= maximum - count else { throw KueRNFailure("invalid_media") }
            data.append(contentsOf: buffer.prefix(count))
        }
        guard data.count == Int(status.st_size) else { throw KueRNFailure("invalid_media") }; return data
    }
    func image(_ uri: String, width: Int, height: Int, mimeType: String) throws -> Data {
        guard width > 0, height > 0, width <= 16_000_000 / height,
              ["image/png", "image/jpeg"].contains(mimeType) else { throw KueRNFailure("invalid_media") }
        let data = try read(uri, maximum: 10 * 1024 * 1024)
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) == 1, let type = CGImageSourceGetType(source) as String?,
              (mimeType == "image/png" ? type == "public.png" : type == "public.jpeg"),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue == width,
              (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue == height else { throw KueRNFailure("invalid_media") }
        return data
    }
    func export(_ data: Data, mimeType: String, request: String) throws -> String {
        _ = try KueRNWire.id(request)
        guard !data.isEmpty, data.count <= 20 * 1024 * 1024 else { throw KueRNFailure("invalid_media") }
        let folder = leases.appendingPathComponent(request, isDirectory: true); try directory(folder)
        let suffix: String
        switch mimeType { case "image/png": suffix = "png"; case "image/jpeg": suffix = "jpg"; case "video/mp4": suffix = "mp4"; default: throw KueRNFailure("invalid_media") }
        let url = folder.appendingPathComponent(UUID().uuidString + "." + suffix)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        live[request, default: [:]][url.absoluteString] = url; return url.absoluteString
    }
    func retire(_ request: String) {
        guard let items = live.removeValue(forKey: request) else { return }
        for url in items.values { if (try? checkedURL(url.absoluteString)) != nil { try? FileManager.default.removeItem(at: url) } }
        let folder = leases.appendingPathComponent(request, isDirectory: true)
        if (try? checkedURL(folder.absoluteString)) != nil { try? FileManager.default.removeItem(at: folder) }
    }
    func copy(request: String, uri: String) throws -> String {
        guard let url = live[request]?[uri] else { throw KueRNFailure("invalid_media") }
        let data = try read(url.absoluteString, maximum: 20 * 1024 * 1024)
        try directory(copies)
        let id = UUID().uuidString
        let destination = copies.appendingPathComponent("copy-\(id).\(url.pathExtension)")
        let marker = copies.appendingPathComponent("copy-\(id).json")
        try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        do {
            let value: [String: Any] = ["file": destination.lastPathComponent, "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]
            try JSONSerialization.data(withJSONObject: value).write(to: marker, options: [.atomic])
        } catch { try? FileManager.default.removeItem(at: destination); throw KueRNFailure("invalid_media") }
        return destination.absoluteString
    }
    func removeCopy(_ uri: String) throws {
        let url = try checkedURL(uri)
        guard url.deletingLastPathComponent() == copies,
              url.lastPathComponent.range(of: "^copy-[A-Fa-f0-9-]{36}\\.(png|jpg|mp4)$", options: .regularExpression) != nil else { throw KueRNFailure("invalid_media") }
        let marker = url.deletingPathExtension().appendingPathExtension("json")
        let data = try read(uri, maximum: 20 * 1024 * 1024)
        let record = try JSONSerialization.jsonObject(with: read(marker.absoluteString, maximum: 2048)) as? [String: String]
        guard record?["file"] == url.lastPathComponent,
              record?["sha256"] == SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() else { throw KueRNFailure("invalid_media") }
        try FileManager.default.removeItem(at: url); try FileManager.default.removeItem(at: marker)
    }
    func close() { for request in Array(live.keys) { retire(request) } }
}
