import { describe, expect, it, vi } from "vitest";
import { GroupDraft, type GroupDraftStorage } from "../src/groupDraft";
import type { KueLocalReport, KueReportGroup } from "../src/types";
import { findingMedia, withFindingUri } from "../src/finding";
const finding = (id = "one"): KueLocalReport => ({ clientReportId: `finding_${id}_12345678`, memo: `Note ${id}`,
  crop: { x: 0, y: 0, width: 1, height: 1 }, screenshot: { uri: `file:///original-${id}.png`, mimeType: "image/png", width: 10, height: 10 },
  sourceSize: { width: 10, height: 10 }, context: { platform: "ios" }, capturedAt: "2026-10-08T00:00:00.000Z" });
function setup(bytes = 100) {
  const storage: GroupDraftStorage = {
    copy: vi.fn(report => ({ bytes, report: withFindingUri(report, findingMedia(report).uri.replace("original", "owned")) })),
    release: vi.fn(),
  };
  return { storage, draft: new GroupDraft(storage) };
}
describe("group draft ownership and idempotence", () => {
  it("owns video separately, accepts 20MiB video but keeps the mixed total at 20MiB", async () => {
    const { draft, storage } = setup(15 * 1024 * 1024);
    const video = { clientReportId: "video_finding_0001", memo: "Animation", context: { platform: "ios" as const }, capturedAt: "2026-10-08T00:00:00.000Z",
      video: { uri: "file:///original.mp4", width: 160, height: 240, durationMs: 1000, byteSize: 15 * 1024 * 1024,
        mimeType: "video/mp4" as const, capturedAt: "2026-10-08T00:00:00.000Z" } };
    draft.add(video); video.video.uri = "file:///caller-changed.mp4";
    expect(findingMedia(draft.findings[0]!).uri).toBe("file:///owned.mp4");
    expect(() => draft.add({ ...video, clientReportId: "video_finding_0002" })).toThrow("20MiB");
    const send = vi.fn().mockResolvedValue(undefined); await draft.submit("Video review", send);
    expect(send.mock.calls[0]![0].findings[0].video.mimeType).toBe("video/mp4");
    expect(storage.release).toHaveBeenCalledTimes(2);
  });
  it("copies each finding, does not submit, ignores repeated add, and never releases the caller's image", () => {
    const { draft, storage } = setup(); const original = finding();
    draft.add(original); draft.add(original); draft.add(finding("two"));
    expect(storage.copy).toHaveBeenCalledTimes(2);
    original.memo = "caller changed";
    expect(draft.findings[0]!.memo).toBe("Note one");
    const snapshot = draft.findings; snapshot[0]!.memo = "consumer changed";
    expect(draft.findings[0]!.memo).toBe("Note one");
    draft.remove(original.clientReportId);
    expect(draft.findings).toHaveLength(1);
    draft.discard(); expect(draft.findings).toHaveLength(0);
    expect(vi.mocked(storage.release).mock.calls.every(([report]) => "screenshot" in report && report.screenshot.uri.includes("owned"))).toBe(true);
  });
  it("rejects count/byte limits and releases only rejected copies", () => {
    const { draft } = setup(); for (let i = 0; i < 10; i++) draft.add(finding(String(i)));
    expect(draft.full).toBe(true);
    expect(() => draft.add(finding("0"))).not.toThrow();
    expect(() => draft.add(finding("11"))).toThrow("10件");
    draft.remove(finding("0").clientReportId); expect(draft.full).toBe(false);
    const large = setup(10 * 1024 * 1024); large.draft.add(finding()); large.draft.add(finding("two"));
    expect(() => large.draft.add(finding("three"))).toThrow("20MiB");
    expect(large.draft.findings).toHaveLength(2); expect(large.storage.release).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, NaN, Infinity, 10 * 1024 * 1024 + 1])("rejects invalid bytes %s", bytes => {
    const { draft, storage } = setup(bytes); expect(() => draft.add(finding())).toThrow();
    expect(draft.findings).toEqual([]); expect(storage.release).toHaveBeenCalledTimes(1);
  });
  it("freezes one payload after an ambiguous attempt, retaining exact ID/order/title on retry", async () => {
    const { draft, storage } = setup(); draft.add(finding()); draft.add(finding("two"));
    const attempts: KueReportGroup[] = [];
    await expect(draft.submit("Original title", async group => {
      attempts.push(structuredClone(group)); group.findings[0]!.memo = "handler mutated"; throw new Error("timeout");
    })).rejects.toThrow("timeout");
    expect(storage.release).not.toHaveBeenCalled(); expect(draft.locked).toBe(true);
    expect(() => draft.add(finding("three"))).toThrow(); expect(() => draft.remove(finding().clientReportId)).toThrow();
    await draft.submit("Changed title must not take effect", async group => { attempts.push(group); });
    expect(attempts[1]).toEqual(attempts[0]); expect(storage.release).toHaveBeenCalledTimes(2);
    await expect(draft.submit("Again", async () => {})).rejects.toThrow("閉じられ");
  });
  it("deduplicates simultaneous submit and defers disposal until the upload has finished", async () => {
    const { draft, storage } = setup(); draft.add(finding());
    let finish!: () => void; const upload = new Promise<void>(resolve => { finish = resolve; });
    const send = vi.fn(() => upload);
    const first = draft.submit("title", send); const second = draft.submit("title", send);
    expect(first).toBe(second); expect(() => draft.discard()).toThrow("送信中");
    draft.dispose(); expect(storage.release).not.toHaveBeenCalled();
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
    finish(); await first; expect(storage.release).toHaveBeenCalledTimes(1);
  });
  it("does not freeze an empty or invalid draft", async () => {
    const { draft } = setup(); const send = vi.fn();
    await expect(draft.submit("title", send)).rejects.toThrow(); draft.add(finding());
    await expect(draft.submit("bad\ntitle", send)).rejects.toThrow();
    expect(draft.locked).toBe(false); expect(send).not.toHaveBeenCalled();
  });
});
