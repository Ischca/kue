#if canImport(UIKit)
import UIKit

@MainActor private final class KueRNWeakBridge { weak var value: KueRNBridge?; init(_ value: KueRNBridge) { self.value = value } }
@MainActor private final class KueRNWeakAnchor {
    weak var view: UIView?
    let owner: String
    init(_ view: UIView, owner: String) { self.view = view; self.owner = owner }
}

/// Component IDs route only to their claimed runtime. Recycling removes only its owner.
@MainActor @objc(KueRNAnchorBindings) public final class KueRNAnchorBindings: NSObject {
    private static var anchors: [String: KueRNWeakAnchor] = [:]
    private static var owners: [String: KueRNWeakBridge] = [:]
    @objc public static func bind(_ view: UIView, sessionId: String, owner: String) {
        guard (try? KueRNWire.id(sessionId)) != nil, view.window != nil else { return }
        // An active claimed host cannot be retargeted by a second runtime's duplicate ID.
        if owners[sessionId]?.value != nil, let existing = anchors[sessionId]?.view,
           existing !== view, existing.window != nil { return }
        anchors[sessionId] = KueRNWeakAnchor(view, owner: owner)
        owners[sessionId]?.value?.bind(sessionId, window: view.window!)
    }
    @objc public static func remove(_ sessionId: String, owner: String) {
        guard anchors[sessionId]?.owner == owner else { return }
        anchors.removeValue(forKey: sessionId)
        owners[sessionId]?.value?.anchorRemoved(sessionId)
    }
    static func claim(_ id: String, bridge: KueRNBridge) throws -> UIWindow? {
        if let previous = owners[id]?.value, previous !== bridge { throw KueRNFailure("configuration_changed") }
        owners[id] = KueRNWeakBridge(bridge); return anchors[id]?.view?.window
    }
    static func release(_ id: String, bridge: KueRNBridge) {
        if owners[id]?.value === bridge { owners.removeValue(forKey: id) }
    }
}

/// Engine keys are the common CallInvoker identity, never logged or exposed to JS.
@MainActor public enum KueRNRecordingRegistry {
    private struct Entry { let owner: String, factory: @MainActor () -> any KueRecordingProvider }
    private static var entries: [String: [String: Entry]] = [:]
    private static var bridges: [String: KueRNWeakBridge] = [:]
    static func connect(_ engine: String, bridge: KueRNBridge) { bridges[engine] = KueRNWeakBridge(bridge) }
    static func disconnect(_ engine: String, bridge: KueRNBridge) {
        guard bridges[engine]?.value === bridge else { return }; bridges.removeValue(forKey: engine); entries.removeValue(forKey: engine)
    }
    public static func install(engine: String, session: String, owner: String, factory: @escaping @MainActor () -> any KueRecordingProvider) throws {
        _ = try KueRNWire.id(session)
        if let previous = entries[engine]?[session], previous.owner != owner { throw KueRNFailure("configuration_changed") }
        entries[engine, default: [:]][session] = Entry(owner: owner, factory: factory)
        bridges[engine]?.value?.installProvider(session, factory: factory)
    }
    public static func remove(engine: String, session: String, owner: String) {
        guard entries[engine]?[session]?.owner == owner else { return }; entries[engine]?.removeValue(forKey: session)
        bridges[engine]?.value?.installProvider(session, factory: nil)
    }
    public static func invalidate(engine: String, owner: String) {
        for (session, entry) in entries[engine] ?? [:] where entry.owner == owner { remove(engine: engine, session: session, owner: owner) }
    }
    static func provider(engine: String, session: String) -> (any KueRecordingProvider)? { entries[engine]?[session]?.factory() }
}
/// Weak per-window ownership across bridge runtimes; no session can retarget another's callbacks.
@MainActor enum KueRNUIOwners {
    private final class WeakSession { weak var value: KueRNSession?; init(_ value: KueRNSession) { self.value = value } }
    private static var registry = KueRNHostRegistry()
    private static var sessions: [String: WeakSession] = [:]
    static func mount(_ session: KueRNSession) {
        sessions[session.ownerID] = WeakSession(session); registry.mount(session.ownerID, enabled: session.enabled, engine: session.engineID, mountOrder: session.mountOrder)
    }
    static func refresh(_ session: KueRNSession) {
        guard sessions[session.ownerID]?.value === session else { return }
        registry.update(session.ownerID, enabled: session.enabled, window: session.window.map { String(describing: ObjectIdentifier($0)) })
        reconcile()
    }
    static func remove(_ session: KueRNSession) {
        guard sessions[session.ownerID]?.value === session else { return }
        session.setUIOwner(false); sessions.removeValue(forKey: session.ownerID); registry.remove(session.ownerID); reconcile()
    }
    private static func reconcile() {
        for (id, item) in sessions where item.value == nil { sessions.removeValue(forKey: id); registry.remove(id) }
        let selected = registry.selected
        let values = sessions.values.compactMap(\.value)
        // Release old owned presenters/draft/callbacks before installing any replacement.
        for session in values where !selected.contains(session.ownerID) { session.setUIOwner(false) }
        for session in values where selected.contains(session.ownerID) { session.setUIOwner(true) }
    }
}
#endif
