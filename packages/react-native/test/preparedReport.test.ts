import { describe, expect, it, vi } from "vitest";

import {
  createPreparedReportKey,
  PreparedReportCache,
  PreparedReportInvalidatedError,
} from "../src/preparedReport";
import type { KueLocalReport } from "../src/types";

const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

function report(clientReportId: string, screenshotUri: string): KueLocalReport {
  return {
    clientReportId,
    memo: "profile padding",
    crop,
    screenshot: {
      uri: screenshotUri,
      width: 500,
      height: 600,
      mimeType: "image/jpeg",
    },
    sourceSize: { width: 1_000, height: 1_000 },
    context: { platform: "ios" },
    capturedAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("PreparedReportCache", () => {
  it("reuses the exact report and screenshot for the same logical payload", async () => {
    const cache = new PreparedReportCache();
    const release = vi.fn();
    const create = vi.fn(async () => report("kue_first", "file:///crop-first.jpg"));
    const key = createPreparedReportKey(" profile padding ", crop);

    const first = await cache.getOrCreate(key, create, "file:///source.jpg", release);
    const retry = await cache.getOrCreate(key, create, "file:///source.jpg", release);

    expect(retry).toBe(first);
    expect(retry.clientReportId).toBe("kue_first");
    expect(create).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the old crop and creates a new report when the payload changes", async () => {
    const cache = new PreparedReportCache();
    const release = vi.fn();

    await cache.getOrCreate(
      createPreparedReportKey("first", crop),
      async () => report("kue_first", "file:///crop-first.jpg"),
      "file:///source.jpg",
      release,
    );
    const next = await cache.getOrCreate(
      createPreparedReportKey("second", crop),
      async () => report("kue_second", "file:///crop-second.jpg"),
      "file:///source.jpg",
      release,
    );

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith("file:///crop-first.jpg");
    expect(next.clientReportId).toBe("kue_second");
  });

  it("does not release a full-screen screenshot owned by the capture", async () => {
    const cache = new PreparedReportCache();
    const release = vi.fn();

    await cache.getOrCreate(
      createPreparedReportKey("first", crop),
      async () => report("kue_first", "file:///source.jpg"),
      "file:///source.jpg",
      release,
    );
    cache.discard("file:///source.jpg", release);

    expect(release).not.toHaveBeenCalled();
  });

  it("transfers screenshot ownership on success", async () => {
    const cache = new PreparedReportCache();
    const release = vi.fn();
    const prepared = report("kue_first", "file:///crop-first.jpg");

    await cache.getOrCreate(
      createPreparedReportKey("first", crop),
      async () => prepared,
      "file:///source.jpg",
      release,
    );

    expect(cache.take()).toBe(prepared);
    cache.discard("file:///source.jpg", release);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases a crop that finishes generating after the Reporter was invalidated", async () => {
    const cache = new PreparedReportCache();
    const release = vi.fn();
    let finishCreating: ((value: KueLocalReport) => void) | undefined;
    const create = () =>
      new Promise<KueLocalReport>((resolve) => {
        finishCreating = resolve;
      });

    const pending = cache.getOrCreate(
      createPreparedReportKey("first", crop),
      create,
      "file:///source.jpg",
      release,
    );
    cache.discard("file:///source.jpg", release);
    finishCreating?.(report("kue_stale", "file:///late-crop.jpg"));

    await expect(pending).rejects.toBeInstanceOf(PreparedReportInvalidatedError);
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith("file:///late-crop.jpg");
    expect(cache.take()).toBeNull();
  });
});
