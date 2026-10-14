import { call, encode, fail, identifier, parse, safeObserve, uniqueId, type BridgeEvent, type BridgeRequest, type NativeABI, type RecorderABI } from "./bridge";
import { errorFromNative } from "./bridge";
import { receipt } from "./models";
import type { KueRetryOptions } from "./types";
export interface SessionEndpoint { request(value: BridgeRequest): void; event(value: BridgeEvent): void }
interface Lease { sessionId: string; requestId: string; uri: string }
/** Pure JS boundary; native ABI injection lets lifecycle tests exercise real races without RN. */
export class BridgeRuntime {
  readonly sessions = new Map<string, SessionEndpoint>();
  private readonly leases = new Map<string, Lease[]>();
  private readonly standaloneObservers = new Map<string, KueRetryOptions>();
  private readonly subscriptions: { remove(): void }[];
  constructor(readonly native: NativeABI, readonly development: boolean, readonly recorder?: RecorderABI) {
    this.subscriptions = [native.onRequest(request => {
      const session = this.sessions.get(request.sessionId);
      if (session) session.request(request);
      else this.ack(request, { ok: false, error: { code: "request_cancelled", retryable: true } });
    }), native.onEvent(event => {
      const session = this.sessions.get(event.sessionId);
      if (session) { session.event(event); return; }
      const observer = this.standaloneObservers.get(event.sessionId);
      if (!observer) return;
      try {
        const payload = parse(event.payload);
        if (event.kind === "receipt") { const value = receipt(payload.receipt); safeObserve(() => observer.receipt?.(value)); }
        if (event.kind === "error") { const value = errorFromNative(payload.error); safeObserve(() => observer.error?.(value)); }
      } catch { /* Invalid observer payload cannot corrupt operation completion. */ }
    })];
  }
  ack(request: BridgeRequest, response: Record<string, unknown>): void {
    try { this.native.completeCallback(request.sessionId, request.requestId, encode(response)); } catch { /* Runtime may already be invalidated. */ }
  }
  lease(sessionId: string, requestId: string, uris: readonly string[]): () => void {
    const entries = uris.map(uri => ({ sessionId, requestId, uri }));
    for (const entry of entries) this.leases.set(entry.uri, [...(this.leases.get(entry.uri) ?? []), entry]);
    return () => { for (const entry of entries) { const left = (this.leases.get(entry.uri) ?? []).filter(v => v !== entry); if (left.length) this.leases.set(entry.uri, left); else this.leases.delete(entry.uri); } };
  }
  async copyMediaFile(uri: string): Promise<string> {
    const lease = this.leases.get(uri)?.at(-1);
    if (!lease) return fail("inactive_request");
    const value = await call(() => this.native.copyMediaFile(lease.sessionId, lease.requestId, uri));
    if (typeof value !== "string" || !value.startsWith("file:///")) return fail("unexpected_response");
    return value;
  }
  async removeCopiedMediaFile(uri: string): Promise<void> { await call(() => this.native.removeCopiedMediaFile(uri)); }
  async standalone(action: string, args: Record<string, unknown>, options: KueRetryOptions = {}): Promise<unknown> {
    const operationId = uniqueId("operation");
    const active = () => { try { return options.active?.() !== false; } catch { return false; } };
    if (!active()) return fail("request_cancelled");
    this.standaloneObservers.set(operationId, options);
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return; cancelled = true;
      void call(() => this.native.standalone("cancel", encode({ operationId }))).catch(() => {});
    };
    const interval = options.active ? setInterval(() => { if (!active()) cancel(); }, 250) : undefined;
    try {
      const value = await call(() => this.native.standalone(action, encode({ ...args, operationId })));
      // Acceptance remains authoritative if the native transport reports success, including a concurrent opt-out.
      return value;
    } finally { if (interval !== undefined) clearInterval(interval); this.standaloneObservers.delete(operationId); }
  }
  dispose(): void {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.sessions.clear(); this.leases.clear(); this.standaloneObservers.clear();
  }
}
