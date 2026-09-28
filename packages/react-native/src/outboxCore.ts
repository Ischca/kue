import type { KueCloudConfig, KueLocalReport, KueReceipt } from "./types";

export interface OutboxEntry {
  report: KueLocalReport;
  destination: string;
  savedAt: number;
  bytes: number;
  attempts: number;
  nextAttemptAt: number;
  state: "pending" | "blocked";
}
export interface OutboxStorage {
  list(): OutboxEntry[];
  save(entry: OutboxEntry): OutboxEntry;
  update(entry: OutboxEntry): void;
  remove(id: string): void;
}
export const OUTBOX_MAX_COUNT = 10;
export const OUTBOX_MAX_BYTES = 50 * 1024 * 1024;
export const OUTBOX_TTL = 7 * 86400_000;

export class Outbox {
  private running = new Map<string, Promise<KueReceipt | null>>();
  private flushing = new Map<string, Promise<void>>();
  constructor(private storage: OutboxStorage, private now = Date.now) {}

  list(destination?: string): OutboxEntry[] {
    return this.prune().filter((item) => destination === undefined || item.destination === destination);
  }
  private prune(): OutboxEntry[] {
    const entries = this.storage.list();
    return entries.filter((entry) => {
      if (this.now() - entry.savedAt <= OUTBOX_TTL || this.running.has(entry.report.clientReportId)) return true;
      this.storage.remove(entry.report.clientReportId); return false;
    });
  }
  discard(destination: string, id: string): void {
    if (this.running.has(id)) throw new Error("送信中のレポートは削除できません。");
    if (this.list(destination).some((entry) => entry.report.clientReportId === id)) this.storage.remove(id);
  }
  discardStored(id: string): void {
    const entry = this.prune().find((item) => item.report.clientReportId === id);
    if (entry) this.discard(entry.destination, id);
  }
  async submit(report: KueLocalReport, destination: string, config: KueCloudConfig, bytes: number,
    send: (report: KueLocalReport, config: KueCloudConfig) => Promise<KueReceipt>): Promise<KueReceipt | null> {
    const entries = this.prune();
    let entry = entries.find((item) => item.report.clientReportId === report.clientReportId);
    if (entry && entry.destination !== destination) throw new Error("保存済みレポートの送信先を変更することはできません。");
    const payload = (value: KueLocalReport) => JSON.stringify({ ...value, screenshot: { ...value.screenshot, uri: "" } });
    if (entry && payload(entry.report) !== payload(report)) throw new Error("保存済みレポートの内容が変わっています。新しいレポートとして送信してください。");
    if (!entry) {
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024) throw new Error("保存する画像のサイズが不正です。");
      if (entries.length >= OUTBOX_MAX_COUNT || entries.reduce((sum, item) => sum + item.bytes, 0) + bytes > OUTBOX_MAX_BYTES) {
        throw new Error("KUEの送信待ちが上限です（10件・50MB）。送信待ちを送信または削除してください。");
      }
      entry = this.storage.save({ report, destination, bytes, savedAt: this.now(), attempts: 0, nextAttemptAt: 0, state: "pending" });
    }
    return this.deliver(entry, config, send);
  }
  flush(destination: string, config: KueCloudConfig,
    send: (report: KueLocalReport, config: KueCloudConfig) => Promise<KueReceipt>,
    options: { force?: boolean; active?: () => boolean; receipt?: (receipt: KueReceipt) => void; error?: (error: unknown) => void } = {}): Promise<void> {
    const existing = this.flushing.get(destination);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
    for (const snapshot of this.list(destination)) {
      if (options.active && !options.active()) break;
      const entry = this.list(destination).find((item) => item.report.clientReportId === snapshot.report.clientReportId);
      if (!entry) continue; // Discarded/accepted while an earlier item was uploading.
      if (!options.force && (entry.state === "blocked" || entry.nextAttemptAt > this.now())) continue;
      try {
        const receipt = await this.deliver(entry, config, send);
        if (receipt) { try { options.receipt?.(receipt); } catch { /* Accepted already. */ } }
      } catch (error) { options.error?.(error); }
    }
    }).finally(() => { this.flushing.delete(destination); });
    this.flushing.set(destination, operation);
    return operation;
  }
  private deliver(entry: OutboxEntry, config: KueCloudConfig,
    send: (report: KueLocalReport, config: KueCloudConfig) => Promise<KueReceipt>): Promise<KueReceipt | null> {
    const id = entry.report.clientReportId;
    const existing = this.running.get(id);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
      let receipt: KueReceipt;
      try { receipt = await send(entry.report, config); }
      catch (error) {
        const failure = error as { retryable?: boolean; retryAfterMs?: number } | null;
        entry.attempts += 1;
        entry.state = failure?.retryable === true ? "pending" : "blocked";
        const retryAfter = Number.isFinite(failure?.retryAfterMs) ? Math.max(0, failure!.retryAfterMs!) : 0;
        entry.nextAttemptAt = this.now() + Math.max(retryAfter, Math.min(3600_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 7)));
        this.storage.update(entry);
        if (entry.state === "blocked") throw error;
        return null;
      }
      // A failed local delete must not turn an accepted report into a new submission.
      // The same durable clientReportId makes a subsequent cleanup retry idempotent.
      try { this.storage.remove(id); } catch { /* Keep for idempotent recovery. */ }
      return receipt;
    }).finally(() => { this.running.delete(id); });
    this.running.set(id, operation);
    return operation;
  }
}
