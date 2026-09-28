import type {
  KueCloudConfig,
  KueLocalReport,
  KueReceipt,
  KueReceiptHandler,
  KueSubmitHandler,
} from "./types";

interface DispatchKueReportOptions {
  cloud?: KueCloudConfig;
  onReceipt?: KueReceiptHandler;
  onSubmit?: KueSubmitHandler;
  submitPersistent?: (report: KueLocalReport, config: KueCloudConfig) => Promise<KueReceipt | null>;
  onQueued?: (report: { clientReportId: string }) => void | Promise<void>;
  submitCloud: (report: KueLocalReport, config: KueCloudConfig) => Promise<KueReceipt>;
  submitLocal: KueSubmitHandler;
}

/** @internal Keeps Phase 1 callback precedence independent from the Cloud transport. */
export async function dispatchKueReport(
  report: KueLocalReport,
  options: DispatchKueReportOptions,
): Promise<void> {
  if (options.onSubmit) {
    await options.onSubmit(report);
    return;
  }

  if (options.cloud) {
    const receipt = await (options.submitPersistent ?? options.submitCloud)(report, options.cloud);
    try {
      const callbackResult = receipt ? options.onReceipt?.(receipt) : options.onQueued?.({ clientReportId: report.clientReportId });
      void Promise.resolve(callbackResult).catch((cause: unknown) => {
        console.error("[KUE] submit notification callback failed", cause);
      });
    } catch (cause) {
      console.error("[KUE] submit notification callback failed", cause);
    }
    return;
  }

  await options.submitLocal(report);
}
