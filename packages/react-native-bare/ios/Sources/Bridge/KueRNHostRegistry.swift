import Foundation

/// Mount order is stable across updates and enable/disable; each window has one owner.
struct KueRNHostRegistry {
    private struct Host { let id: String, engine: String; let mountOrder: Int, arrival: Int; var enabled: Bool; var window: String? }
    private var hosts: [Host] = []
    private var nextArrival = 0
    mutating func mount(_ id: String, enabled: Bool, engine: String = "default", mountOrder: Int = 1) {
        nextArrival += 1; hosts.append(Host(id: id, engine: engine, mountOrder: mountOrder, arrival: nextArrival, enabled: enabled, window: nil))
    }
    mutating func update(_ id: String, enabled: Bool, window: String?) {
        guard let index = hosts.firstIndex(where: { $0.id == id }) else { return }
        hosts[index].enabled = enabled; hosts[index].window = window
    }
    mutating func remove(_ id: String) { hosts.removeAll { $0.id == id } }
    var selected: Set<String> {
        var candidates: [String: [String: Host]] = [:]
        for host in hosts where host.enabled {
            guard let window = host.window else { continue }
            if let previous = candidates[window]?[host.engine], previous.mountOrder > host.mountOrder { continue }
            candidates[window, default: [:]][host.engine] = host
        }
        return Set(candidates.values.compactMap { $0.values.max(by: { $0.arrival < $1.arrival })?.id })
    }
}
