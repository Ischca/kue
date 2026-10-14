import { afterEach, expect, it, vi } from "vitest";
import { BridgeRuntime } from "../src/runtime";
import { FakeNative, deferred, fixture, ok, settle } from "./fake";
afterEach(() => { vi.useRealTimers(); });
it("honours an active guard before retry without calling native transport", async () => {
  const native = new FakeNative(), runtime = new BridgeRuntime(native, true);
  await expect(runtime.standalone("retryPendingReports", { cloud: {} }, { active: () => false })).rejects.toMatchObject({ code: "request_cancelled" });
  expect(native.calls).toHaveLength(0); runtime.dispose();
});
it("cancels actual native retry when a custom guard turns false, retaining the same operation ID", async () => {
  vi.useFakeTimers(); const native = new FakeNative(), result = deferred<string>(), runtime = new BridgeRuntime(native, true); let active = true;
  native.standaloneResult = action => action === "retryPendingReports" ? result.promise : Promise.resolve(ok());
  const retry = runtime.standalone("retryPendingReports", { cloud: {} }, { active: () => active }); await settle(); active = false;
  await vi.advanceTimersByTimeAsync(251); const calls = native.calls.filter(call => call.method === "standalone");
  expect(calls.map(call => call.action)).toEqual(["retryPendingReports", "cancel"]);
  expect(calls[0].args?.operationId).toBe(calls[1].args?.operationId);
  result.resolve(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "request_cancelled", retryable: true } }));
  await expect(retry).rejects.toMatchObject({ code: "request_cancelled" }); runtime.dispose();
});
it("isolates queue observers and retires them after retry completion", async () => {
  const native = new FakeNative(), result = deferred<string>(), runtime = new BridgeRuntime(native, true), received = vi.fn(() => { throw new Error("observer"); });
  native.standaloneResult = () => result.promise;
  const retry = runtime.standalone("retryPendingReports", {}, { receipt: received }); await settle();
  const operationId = String(native.calls[0].args?.operationId);
  native.event(operationId, "receipt", { receipt: { clientReportId: fixture.clientReportId, id: "cloud_fixture_000001", status: "queued" } });
  result.resolve(ok(1)); expect(await retry).toBe(1);
  native.event(operationId, "receipt", { receipt: { clientReportId: fixture.clientReportId, id: "cloud_fixture_000001", status: "queued" } });
  expect(received).toHaveBeenCalledOnce(); runtime.dispose();
});
