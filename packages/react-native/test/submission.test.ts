import { describe, expect, it, vi } from "vitest";

import { dispatchKueReport } from "../src/submission";
import type { KueCloudConfig, KueLocalReport } from "../src/types";

const report: KueLocalReport = {
  clientReportId: "kue_client_12345",
  memo: "profile padding",
  crop: { x: 0, y: 0, width: 1, height: 1 },
  screenshot: {
    uri: "file:///capture.jpg",
    width: 100,
    height: 200,
    mimeType: "image/jpeg",
  },
  sourceSize: { width: 100, height: 200 },
  context: { platform: "ios" },
  capturedAt: "2026-08-20T00:00:00.000Z",
};

const cloud: KueCloudConfig = {
  apiBaseUrl: "https://reports.example.test",
  projectKey: "pk_12345678",
};

describe("dispatchKueReport", () => {
  it("keeps the Phase 1 onSubmit callback as the highest priority", async () => {
    const onSubmit = vi.fn();
    const submitCloud = vi.fn();
    const submitLocal = vi.fn();

    await dispatchKueReport(report, {
      cloud,
      onSubmit,
      submitCloud,
      submitLocal,
    });

    expect(onSubmit).toHaveBeenCalledWith(report);
    expect(submitCloud).not.toHaveBeenCalled();
    expect(submitLocal).not.toHaveBeenCalled();
  });

  it("uses Cloud and emits its receipt when no callback overrides it", async () => {
    const onReceipt = vi.fn();
    const receipt = {
      clientReportId: report.clientReportId,
      id: "report_123",
      status: "received" as const,
    };
    const submitCloud = vi.fn(async () => receipt);
    const submitLocal = vi.fn();

    await dispatchKueReport(report, {
      cloud,
      onReceipt,
      submitCloud,
      submitLocal,
    });

    expect(submitCloud).toHaveBeenCalledWith(report, cloud);
    expect(onReceipt).toHaveBeenCalledWith(receipt);
    expect(submitLocal).not.toHaveBeenCalled();
  });

  it("does not turn an accepted report back into a submit failure when onReceipt throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const receipt = {
      clientReportId: report.clientReportId,
      id: "report_123",
      status: "received" as const,
    };

    await expect(
      dispatchKueReport(report, {
        cloud,
        onReceipt: () => {
          throw new Error("consumer callback failed");
        },
        submitCloud: vi.fn(async () => receipt),
        submitLocal: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("preserves the structured console fallback when Cloud is absent", async () => {
    const submitCloud = vi.fn();
    const submitLocal = vi.fn();

    await dispatchKueReport(report, { submitCloud, submitLocal });

    expect(submitLocal).toHaveBeenCalledWith(report);
    expect(submitCloud).not.toHaveBeenCalled();
  });
});
