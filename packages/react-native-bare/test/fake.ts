import type { BridgeEvent, BridgeRequest, NativeABI, RecorderABI } from "../src/bridge";
export const ok = (value: unknown = null) => JSON.stringify({ schemaVersion: 1, ok: true, value });
export const payload = (value: Record<string, unknown>) => JSON.stringify({ ...value, schemaVersion: 1 });
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export class FakeNative implements NativeABI {
  calls: { method: string; session?: string; action?: string; args?: Record<string, unknown> }[] = [];
  acknowledgements: { sessionId: string; requestId: string; response: Record<string, unknown> }[] = [];
  configs = new Map<string, Record<string, unknown>>();
  requestListener?: (request: BridgeRequest) => void;
  eventListener?: (event: BridgeEvent) => void;
  executeResult?: (action: string) => Promise<string>;
  standaloneResult?: (action: string, args: Record<string, unknown>) => Promise<string>;
  attachResult?: Promise<string>;
  async attach(session: string, config: string) { this.configs.set(session, JSON.parse(config)); this.calls.push({ method: "attach", session }); return this.attachResult ?? ok(); }
  async update(session: string, config: string) { this.configs.set(session, JSON.parse(config)); this.calls.push({ method: "update", session, args: JSON.parse(config) }); return ok(); }
  async detach(session: string) { this.calls.push({ method: "detach", session }); return ok(); }
  async execute(session: string, action: string, args: string) { this.calls.push({ method: "execute", session, action, args: JSON.parse(args) }); return this.executeResult?.(action) ?? ok(); }
  completeCallback(sessionId: string, requestId: string, response: string) { this.acknowledgements.push({ sessionId, requestId, response: JSON.parse(response) }); }
  async standalone(action: string, args: string) { const parsed = JSON.parse(args); this.calls.push({ method: "standalone", action, args: parsed }); return this.standaloneResult?.(action, parsed) ?? ok(); }
  async copyMediaFile(session: string, requestId: string, uri: string) { this.calls.push({ method: "copy", session, args: { requestId, uri } }); return ok("file:///copied/retained.png"); }
  async removeCopiedMediaFile(uri: string) { this.calls.push({ method: "removeCopy", args: { uri } }); return ok(); }
  onRequest(listener: (request: BridgeRequest) => void) { this.requestListener = listener; return { remove: () => { this.requestListener = undefined; } }; }
  onEvent(listener: (event: BridgeEvent) => void) { this.eventListener = listener; return { remove: () => { this.eventListener = undefined; } }; }
  request(sessionId: string, kind: string, body: Record<string, unknown>, requestId = "request_00000000001") { this.requestListener?.({ sessionId, kind, requestId, payload: payload(body) }); return requestId; }
  event(sessionId: string, kind: string, body: Record<string, unknown>) { this.eventListener?.({ sessionId, kind, payload: payload(body) }); }
}
export const fixture = {
  clientReportId: "report_fixture_000001", memo: "Check the cart button", capturedAt: "2026-10-12T01:00:00.000Z",
  context: { platform: "ios" as const, screenWidth: 390, screenHeight: 844 }, crop: { x: 0, y: 0, width: 1, height: 1 }, sourceSize: { width: 780, height: 1688 },
  screenshot: { uri: "file:///app/callback/capture.png", width: 780, height: 1688, mimeType: "image/png" as const },
};
export const fixtureState = { attached: true, enabled: true, foreground: true, reporterOpen: false, capturing: false, recordingActive: false, busy: false, savedCount: 0, pendingCount: 0, recordingAvailability: "ready", groupLocked: false, groupFull: false, recorderIncluded: true };
