import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeRuntime } from "../src/runtime";
import { FakeNative, fixture, ok } from "./fake";
const injected = vi.hoisted(() => ({ runtime: undefined as BridgeRuntime | undefined }));
vi.mock("../src/native", () => ({ getRuntime: () => injected.runtime! }));
import { getKueProjectFeatures, getKueReportStatus, submitKueReport, submitKueReportGroup } from "../src/cloud";
import { discardPendingKueReport, pendingKueReports, retryPendingKueReports } from "../src/outbox";
const cloud = { apiBaseUrl: "https://kue.example.test", projectKey: "pk_example_fixture" };
let native: FakeNative;
beforeEach(() => { injected.runtime?.dispose(); native = new FakeNative(); injected.runtime = new BridgeRuntime(native, true); });
describe("native standalone facade", () => {
  it("snapshots validated reports and groups before invoking the URI-only native HTTP path", async () => {
    const received = { clientReportId: fixture.clientReportId, id: "report_fixture_000001", status: "received" };
    native.standaloneResult = () => Promise.resolve(ok(received));
    expect(await submitKueReport(fixture, cloud)).toEqual(received);
    const args = native.calls[0].args!; expect(args.report).toEqual(fixture); expect(args.cloud).toMatchObject(cloud);
    await submitKueReportGroup({ clientReportId: "group_fixture_000001", title: "  Cart findings  ", findings: [fixture] }, cloud);
    expect(native.calls[1].action).toBe("submitReportGroup"); expect(native.calls[1].args?.group).toMatchObject({ title: "Cart findings" });
  });
  it("validates before any native upload and preserves strict permanent rejection metadata", async () => {
    await expect(submitKueReport({ ...fixture, memo: "" }, cloud)).rejects.toMatchObject({ code: "invalid_report" }); expect(native.calls).toHaveLength(0);
    native.standaloneResult = () => Promise.resolve(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "upload_rejected", retryable: false, httpStatus: 429, serverCode: "quota_exceeded" } }));
    await expect(submitKueReport(fixture, cloud)).rejects.toMatchObject({ status: 429, retryable: false, serverCode: "quota_exceeded" });
  });
  it("preserves minimal standalone context without filling or retargeting source platform", async () => {
    const value = { ...fixture, context: { platform: "android" as const } };
    native.standaloneResult = () => Promise.resolve(ok({ clientReportId: fixture.clientReportId, id: "report_fixture_000001", status: "received" }));
    await submitKueReport(value, cloud);
    expect((native.calls[0].args?.report as typeof value).context).toEqual({ platform: "android" });
  });
  it("uses only receipt capability for status and checks the returned report ID", async () => {
    const receipt = { id: "report_fixture_000001", receiptToken: "r".repeat(43) };
    native.standaloneResult = () => Promise.resolve(ok({ id: receipt.id, status: "completed", githubIssue: { number: 42, url: "https://github.com/example/project/issues/42" } }));
    expect((await getKueReportStatus(receipt, { apiBaseUrl: cloud.apiBaseUrl })).status).toBe("completed");
    expect(native.calls[0].args?.cloud).not.toHaveProperty("projectKey"); expect(native.calls[0].args?.receipt).toEqual(receipt);
    native.standaloneResult = () => Promise.resolve(ok({ id: "report_other_000001", status: "completed", githubIssue: null }));
    await expect(getKueReportStatus(receipt, { apiBaseUrl: cloud.apiBaseUrl })).rejects.toMatchObject({ code: "unexpected_response" });
  });
  it("preserves opaque future status error strings while rejecting non-string codes", async () => {
    const receipt = { id: "report_fixture_000001", receiptToken: "r".repeat(43) };
    for (const code of ["future server code", "future server code " + "x".repeat(64)]) {
      native.standaloneResult = () => Promise.resolve(ok({ id: receipt.id, status: "failed", githubIssue: null, error: { code } }));
      expect((await getKueReportStatus(receipt, { apiBaseUrl: cloud.apiBaseUrl })).error).toEqual({ code });
    }
    for (const code of [123, true, null, {}]) {
      native.standaloneResult = () => Promise.resolve(ok({ id: receipt.id, status: "failed", githubIssue: null, error: { code } }));
      await expect(getKueReportStatus(receipt, { apiBaseUrl: cloud.apiBaseUrl })).rejects.toMatchObject({ code: "unexpected_response" });
    }
  });
  it("exposes destination-bound queue metadata, manual force, and strict features", async () => {
    native.standaloneResult = action => Promise.resolve(ok(action === "pendingReports" ? [{ clientReportId: fixture.clientReportId, savedAt: 1234, state: "blocked", currentDestination: false }] : action === "getProjectFeatures" ? { schemaVersion: 1, groups: true, recording: { entitled: false, available: true } } : null));
    expect(await pendingKueReports(cloud, true)).toMatchObject([{ state: "blocked", currentDestination: false }]);
    await retryPendingKueReports(cloud, { force: true }); expect(native.calls[1].args?.force).toBe(true);
    await discardPendingKueReport(cloud, fixture.clientReportId); expect(native.calls[2].args?.clientReportId).toBe(fixture.clientReportId);
    expect((await getKueProjectFeatures(cloud)).recording).toEqual({ entitled: false, available: true });
  });
});
