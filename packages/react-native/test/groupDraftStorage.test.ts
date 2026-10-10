import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FileSystemApi } from "./support/fileSystemMock";

const mocks = vi.hoisted(() => ({ fs: { api: "current" as FileSystemApi, root: "" } }));
vi.mock("expo-file-system", async () => (await import("./support/fileSystemMock")).fileSystemMock(mocks.fs));
import { findingMedia } from "../src/finding";
import { createGroupDraft, removeOrphanedGroupDrafts } from "../src/groupDraftStorage";
import type { KueLocalReport } from "../src/types";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kue-group-storage-test-"));
const finding = (name: string): KueLocalReport => ({ clientReportId: `kue_finding_${name}`, memo: name, crop: { x: 0, y: 0, width: 1, height: 1 },
  screenshot: { uri: pathToFileURL(path.join(mocks.fs.root, `${name}.jpg`)).href, width: 100, height: 100, mimeType: "image/jpeg" },
  sourceSize: { width: 100, height: 100 }, context: { platform: "ios" }, capturedAt: "2026-10-10T00:00:00Z" });
beforeEach(() => { mocks.fs.root = fs.mkdtempSync(path.join(temporary, "case-")); });
afterAll(() => fs.rmSync(temporary, { recursive: true }));
describe.each(["current", "legacy"] as const)("expo-file-system %s API", (api) => {
  beforeEach(() => { mocks.fs.api = api; });
  it("owns a complete copy when add returns, so the Reporter can release its capture at once", () => {
    const draft = createGroupDraft();
    for (const name of ["first", "second"]) {
      const source = finding(name);
      fs.writeFileSync(fileURLToPath(source.screenshot.uri), `${name} bytes`);
      draft.add(source);
      fs.unlinkSync(fileURLToPath(source.screenshot.uri));
    }
    const copies = draft.findings.map(item => fileURLToPath(findingMedia(item).uri));
    expect(copies.map(file => fs.readFileSync(file, "utf8"))).toEqual(["first bytes", "second bytes"]);
    draft.discard();
    expect(copies.filter(file => fs.existsSync(file))).toEqual([]);
  });
  const add = (draft: ReturnType<typeof createGroupDraft>, name: string) => {
    const source = finding(name);
    fs.writeFileSync(fileURLToPath(source.screenshot.uri), `${name} bytes`);
    draft.add(source);
  };
  const copyText = (draft: ReturnType<typeof createGroupDraft>) => fs.readFileSync(fileURLToPath(findingMedia(draft.findings[0]!).uri), "utf8");
  it("deletes draft directories left by an earlier runtime and leaves other cache entries", () => {
    const orphan = path.join(mocks.fs.root, "kue-group-kue_earlier_runtime");
    fs.mkdirSync(orphan); fs.writeFileSync(path.join(orphan, "copy.jpg"), "earlier bytes");
    fs.mkdirSync(path.join(mocks.fs.root, "ImageManipulator"));
    fs.writeFileSync(path.join(mocks.fs.root, "kue-group-x"), "not a draft directory");
    const draft = createGroupDraft(); add(draft, "live");
    removeOrphanedGroupDrafts(); removeOrphanedGroupDrafts();
    expect(fs.existsSync(orphan)).toBe(false);
    expect(copyText(draft)).toBe("live bytes");
    expect(fs.existsSync(path.join(mocks.fs.root, "ImageManipulator"))).toBe(true);
    expect(fs.readFileSync(path.join(mocks.fs.root, "kue-group-x"), "utf8")).toBe("not a draft directory");
  });
  it("keeps a draft emptied by remove, so findings added to it later survive", () => {
    const draft = createGroupDraft(); add(draft, "first");
    draft.remove(draft.findings[0]!.clientReportId);
    removeOrphanedGroupDrafts();
    add(draft, "second");
    removeOrphanedGroupDrafts();
    expect(copyText(draft)).toBe("second bytes");
  });
  it("never throws when the cache directory cannot be listed", () => {
    mocks.fs.root = path.join(temporary, "missing-cache");
    expect(() => removeOrphanedGroupDrafts()).not.toThrow();
  });
});
