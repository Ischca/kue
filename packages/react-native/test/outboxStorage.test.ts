import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FileSystemApi } from "./support/fileSystemMock";

const mocks = vi.hoisted(() => ({ send: vi.fn(), fs: { api: "current" as FileSystemApi, root: "" } }));
// Exercise real file bytes/renames/restart state, with only the native filesystem bridge replaced.
vi.mock("expo-file-system", async () => (await import("./support/fileSystemMock")).fileSystemMock(mocks.fs));
vi.mock("../src/cloud", () => ({ submitKueReport: mocks.send, normalizeKueCloudConfig: (config: { apiBaseUrl: string; projectKey: string }) => ({ endpoint: config.apiBaseUrl + "/v1/reports", projectKey: config.projectKey }) }));
import { pendingKueReports, retryPendingKueReports, submitWithOutbox } from "../src/outbox";
import type { KueLocalReport } from "../src/types";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kue-outbox-storage-test-"));
const cloud = { apiBaseUrl: "https://kue.test", projectKey: "pk_test_test" };
const report: KueLocalReport = { clientReportId: "kue_report_123456789", memo: "memo", crop: { x: 0, y: 0, width: 1, height: 1 },
  screenshot: { uri: pathToFileURL(path.join(temporary, "original.jpg")).href, width: 100, height: 100, mimeType: "image/jpeg" }, sourceSize: { width: 100, height: 100 }, context: { platform: "ios" }, capturedAt: "2026-09-26T00:00:00Z" };
beforeEach(() => { mocks.fs.root = fs.mkdtempSync(path.join(temporary, "case-")); fs.writeFileSync(fileURLToPath(report.screenshot.uri), "image bytes"); mocks.send.mockReset(); });
afterAll(() => fs.rmSync(temporary, { recursive: true }));
describe.each(["current", "legacy"] as const)("expo-file-system %s API", (api) => {
  beforeEach(() => { mocks.fs.api = api; });
  it("keeps immutable metadata and image after temporary captures are deleted, then cleans accepted files", async () => {
    mocks.send.mockRejectedValueOnce({ retryable: true });
    expect(await submitWithOutbox(report, cloud)).toBeNull();
    fs.unlinkSync(fileURLToPath(report.screenshot.uri));
    expect(pendingKueReports(cloud)).toHaveLength(1);
    mocks.send.mockImplementationOnce(async (saved: KueLocalReport) => {
      expect(fs.readFileSync(fileURLToPath(saved.screenshot.uri), "utf8")).toBe("image bytes");
      return { id: "report_123", status: "queued", clientReportId: saved.clientReportId };
    });
    await retryPendingKueReports(cloud, { force: true });
    expect(pendingKueReports(cloud)).toEqual([]);
    expect(fs.readdirSync(path.join(mocks.fs.root, "kue-outbox-v1"))).toEqual([]);
  });
  it("survives a killed state replacement, and isolates old keys in the UI list", async () => {
    mocks.send.mockRejectedValue({ retryable: true }); await submitWithOutbox(report, cloud);
    fs.unlinkSync(path.join(mocks.fs.root, "kue-outbox-v1", `item-${report.clientReportId}`, "state.json"));
    expect(pendingKueReports(cloud)).toHaveLength(1);
    const changed = { ...cloud, projectKey: "pk_rotated_key" };
    expect(pendingKueReports(changed)).toEqual([]);
    expect(pendingKueReports(changed, true)[0]).toMatchObject({ currentDestination: false });
    await retryPendingKueReports(changed, { force: true }); expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("never submits an interrupted initial copy", () => {
    const incomplete = path.join(mocks.fs.root, "kue-outbox-v1", `item-${report.clientReportId}`);
    fs.mkdirSync(incomplete, { recursive: true }); fs.writeFileSync(path.join(incomplete, "capture.jpg"), "partial");
    expect(pendingKueReports(cloud)).toEqual([]); expect(mocks.send).not.toHaveBeenCalled(); expect(fs.existsSync(incomplete)).toBe(false);
  });
});
