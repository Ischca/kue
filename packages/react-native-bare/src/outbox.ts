import { getRuntime } from "./native";
import { clientId, normalizeCloud, pending } from "./models";
import type { KueCloudConfig, KuePendingReport, KueRetryOptions } from "./types";
export async function pendingKueReports(cloud: KueCloudConfig, includeOtherDestinations = false): Promise<readonly KuePendingReport[]> {
  const runtime = getRuntime();
  return pending(await runtime.standalone("pendingReports", { cloud: normalizeCloud(cloud, runtime.development), includeOtherDestinations }));
}
export async function retryPendingKueReports(cloud: KueCloudConfig, options: KueRetryOptions = {}): Promise<void> {
  const runtime = getRuntime();
  await runtime.standalone("retryPendingReports", { cloud: normalizeCloud(cloud, runtime.development), force: options.force === true }, options);
}
export async function discardPendingKueReport(cloud: KueCloudConfig, id: string): Promise<void> {
  const runtime = getRuntime();
  await runtime.standalone("discardPendingReport", { cloud: normalizeCloud(cloud, runtime.development), clientReportId: clientId(id) });
}
