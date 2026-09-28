import type { KueLocalReport, NormalizedCrop } from "./types";

type ReleaseImage = (uri: string) => void;

interface PreparedEntry {
  key: string;
  report: KueLocalReport;
}

export class PreparedReportInvalidatedError extends Error {
  constructor() {
    super("Prepared KUE report was invalidated before it became active.");
    this.name = "PreparedReportInvalidatedError";
  }
}

export function createPreparedReportKey(memo: string, crop: NormalizedCrop): string {
  return JSON.stringify([memo.trim(), crop.x, crop.y, crop.width, crop.height]);
}

/** @internal Owns a cropped screenshot until submission succeeds or its draft changes. */
export class PreparedReportCache {
  private entry: PreparedEntry | null = null;
  private generation = 0;

  async getOrCreate(
    key: string,
    create: () => Promise<KueLocalReport>,
    sourceUri: string,
    release: ReleaseImage,
  ): Promise<KueLocalReport> {
    if (this.entry?.key === key) return this.entry.report;

    this.discard(sourceUri, release);
    const generation = this.generation;
    const report = await create();

    if (generation !== this.generation) {
      if (report.screenshot.uri !== sourceUri) release(report.screenshot.uri);
      throw new PreparedReportInvalidatedError();
    }

    this.entry = { key, report };
    return report;
  }

  discardIfDraftChanged(key: string, sourceUri: string, release: ReleaseImage): void {
    if (this.entry && this.entry.key !== key) this.discard(sourceUri, release);
  }

  discard(sourceUri: string | undefined, release: ReleaseImage): void {
    const current = this.entry;
    this.entry = null;
    this.generation += 1;

    if (current && current.report.screenshot.uri !== sourceUri) {
      release(current.report.screenshot.uri);
    }
  }

  take(): KueLocalReport | null {
    const current = this.entry;
    this.entry = null;
    this.generation += 1;
    return current?.report ?? null;
  }
}
