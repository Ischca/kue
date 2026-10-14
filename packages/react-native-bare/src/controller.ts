import { KueCloudError } from "./bridge";
import type { KuePendingReport, KueProjectFeatures, KueReceipt, KueReportStatus, KueRuntimeState, ReportIssueOptions } from "./types";
export class KueUnavailableError extends KueCloudError {
  constructor() { super("inactive_session"); this.name = "KueUnavailableError"; }
}
export interface HostCommands {
  reportIssue(options?: ReportIssueOptions): Promise<void>;
  command(action: string, args?: Record<string, unknown>): Promise<unknown>;
}
const hosts: { owner: symbol; host: HostCommands; order: number }[] = [];
let mountOrder = 0;
export function reserveHostOrder(): number {
  if (mountOrder >= 2147483647) throw new KueCloudError("invalid_config");
  return ++mountOrder;
}
export function registerHost(host: HostCommands, order = reserveHostOrder()): () => void {
  const entry = { owner: Symbol("kue-host"), host, order };
  hosts.push(entry); hosts.sort((a, b) => a.order - b.order);
  return () => { const i = hosts.indexOf(entry); if (i >= 0) hosts.splice(i, 1); };
}
function current(): HostCommands { const host = hosts.at(-1)?.host; if (!host) throw new KueUnavailableError(); return host; }
/** Resolves after native capture and editor presentation; submission is a later observer event. */
export async function reportIssue(options: ReportIssueOptions = {}): Promise<void> { await current().reportIssue(options); }
export async function openKueSavedFindings(): Promise<void> { await current().command("openSavedFindings"); }
export async function openKueOutbox(): Promise<void> { await current().command("openOutbox"); }
export async function beginKueRecording(): Promise<void> { await current().command("beginRecording"); }
export async function stopKueRecording(): Promise<void> { await current().command("stopRecording"); }
export async function getKueRuntimeState(): Promise<KueRuntimeState> { return await current().command("state") as KueRuntimeState; }
export async function refreshKueProjectFeatures(): Promise<KueProjectFeatures> { return await current().command("features") as KueProjectFeatures; }
export async function readKueReportStatus(receipt: Pick<KueReceipt, "id" | "receiptToken">): Promise<KueReportStatus> { return await current().command("status", { receipt }) as KueReportStatus; }
export async function listKuePendingReports(includeOtherDestinations = false): Promise<readonly KuePendingReport[]> { return await current().command("pendingReports", { includeOtherDestinations }) as readonly KuePendingReport[]; }
export async function retryKuePendingReports(force = false): Promise<void> { await current().command("retryPendingReports", { force }); }
export async function discardKuePendingReport(clientReportId: string, includeOtherDestinations = false): Promise<void> { await current().command("discardPendingReport", { clientReportId, includeOtherDestinations }); }
