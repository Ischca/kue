import { expect, it, vi } from "vitest";
import { Outbox, OUTBOX_TTL, type OutboxEntry, type OutboxStorage } from "../src/outboxCore";
import { dispatchKueReport } from "../src/submission";
import type { KueLocalReport, KueReceipt } from "../src/types";

const config = { apiBaseUrl: "https://kue.test", projectKey: "pk_12345678" };
const report: KueLocalReport = { clientReportId: "kue_report_123456789", memo: "memo", crop: { x: 0, y: 0, width: 1, height: 1 },
  screenshot: { uri: "file:///temporary.jpg", width: 100, height: 100, mimeType: "image/jpeg" }, sourceSize: { width: 100, height: 100 }, context: { platform: "ios" }, capturedAt: "2026-09-26T00:00:00Z" };
const receipt: KueReceipt = { clientReportId: report.clientReportId, id: "report_123", status: "queued" };
const unavailable = { retryable: true };
function setup() {
  const entries = new Map<string, OutboxEntry>();
  const storage: OutboxStorage = {
    list: () => [...entries.values()].map((entry) => structuredClone(entry)),
    save: (entry) => { const saved = structuredClone(entry); saved.report.screenshot.uri = "file:///durable.jpg"; entries.set(entry.report.clientReportId, saved); return structuredClone(saved); },
    update: (entry) => { entries.set(entry.report.clientReportId, structuredClone(entry)); },
    remove: (id) => { entries.delete(id); },
  };
  let now = 1000;
  return { storage, entries, queue: new Outbox(storage, () => now), advance: (ms: number) => { now += ms; }, now: () => now };
}
it("persists before sending, survives a new instance, and reuses the original payload and id", async () => {
  const { queue, storage, now } = setup();
  const fail = vi.fn(async (saved: KueLocalReport) => { expect(saved.screenshot.uri).toBe("file:///durable.jpg"); throw unavailable; });
  expect(await queue.submit(report, "A", config, 100, fail)).toBeNull();
  const restarted = new Outbox(storage, now);
  const send = vi.fn(async () => receipt);
  await restarted.flush("A", config, send, { force: true });
  expect(send.mock.calls).toHaveLength(1); expect(restarted.list("A")).toEqual([]);
  expect(report.screenshot.uri).toBe("file:///temporary.jpg");
});
it("never retargets saved reports after a key or origin change", async () => {
  const { queue } = setup();
  await queue.submit(report, "A", config, 100, async () => { throw unavailable; });
  const send = vi.fn(); await queue.flush("B", config, send, { force: true });
  expect(send).not.toHaveBeenCalled();
  await expect(queue.submit(report, "B", config, 100, send)).rejects.toThrow(/送信先/);
  queue.discard("B", report.clientReportId); expect(queue.list("A")).toHaveLength(1);
});
it("respects backoff, Retry-After, foreground state, and blocks permanent rejections", async () => {
  const { queue, advance } = setup();
  await queue.submit(report, "A", config, 100, async () => { throw { retryable: true, retryAfterMs: 120_000 }; });
  const send = vi.fn(async () => { throw { retryable: false }; }); const error = vi.fn();
  advance(60_000); await queue.flush("A", config, send); expect(send).not.toHaveBeenCalled();
  advance(61_000); await queue.flush("A", config, send, { active: () => false }); expect(send).not.toHaveBeenCalled();
  await queue.flush("A", config, send, { error });
  expect(error).toHaveBeenCalledOnce(); expect(queue.list("A")[0]?.state).toBe("blocked");
  advance(3600_000); await queue.flush("A", config, send); expect(send).toHaveBeenCalledOnce();
});
it("serializes concurrent deliveries and refuses deletion while in flight", async () => {
  const { queue } = setup(); let resolve!: (value: KueReceipt) => void;
  const send = vi.fn(() => new Promise<KueReceipt>((done) => { resolve = done; }));
  const first = queue.submit(report, "A", config, 100, send);
  const second = queue.submit(report, "A", config, 100, send);
  await Promise.resolve(); expect(send).toHaveBeenCalledOnce();
  expect(() => queue.discard("A", report.clientReportId)).toThrow(/送信中/);
  resolve(receipt); expect(await first).toEqual(receipt); expect(await second).toEqual(receipt);
});
it("caps disk use across destinations and prunes only expired unsent data", async () => {
  const { queue, advance } = setup();
  const send = async () => { throw unavailable; };
  for (let i = 0; i < 10; i++) await queue.submit({ ...report, clientReportId: `${report.clientReportId}_${i}` }, i % 2 ? "A" : "B", config, 100, send);
  await expect(queue.submit(report, "A", config, 100, send)).rejects.toThrow(/上限/);
  advance(OUTBOX_TTL + 1); expect(queue.list("A")).toEqual([]);
  await expect(queue.submit(report, "A", config, 100, send)).resolves.toBeNull();
});
it("leaves the editor failed if durable storage fails and never contacts Cloud", async () => {
  const { storage } = setup(); storage.save = () => { throw new Error("disk full"); };
  const queue = new Outbox(storage); const send = vi.fn();
  await expect(queue.submit(report, "A", config, 100, send)).rejects.toThrow("disk full"); expect(send).not.toHaveBeenCalled();
});
it("distinguishes local acceptance from a Cloud receipt and keeps custom callback priority", async () => {
  const onQueued = vi.fn(); const onReceipt = vi.fn(); const submitPersistent = vi.fn(async () => null);
  const options = { cloud: config, onQueued, onReceipt, submitPersistent, submitCloud: vi.fn(), submitLocal: vi.fn() };
  await dispatchKueReport(report, options);
  expect(onQueued).toHaveBeenCalledWith({ clientReportId: report.clientReportId }); expect(onReceipt).not.toHaveBeenCalled();
  await dispatchKueReport(report, { ...options, onSubmit: vi.fn() }); expect(submitPersistent).toHaveBeenCalledOnce();
});
