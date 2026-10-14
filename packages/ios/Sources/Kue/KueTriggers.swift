import Foundation

public struct KueTriggerSource {
    public let subscribe: @MainActor (@escaping @MainActor () -> Void) async throws -> (@MainActor () -> Void)
    public init(subscribe: @escaping @MainActor (@escaping @MainActor () -> Void) async throws -> (@MainActor () -> Void)) {
        self.subscribe = subscribe
    }
}
@MainActor final class KueTriggerManager {
    private var generation = 0, active = false
    private var tasks: [Task<Void, Never>] = []
    private var teardowns: [@MainActor () -> Void] = []
    func start(_ sources: [KueTriggerSource], open: @escaping @MainActor () -> Void, error onError: @escaping @MainActor (Error) -> Void) {
        stop(); active = true; let version = generation
        for source in sources {
            tasks.append(Task { [weak self] in
                do {
                    let teardown = try await source.subscribe { [weak self] in
                        guard let self, self.active, self.generation == version else { return }; open()
                    }
                    guard let self, !Task.isCancelled, self.active, self.generation == version else { teardown(); return }
                    self.teardowns.append(teardown)
                } catch { if let self, self.active, self.generation == version, !Task.isCancelled { onError(error) } }
            })
        }
    }
    func stop() {
        generation += 1; active = false; tasks.forEach { $0.cancel() }; tasks = []
        teardowns.forEach { $0() }; teardowns = []
    }
    deinit {
        tasks.forEach { $0.cancel() }; let callbacks = teardowns
        Task { @MainActor in callbacks.forEach { $0() } }
    }
}
