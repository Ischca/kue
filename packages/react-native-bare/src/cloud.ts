import { getRuntime } from "./native";
import { normalizeCloud, features, group, readReceipt, receipt, report, status } from "./models";
import type { KueCloudConfig, KueLocalReport, KueProjectFeatures, KueReceipt, KueReportGroup, KueReportStatus } from "./types";
export { KueCloudError } from "./bridge";
/** Native snapshots app-private media before HTTP preparation. No Expo or JS upload transport. */
export async function submitKueReport(value: KueLocalReport, cloud: KueCloudConfig): Promise<KueReceipt> {
  const runtime = getRuntime(), immutable = report(value);
  return receipt(await runtime.standalone("submitReport", { cloud: normalizeCloud(cloud, runtime.development), report: immutable }));
}
export async function submitKueReportGroup(value: KueReportGroup, cloud: KueCloudConfig): Promise<KueReceipt> {
  const runtime = getRuntime(), immutable = group(value);
  return receipt(await runtime.standalone("submitReportGroup", { cloud: normalizeCloud(cloud, runtime.development), group: immutable }));
}
export async function getKueProjectFeatures(cloud: KueCloudConfig): Promise<KueProjectFeatures> {
  const runtime = getRuntime();
  return features(await runtime.standalone("getProjectFeatures", { cloud: normalizeCloud(cloud, runtime.development) }));
}
export async function getKueReportStatus(value: Pick<KueReceipt, "id" | "receiptToken">, cloud: Omit<KueCloudConfig, "projectKey"> | KueCloudConfig): Promise<KueReportStatus> {
  const runtime = getRuntime(), immutable = readReceipt(value);
  return status(await runtime.standalone("getReportStatus", { cloud: normalizeCloud(cloud, runtime.development, true), receipt: immutable }), immutable.id);
}
