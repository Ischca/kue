import { Directory, File, Paths } from "expo-file-system";
import { normalizeKueCloudConfig, submitKueReport } from "./cloud";
import { copyFileSync, moveFileSync } from "./fileSync";
import { Outbox, type OutboxEntry, type OutboxStorage } from "./outboxCore";
import type { KueCloudConfig, KueLocalReport, KueReceipt } from "./types";

const root = () => new Directory(Paths.document, "kue-outbox-v1");
const validId = (id: string) => /^[A-Za-z0-9._~-]{16,128}$/u.test(id);
const directory = (id: string) => {
  if (!validId(id)) throw new Error("Invalid KUE outbox report ID.");
  return new Directory(root(), `item-${id}`);
};
const imageFile = (entry: OutboxEntry) => new File(directory(entry.report.clientReportId), entry.report.screenshot.mimeType === "image/png" ? "capture.png" : "capture.jpg");

function writeEntry(entry: OutboxEntry, initial = false): void {
  const dir = directory(entry.report.clientReportId);
  const marker = new File(dir, initial ? "report.json" : "state.json");
  const temp = new File(dir, "state.tmp");
  temp.write(JSON.stringify(entry));
  // The immutable report.json survives a killed state replacement (Expo 54–57).
  // Losing retry bookkeeping only causes a replay with the SAME idempotency key.
  if (marker.exists) marker.delete();
  moveFileSync(temp, marker);
}
const storage: OutboxStorage = {
  list() {
    if (!root().exists) return [];
    const entries: OutboxEntry[] = [];
    for (const child of root().list()) {
      if (!(child instanceof Directory) || !child.name.startsWith("item-") || !validId(child.name.slice(5))) continue;
      const marker = new File(child, "report.json");
      // A killed initial copy is not a committed report; never send partial entries.
      if (!marker.exists) { child.delete(); continue; }
      const original = JSON.parse(marker.textSync()) as OutboxEntry;
      let entry = original;
      const state = new File(child, "state.json");
      if (state.exists) {
        try { entry = JSON.parse(state.textSync()) as OutboxEntry; } catch { /* Recover immutable submission. */ }
      }
      if (!entry?.report || entry.report.clientReportId !== child.name.slice(5) ||
        !Number.isFinite(entry.savedAt) || !Number.isFinite(entry.bytes) || entry.bytes <= 0 ||
        typeof entry.destination !== "string" || entry.destination !== original.destination || !["pending", "blocked"].includes(entry.state)) {
        throw new Error("KUEの送信待ちデータを読み込めませんでした。");
      }
      entry.report.screenshot.uri = imageFile(entry).uri;
      entries.push(entry);
    }
    return entries.sort((a, b) => a.savedAt - b.savedAt);
  },
  save(entry) {
    const dir = directory(entry.report.clientReportId);
    dir.create({ intermediates: true, idempotent: true });
    const image = imageFile(entry);
    copyFileSync(new File(entry.report.screenshot.uri), image);
    const saved = { ...entry, report: { ...entry.report, screenshot: { ...entry.report.screenshot, uri: image.uri } } };
    writeEntry(saved, true);
    return saved;
  },
  update: writeEntry,
  remove(id) { const dir = directory(id); if (dir.exists) dir.delete(); },
};
const outbox = new Outbox(storage);
function destination(config: KueCloudConfig): string {
  const normalized = normalizeKueCloudConfig(config);
  return JSON.stringify([normalized.endpoint, normalized.projectKey]);
}

export function pendingKueReports(config: KueCloudConfig, includeOtherDestinations = false) {
  const current = destination(config);
  return outbox.list(includeOtherDestinations ? undefined : current).map((entry) => ({ clientReportId: entry.report.clientReportId,
    savedAt: entry.savedAt, state: entry.state, currentDestination: entry.destination === current }));
}
/** @internal The built-in outbox can discard, but never retarget, old destinations. */
export function discardStoredKueReport(id: string): void { outbox.discardStored(id); }
export function discardPendingKueReport(config: KueCloudConfig, id: string): void {
  outbox.discard(destination(config), id);
}
export function retryPendingKueReports(config: KueCloudConfig, options: {
  force?: boolean; active?: () => boolean; receipt?: (receipt: KueReceipt) => void; error?: (error: unknown) => void;
} = {}): Promise<void> {
  return outbox.flush(destination(config), config, submitKueReport, options);
}
export function submitWithOutbox(report: KueLocalReport, config: KueCloudConfig): Promise<KueReceipt | null> {
  return outbox.submit(report, destination(config), config, new File(report.screenshot.uri).size, submitKueReport);
}
