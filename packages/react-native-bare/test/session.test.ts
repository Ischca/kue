import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeRuntime } from "../src/runtime";
import { KueSession } from "../src/session";
import { reportIssue, KueUnavailableError } from "../src/controller";
import type { KueProps } from "../src/types";
import { FakeNative, deferred, fixture, fixtureState, ok, settle } from "./fake";

const owners: KueSession[] = [], runtimes: BridgeRuntime[] = [];
function setup(props: KueProps = { onSubmit: () => {}, submitLabel: "Save" }) {
  const native = new FakeNative(), runtime = new BridgeRuntime(native, true), host = new KueSession(runtime, props);
  owners.push(host); runtimes.push(runtime); return { native, runtime, host };
}
afterEach(async () => { owners.splice(0).forEach(owner => owner.dispose()); await settle(); runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.useRealTimers(); });
describe("mounted host ownership and prepared callbacks", () => {
  it("uses the newest enabled foreground host and never detaches a replacement", async () => {
    const first = setup(), second = setup(); await first.host.ready(); await second.host.ready();
    await reportIssue({ memo: "first" }); expect(second.native.calls.at(-1)?.action).toBe("reportIssue");
    first.host.dispose(); await reportIssue(); expect(second.native.calls.at(-1)?.session).toBe(second.host.id);
    second.host.setForeground(false); await expect(reportIssue()).rejects.toBeInstanceOf(KueUnavailableError);
    second.host.setForeground(true); await reportIssue(); expect(second.native.calls.at(-1)?.action).toBe("reportIssue");
  });
  it("preserves mount order when older hosts re-enable/resume and falls back after newest disable", async () => {
    const oldProps: KueProps = { onSubmit: () => {}, submitLabel: "Save", enabled: false };
    const newerProps: KueProps = { onSubmit: () => {}, submitLabel: "Save" };
    const older = setup(oldProps), newer = setup(newerProps); await older.host.ready(); await newer.host.ready();
    older.host.update({ ...oldProps, enabled: true }); await settle(); await reportIssue();
    expect(newer.native.calls.at(-1)?.action).toBe("reportIssue"); expect(older.native.calls.filter(call => call.action === "reportIssue")).toHaveLength(0);
    older.host.setForeground(false); older.host.setForeground(true); await reportIssue(); expect(newer.native.calls.at(-1)?.action).toBe("reportIssue");
    newer.host.update({ ...newerProps, enabled: false }); await settle(); await reportIssue(); expect(older.native.calls.at(-1)?.action).toBe("reportIssue");
    newer.host.update({ ...newerProps, enabled: true }); await settle(); await reportIssue(); expect(newer.native.calls.at(-1)?.action).toBe("reportIssue");
  });
  it("uses stable creation order when Fabric/native attachment finishes out of order", async () => {
    const older = setup(), newer = setup(); await newer.host.ready(); await older.host.ready();
    const olderOrder = older.native.configs.get(older.host.id)?.mountOrder as number, newerOrder = newer.native.configs.get(newer.host.id)?.mountOrder as number;
    expect(olderOrder).toBeGreaterThan(0); expect(newerOrder).toBeGreaterThan(olderOrder); expect(newerOrder).toBeLessThanOrEqual(2147483647);
    await reportIssue(); expect(newer.native.calls.at(-1)?.action).toBe("reportIssue"); expect(older.native.calls.filter(call => call.action === "reportIssue")).toHaveLength(0);
    older.host.setForeground(false); older.host.setForeground(true); await reportIssue(); expect(newer.native.calls.at(-1)?.action).toBe("reportIssue");
  });
  it("resolves reportIssue when native editor opens, never from an unrelated outbox receipt", async () => {
    const { native, host } = setup(); await host.ready(); const opening = deferred<string>(); native.executeResult = () => opening.promise;
    let resolved = false; const promise = host.reportIssue().then(() => { resolved = true; }); await settle();
    native.event(host.id, "receipt", { receipt: { clientReportId: fixture.clientReportId, id: "cloud_fixture_000001", status: "queued" } }); await settle(); expect(resolved).toBe(false);
    opening.resolve(ok()); await promise; expect(resolved).toBe(true);
  });
  it("validates context/memo before allocating native capture and permits a corrected call", async () => {
    const { native, host } = setup(); await host.ready();
    await expect(host.reportIssue({ context: { screenWidth: NaN } })).rejects.toMatchObject({ code: "invalid_report" });
    await expect(host.reportIssue({ memo: "unsafe\0memo" })).rejects.toMatchObject({ code: "invalid_report" });
    await expect(host.reportIssue({ context: { platform: "ios" } } as unknown as import("../src/types").ReportIssueOptions)).rejects.toMatchObject({ code: "invalid_report" });
    expect(native.calls.filter(call => call.action === "reportIssue")).toHaveLength(0);
    await host.reportIssue({ memo: "fixed" }); expect(native.calls.at(-1)?.action).toBe("reportIssue");
  });
  it("retains the original callback/destination after rejected updates, while false/off always opt out", async () => {
    const original = vi.fn(), changed = vi.fn(), errors = vi.fn();
    const props: KueProps = { onSubmit: original, submitLabel: "Save", onError: errors };
    const { native, host } = setup(props); await host.ready(); const frozen = native.configs.get(host.id)!;
    host.update({ ...props, onSubmit: changed, enabled: false, recording: "off" }); await settle();
    expect(native.configs.get(host.id)).toMatchObject({ enabled: false, recording: "off", handlerId: frozen.handlerId });
    await expect(host.reportIssue()).rejects.toMatchObject({ code: "inactive_session" });
    host.update({ ...props, enabled: true, recording: "auto" }); await settle();
    native.request(host.id, "submit", { handlerId: frozen.handlerId, report: fixture }); await settle();
    expect(original).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled(); expect(errors).toHaveBeenCalledWith(expect.objectContaining({ code: "configuration_changed" }));
  });
  it("applies disabled opt-out even when a callback value is malformed", async () => {
    const { native, host } = setup(); await host.ready();
    host.update({ onSubmit: 42, submitLabel: "Save", enabled: false } as unknown as KueProps); await settle();
    expect(native.configs.get(host.id)?.enabled).toBe(false);
  });
  it("honours disable before invoking an error observer that reenters reportIssue", async () => {
    let reentered: Promise<unknown> | undefined;
    const props: KueProps = { onSubmit: () => {}, submitLabel: "Save", onError: () => { reentered = reportIssue().catch(error => error); } };
    const { native, host } = setup(props); await host.ready(); host.update({ ...props, enabled: false, onSubmit: () => {} });
    expect(await reentered).toBeInstanceOf(KueUnavailableError); expect(native.calls.filter(call => call.action === "reportIssue")).toHaveLength(0);
  });
  it("ACKs only after local asynchronous save and keeps exact report/ID for a manual retry", async () => {
    const save = deferred<void>(), values: unknown[] = [];
    const { native, host } = setup({ onSubmit: value => { values.push(value); return save.promise; }, submitLabel: "Save" }); await host.ready();
    const handlerId = native.configs.get(host.id)?.handlerId;
    native.request(host.id, "submit", { handlerId, report: fixture }); await settle(); expect(native.acknowledgements).toHaveLength(0);
    save.reject(new Error("private app error/file URI")); await settle();
    expect(native.acknowledgements[0].response).toMatchObject({ ok: false, error: { code: "local_save_failed" } });
    native.request(host.id, "submit", { handlerId, report: fixture }, "request_retry_000001"); await settle();
    expect(values[1]).toEqual(values[0]); expect(Object.isFrozen(values[0])).toBe(true);
  });
  it("rejects group without explicit handler and never falls back to singles", async () => {
    const single = vi.fn(); const { native, host } = setup({ onSubmit: single, submitLabel: "Save" }); await host.ready();
    native.request(host.id, "submitGroup", { handlerId: null, group: { clientReportId: "group_fixture_000001", title: "Two findings", findings: [fixture] } }); await settle();
    expect(single).not.toHaveBeenCalled(); expect(native.acknowledgements.at(-1)?.response.ok).toBe(false);
  });
  it("keeps exports live only within an awaited callback and retires them on cancellation", async () => {
    const saved = deferred<void>(); let copy: Promise<string> | undefined;
    const { native, runtime, host } = setup({ onSubmit: value => { copy = runtime.copyMediaFile(value.screenshot.uri); return saved.promise; }, submitLabel: "Save" }); await host.ready();
    const requestId = native.request(host.id, "submit", { handlerId: native.configs.get(host.id)?.handlerId, report: fixture }); await settle();
    expect(await copy).toBe("file:///copied/retained.png");
    native.event(host.id, "cancelRequest", { requestId }); await expect(runtime.copyMediaFile(fixture.screenshot.uri)).rejects.toMatchObject({ code: "inactive_request" });
    saved.resolve(); await settle(); expect(native.acknowledgements).toHaveLength(0);
    await runtime.removeCopiedMediaFile("file:///copied/retained.png"); expect(native.calls.at(-1)?.method).toBe("removeCopy");
  });
  it("cleans late custom capture exactly once after import/cancel and never ACKs a retired request", async () => {
    const captured = deferred<import("../src/types").KueCapturedImage>(), cleanup = vi.fn();
    const { native, host } = setup({ onSubmit: () => {}, submitLabel: "Save", capture: () => captured.promise }); await host.ready();
    const requestId = native.request(host.id, "capture", { operationId: "operation_capture_001", captureAdapterId: native.configs.get(host.id)?.captureAdapterId });
    native.event(host.id, "cancelRequest", { requestId }); native.event(host.id, "captureImported", { requestId });
    captured.resolve({ ...fixture.screenshot, capturedAt: fixture.capturedAt, cleanup }); await settle();
    expect(cleanup).toHaveBeenCalledOnce(); expect(native.acknowledgements).toHaveLength(0);
  });
  it("does not use a changed capture adapter after immutable rejection", async () => {
    const capture = vi.fn(async () => ({ ...fixture.screenshot, capturedAt: fixture.capturedAt })), replacement = vi.fn(async () => ({ ...fixture.screenshot, capturedAt: fixture.capturedAt }));
    const props: KueProps = { onSubmit: () => {}, submitLabel: "Save", capture };
    const { native, host } = setup(props); await host.ready(); host.update({ ...props, capture: replacement });
    native.request(host.id, "capture", { operationId: "operation_capture_001", captureAdapterId: native.configs.get(host.id)?.captureAdapterId }); await settle();
    expect(capture).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
  });
  it("cleans asynchronous trigger setup after unsubscribe before setup finishes", async () => {
    const setupResult = deferred<() => void>(), cleanup = vi.fn(); let open: (() => void) | undefined;
    const { native, host } = setup({ onSubmit: () => {}, submitLabel: "Save", triggers: [fn => { open = fn; return setupResult.promise; }] }); await host.ready();
    native.request(host.id, "subscribeTrigger", { triggerId: (native.configs.get(host.id)?.triggerIds as string[])[0], subscriptionId: "subscription_000001" });
    native.event(host.id, "unsubscribeTrigger", { subscriptionId: "subscription_000001" }); setupResult.resolve(cleanup); await settle(); open?.();
    expect(cleanup).toHaveBeenCalledOnce(); expect(native.calls.filter(call => call.action === "trigger")).toHaveLength(0); expect(native.acknowledgements).toHaveLength(0);
  });
  it("bounds callbacks and cleans late trigger setup after timeout", async () => {
    vi.useFakeTimers(); const result = deferred<() => void>(), cleanup = vi.fn();
    const { native, host } = setup({ onSubmit: () => {}, submitLabel: "Save", callbackTimeoutMs: 20, triggers: [() => result.promise] }); await host.ready();
    native.request(host.id, "subscribeTrigger", { triggerId: (native.configs.get(host.id)?.triggerIds as string[])[0], subscriptionId: "subscription_000001" });
    await vi.advanceTimersByTimeAsync(21); result.resolve(cleanup); await settle(); expect(cleanup).toHaveBeenCalledOnce();
    expect(native.acknowledgements).toHaveLength(1); expect(native.acknowledgements[0].response).toMatchObject({ ok: false, error: { code: "request_timeout" } });
  });
  it("deduplicates identical state and isolates throwing observers from successful ACK", async () => {
    const onState = vi.fn(() => { throw Error("observer"); }), onReceipt = vi.fn(() => { throw Error("observer"); }), onError = vi.fn(() => { throw Error("observer"); });
    const { native, host } = setup({ onSubmit: () => {}, submitLabel: "Save", onState, onReceipt, onError }); await host.ready();
    native.event(host.id, "state", { state: fixtureState }); native.event(host.id, "state", { state: { ...fixtureState } });
    native.event(host.id, "receipt", { receipt: { clientReportId: fixture.clientReportId, id: "cloud_fixture_000001", status: "queued" } });
    native.request(host.id, "submit", { handlerId: native.configs.get(host.id)?.handlerId, report: fixture }); await settle();
    expect(onState).toHaveBeenCalledOnce(); expect(onReceipt).toHaveBeenCalledOnce(); expect(native.acknowledgements.at(-1)?.response.ok).toBe(true);
  });
  it("disposal during native attach never registers a ghost host and removes optional recorder ownership", async () => {
    const native = new FakeNative(), gate = deferred<string>(), install = vi.fn(async () => ok()), remove = vi.fn(async () => ok()); native.attachResult = gate.promise;
    const runtime = new BridgeRuntime(native, true, { install, remove }), host = new KueSession(runtime, { onSubmit: () => {}, submitLabel: "Save" }); owners.push(host); runtimes.push(runtime);
    const attached = host.ready(); await settle(); host.dispose(); gate.resolve(ok()); await attached; await settle();
    expect(install).toHaveBeenCalledWith(host.id); expect(remove).toHaveBeenCalledWith(host.id); await expect(reportIssue()).rejects.toBeInstanceOf(KueUnavailableError);
  });
  it("disables pending local callbacks synchronously and cannot ACK late success after caller opt-out", async () => {
    const result = deferred<void>(), props: KueProps = { onSubmit: () => result.promise, submitLabel: "Save" };
    const { native, host } = setup(props); await host.ready();
    native.request(host.id, "submit", { handlerId: native.configs.get(host.id)?.handlerId, report: fixture }); await settle();
    host.update({ ...props, enabled: false }); result.resolve(); await settle();
    expect(native.acknowledgements).toHaveLength(1); expect(native.acknowledgements[0].response).toMatchObject({ ok: false, error: { code: "request_cancelled" } });
  });
  it("background retirement cleans a late capture once and rejects success even before native cancellation events", async () => {
    const result = deferred<import("../src/types").KueCapturedImage>(), cleanup = vi.fn();
    const { native, host } = setup({ onSubmit: () => {}, submitLabel: "Save", capture: () => result.promise }); await host.ready();
    const requestId = native.request(host.id, "capture", { operationId: "operation_capture_001", captureAdapterId: native.configs.get(host.id)?.captureAdapterId });
    host.setForeground(false); result.resolve({ ...fixture.screenshot, capturedAt: fixture.capturedAt, cleanup }); await settle();
    expect(cleanup).not.toHaveBeenCalled(); // File can still be in native import until its explicit retirement ACK.
    native.event(host.id, "captureImported", { requestId });
    expect(cleanup).toHaveBeenCalledOnce(); expect(native.acknowledgements).toHaveLength(1); expect(native.acknowledgements[0].response.ok).toBe(false);
  });
  it("removes an installed optional provider when core attach fails", async () => {
    const native = new FakeNative(), install = vi.fn(async () => ok()), remove = vi.fn(async () => ok()), error = vi.fn();
    native.attachResult = Promise.resolve(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "invalid_config", retryable: false } }));
    const runtime = new BridgeRuntime(native, true, { install, remove }), host = new KueSession(runtime, { onSubmit: () => {}, submitLabel: "Save", onError: error }); owners.push(host); runtimes.push(runtime);
    await host.ready(); expect(remove).toHaveBeenCalledWith(host.id); expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: "invalid_config" }));
    await expect(reportIssue()).rejects.toBeInstanceOf(KueUnavailableError);
  });
});
