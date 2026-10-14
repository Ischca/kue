import { fail, object, utf8Size } from "./bridge";
import type { KueCapturedImage, KueCloudConfig, KueFinding, KueLocalReport, KuePendingReport, KueProjectFeatures, KueReceipt, KueReportContext, KueReportGroup, KueReportStatus, KueRuntimeState, KueVideoReport, NormalizedCrop } from "./types";

export const FULL_CROP: Readonly<NormalizedCrop> = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
function string(value: unknown, limit: number, required = false): string {
  if (typeof value !== "string" || value.includes("\0") || utf8Size(value) > limit || (required && !value.trim())) return fail("invalid_report");
  return value;
}
function number(value: unknown, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) return fail("invalid_report");
  return value;
}
export function clientId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._~-]{16,128}$/.test(value)) return fail("invalid_report");
  return value;
}
export function fileUri(value: unknown): string {
  if (typeof value !== "string" || utf8Size(value) > 4096 || !/^file:\/\/\//.test(value) || /[\0\r\n?#]/.test(value)) return fail("invalid_report");
  return value;
}
export function timestamp(value: unknown): string {
  const text = string(value, 64, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) return fail("invalid_report");
  return text;
}
export function memo(value: unknown, required = true): string { return string(value, 4096, required); }
export function context(value: unknown = {}, complete = false): Partial<KueReportContext> {
  const input = object(value), result: Partial<KueReportContext> = {};
  if (input.platform !== undefined) {
    if (!complete) return fail("invalid_report");
    if (input.platform !== "ios" && input.platform !== "android") return fail("invalid_report");
    result.platform = input.platform;
  } else if (complete) return fail("invalid_report");
  for (const [key, limit] of [["osVersion", 128], ["deviceModel", 256], ["appVersion", 128], ["buildNumber", 128], ["route", 2048]] as const) {
    if (input[key] !== undefined) result[key] = string(input[key], limit);
  }
  for (const key of ["screenWidth", "screenHeight"] as const) if (input[key] !== undefined) result[key] = number(input[key], 100000);
  // Expo metadata is intentionally unsupported by this integration.
  if (input.expo !== undefined) return fail("invalid_report");
  return Object.freeze(result);
}
function size(value: unknown): { width: number; height: number } {
  const input = object(value);
  const result = { width: number(input.width, 16000000, true), height: number(input.height, 16000000, true) };
  if (result.width * result.height > 16000000) return fail("invalid_report");
  return Object.freeze(result);
}
function crop(value: unknown): NormalizedCrop {
  const input = object(value);
  const result = { x: input.x, y: input.y, width: input.width, height: input.height };
  if (Object.values(result).some(v => typeof v !== "number" || !Number.isFinite(v)) || Number(result.x) < 0 || Number(result.y) < 0 || Number(result.width) <= 0 || Number(result.height) <= 0 || Number(result.x) + Number(result.width) > 1.000001 || Number(result.y) + Number(result.height) > 1.000001) return fail("invalid_report");
  return Object.freeze(result as NormalizedCrop);
}
function image(value: unknown) {
  const input = object(value);
  if (input.mimeType !== "image/png" && input.mimeType !== "image/jpeg") return fail("invalid_report");
  return Object.freeze({ uri: fileUri(input.uri), ...size(input), mimeType: input.mimeType });
}
export function capturedImage(value: unknown): Omit<KueCapturedImage, "cleanup"> {
  const input = object(value);
  return Object.freeze({ ...image(input), capturedAt: timestamp(input.capturedAt), ...(input.context === undefined ? {} : { context: context(input.context) }) });
}
export function finding(value: unknown): KueFinding {
  const input = object(value);
  const common = { clientReportId: clientId(input.clientReportId), memo: memo(input.memo), context: context(input.context, true) as KueReportContext, capturedAt: timestamp(input.capturedAt) };
  if (input.video !== undefined) {
    if (input.screenshot !== undefined || input.crop !== undefined || input.sourceSize !== undefined) return fail("invalid_report");
    const video = object(input.video);
    if (video.mimeType !== "video/mp4") return fail("invalid_report");
    return Object.freeze({ ...common, video: Object.freeze({ uri: fileUri(video.uri), ...size(video), mimeType: "video/mp4", durationMs: number(video.durationMs, 60000), byteSize: number(video.byteSize, 20 * 1024 * 1024, true), capturedAt: timestamp(video.capturedAt) }) }) as KueVideoReport;
  }
  return Object.freeze({ ...common, screenshot: image(input.screenshot), crop: crop(input.crop), sourceSize: size(input.sourceSize) }) as KueLocalReport;
}
export function report(value: unknown): KueLocalReport {
  const result = finding(value);
  if ("video" in result) return fail("invalid_report");
  return result;
}
export function group(value: unknown): KueReportGroup {
  const input = object(value);
  const title = string(input.title, 48 * 1024, true).trim();
  if (/[\r\n]/.test(title) || Array.from(title).length > 200 || !Array.isArray(input.findings) || input.findings.length < 1 || input.findings.length > 10) return fail("invalid_report");
  const findings = input.findings.map(finding);
  return Object.freeze({ clientReportId: clientId(input.clientReportId), title, findings: Object.freeze(findings) });
}
export function receipt(value: unknown): KueReceipt {
  const input = object(value);
  if (input.status !== "received" && input.status !== "queued") return fail("unexpected_response");
  const result: KueReceipt = { clientReportId: clientId(input.clientReportId), id: string(input.id, 128, true), status: input.status };
  if (Object.hasOwn(input, "receiptToken")) {
    if (typeof input.receiptToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.receiptToken)) return fail("unexpected_response");
    result.receiptToken = input.receiptToken;
  }
  return Object.freeze(result);
}
export function readReceipt(value: unknown): Pick<KueReceipt, "id" | "receiptToken"> {
  const input = object(value);
  if (typeof input.id !== "string" || !/^report_[A-Za-z0-9_-]{1,121}$/.test(input.id) || typeof input.receiptToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.receiptToken)) return fail("invalid_report");
  return Object.freeze({ id: input.id, receiptToken: input.receiptToken });
}
export function features(value: unknown): KueProjectFeatures {
  const input = object(value), recording = object(input.recording);
  if (input.schemaVersion !== 1 || typeof input.groups !== "boolean" || typeof recording.entitled !== "boolean" || typeof recording.available !== "boolean") return fail("unexpected_response");
  return Object.freeze({ groups: input.groups, recording: Object.freeze({ entitled: recording.entitled, available: recording.available }) });
}
export function status(value: unknown, expectedId: string): KueReportStatus {
  const input = object(value);
  if (input.id !== expectedId || !["received", "queued", "creating_issue", "completed", "failed"].includes(String(input.status))) return fail("unexpected_response");
  const result: KueReportStatus = { id: expectedId, status: input.status as KueReportStatus["status"], githubIssue: null };
  if (input.githubIssue !== null) {
    const issue = object(input.githubIssue);
    const issueNumber = number(issue.number, Number.MAX_SAFE_INTEGER, true);
    if (typeof issue.url !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+$/.test(issue.url)) return fail("unexpected_response");
    result.githubIssue = Object.freeze({ number: issueNumber, url: issue.url });
  }
  if (Object.hasOwn(input, "error")) {
    const error = object(input.error);
    if (typeof error.code !== "string") return fail("unexpected_response");
    result.error = Object.freeze({ code: error.code });
  }
  return Object.freeze(result);
}
export function pending(value: unknown): readonly KuePendingReport[] {
  if (!Array.isArray(value)) return fail("unexpected_response");
  return Object.freeze(value.map(raw => {
    const input = object(raw);
    if (!["pending", "blocked"].includes(String(input.state)) || typeof input.currentDestination !== "boolean") return fail("unexpected_response");
    const date = (value: unknown): number => {
      if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return fail("unexpected_response");
      const result = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
      if (!Number.isFinite(result) || result < 0) return fail("unexpected_response"); return result;
    };
    if (input.attempts !== undefined && (typeof input.attempts !== "number" || !Number.isSafeInteger(input.attempts) || input.attempts < 0)) return fail("unexpected_response");
    return Object.freeze({ clientReportId: clientId(input.clientReportId), savedAt: date(input.savedAt), state: input.state as "pending" | "blocked", currentDestination: input.currentDestination,
      ...(input.attempts === undefined ? {} : { attempts: input.attempts as number }), ...(input.nextAttemptAt === undefined ? {} : { nextAttemptAt: date(input.nextAttemptAt) }) });
  }));
}
export function runtimeState(value: unknown): KueRuntimeState {
  const input = object(value), result: Record<string, unknown> = {};
  for (const key of ["attached", "enabled", "foreground", "reporterOpen", "capturing", "recordingActive", "busy", "groupLocked", "groupFull", "recorderIncluded"]) {
    if (typeof input[key] !== "boolean") return fail("unexpected_response"); result[key] = input[key];
  }
  for (const key of ["savedCount", "pendingCount"]) {
    if (!Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 1000) return fail("unexpected_response"); result[key] = input[key];
  }
  if (!["off", "cloud_required", "checking", "check_failed", "upgrade", "unavailable", "rebuild", "ready"].includes(String(input.recordingAvailability))) return fail("unexpected_response");
  result.recordingAvailability = input.recordingAvailability;
  return Object.freeze(result) as unknown as KueRuntimeState;
}
export function normalizeCloud(config: KueCloudConfig | Omit<KueCloudConfig, "projectKey">, development: boolean, statusOnly = false): Record<string, unknown> {
  if (!config || typeof config !== "object") return fail("invalid_config");
  if (config.allowDevelopmentLocalhostHttp !== undefined && typeof config.allowDevelopmentLocalhostHttp !== "boolean") return fail("invalid_config");
  // RN's built-in URL polyfill does not correctly parse IPv6 and is permissive for malformed origins.
  // Parse only the permitted origin grammar; native admission independently validates it again.
  const origin = typeof config.apiBaseUrl === "string" ? config.apiBaseUrl.trim() : "";
  const match = /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]+))?\/?$/i.exec(origin);
  if (!match) return fail("invalid_config");
  const protocol = match[1].toLowerCase(), host = match[2].toLowerCase();
  const port = match[3] === undefined ? undefined : Number(match[3]);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return fail("invalid_config");
  if (host.startsWith("[")) {
    const address = host.slice(1, -1), halves = address.split("::");
    if (halves.length > 2 || address.includes(".")) return fail("invalid_config");
    const groups = halves.flatMap(half => half ? half.split(":") : []);
    if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group)) || (halves.length === 2 ? groups.length >= 8 : groups.length !== 8)) return fail("invalid_config");
  } else {
    if (host.length > 253 || host.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return fail("invalid_config");
    if (/^\d+(?:\.\d+){3}$/.test(host) && host.split(".").some(part => Number(part) > 255 || (part.length > 1 && part.startsWith("0")))) return fail("invalid_config");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (protocol !== "https" && !(development && config.allowDevelopmentLocalhostHttp === true && protocol === "http" && loopback)) return fail("invalid_config");
  const timeoutMs = config.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return fail("invalid_config");
  const suffix = port === undefined || (protocol === "https" && port === 443) || (protocol === "http" && port === 80) ? "" : `:${port}`;
  const result: Record<string, unknown> = { apiBaseUrl: `${protocol}://${host}${suffix}`, timeoutMs, allowDevelopmentLocalhostHttp: config.allowDevelopmentLocalhostHttp === true };
  if (!statusOnly) {
    const key = "projectKey" in config && typeof config.projectKey === "string" ? config.projectKey.trim() : "";
    if (!/^pk_[A-Za-z0-9_-]{8,128}$/.test(key)) return fail("invalid_config"); result.projectKey = key;
  }
  return Object.freeze(result);
}
