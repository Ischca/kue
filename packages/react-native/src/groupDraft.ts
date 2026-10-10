import { createClientReportId } from "./clientReportId";
import type { KueFinding, KueReportGroup } from "./types";
import { findingLimit } from "./finding";
import { currentKueText } from "./i18n";

export interface GroupDraftStorage {
  copy(report: KueFinding): { report: KueFinding; bytes: number };
  release(report: KueFinding): void;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** No React/Expo dependency. Owns copied media; never sends without confirmation. */
export class GroupDraft {
  private items: { report: KueFinding; bytes: number }[] = [];
  private prepared: KueReportGroup | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;
  constructor(private readonly storage: GroupDraftStorage) {}
  get findings(): readonly KueFinding[] { return clone(this.items.map(item => item.report)); }
  get locked(): boolean { return this.prepared !== null; }
  /** A full draft takes no new finding until one is removed or the Issue is created. */
  get full(): boolean { return this.items.length >= 10; }
  get submitting(): boolean { return this.running !== null; }
  private editable(): void {
    if (this.disposed) throw new Error(currentKueText().errors.draftClosed);
    if (this.locked) throw new Error(currentKueText().errors.draftLocked);
  }
  add(report: KueFinding): void {
    this.editable();
    if (this.items.some(item => item.report.clientReportId === report.clientReportId)) return;
    if (this.full) throw new Error(currentKueText().errors.draftFull);
    const item = this.storage.copy(clone(report));
    if (!Number.isFinite(item.bytes) || item.bytes <= 0 || item.bytes > findingLimit(report) ||
      this.items.reduce((sum, value) => sum + value.bytes, item.bytes) > 20 * 1024 * 1024) {
      this.storage.release(item.report);
      throw new Error(currentKueText().errors.mediaTotal);
    }
    this.items.push(item);
  }
  remove(id: string): void {
    this.editable();
    const index = this.items.findIndex(item => item.report.clientReportId === id);
    if (index < 0) return;
    this.storage.release(this.items[index]!.report);
    this.items.splice(index, 1);
  }
  submit(title: string, send: (group: KueReportGroup) => Promise<void>): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed) return Promise.reject(new Error(currentKueText().errors.draftClosed));
    if (!this.prepared) {
      if (!title.trim() || /[\r\n\u0000]/u.test(title) || Array.from(title.trim()).length > 200 || !this.items.length) {
        return Promise.reject(new Error(currentKueText().errors.titleRequired));
      }
      this.prepared = { clientReportId: createClientReportId(), title: title.trim(), findings: this.findings };
    }
    const snapshot = clone(this.prepared);
    this.running = Promise.resolve().then(() => send(snapshot)).then(() => { this.disposed = true; })
      .finally(() => { this.running = null; if (this.disposed) this.release(); });
    return this.running;
  }
  discard(): void {
    if (this.running) throw new Error(currentKueText().errors.draftSending);
    this.dispose();
  }
  dispose(): void {
    this.disposed = true;
    if (!this.running) this.release();
  }
  private release(): void {
    for (const item of this.items) { try { this.storage.release(item.report); } catch { /* Cache eviction also releases temporary files. */ } }
    this.items = [];
  }
}
