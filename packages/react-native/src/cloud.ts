import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";

import type {
  KueCloudConfig,
  KueCloudErrorCode,
  KueLocalReport,
  KueReceipt,
  KueReceiptStatus,
  KueReportStatus,
  KueReportGroup,
  KueProjectFeatures,
  KueFinding,
} from "./types";

declare const __DEV__: boolean;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const REPORT_PATH = "/v1/reports";
const PROJECT_KEY_PATTERN = /^pk_[A-Za-z0-9_-]{8,128}$/;
const CLIENT_REPORT_ID_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

interface KueCloudErrorOptions {
  cause?: unknown;
  code: KueCloudErrorCode;
  retryAfterMs?: number;
  retryable?: boolean;
  serverCode?: string;
  status?: number;
}

export class KueCloudError extends Error {
  readonly code: KueCloudErrorCode;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly serverCode?: string;
  readonly status?: number;

  constructor(message: string, options: KueCloudErrorOptions) {
    super(message);
    this.name = "KueCloudError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.serverCode = options.serverCode;
    this.status = options.status;

    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

interface NormalizedCloudConfig {
  endpoint: string;
  projectKey: string;
  timeoutMs: number;
}

function runtimeIsDevelopment(): boolean {
  return typeof __DEV__ === "boolean" && __DEV__;
}

/** @internal Exported from source only so validation can be tested without a native runtime. */
export function normalizeKueCloudConfig(
  config: KueCloudConfig,
  development = runtimeIsDevelopment(),
): NormalizedCloudConfig {
  const projectKey = config.projectKey.trim();
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new KueCloudError("KUE projectKey must match pk_ followed by 8 to 128 characters.", {
      code: "invalid_config",
    });
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(config.apiBaseUrl.trim());
  } catch (cause) {
    throw new KueCloudError("KUE apiBaseUrl must be a valid absolute URL.", {
      cause,
      code: "invalid_config",
    });
  }

  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new KueCloudError(
      "KUE apiBaseUrl must be an origin without credentials, a path, query, or hash.",
      {
        code: "invalid_config",
      },
    );
  }

  if (baseUrl.protocol !== "https:" && !(development && baseUrl.protocol === "http:")) {
    throw new KueCloudError(
      development
        ? "KUE apiBaseUrl must use http or https."
        : "KUE apiBaseUrl must use https outside development.",
      { code: "invalid_config" },
    );
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new KueCloudError("KUE timeoutMs must be an integer from 1 to 120000.", {
      code: "invalid_config",
    });
  }

  const normalizedBaseUrl = baseUrl.toString().replace(/\/+$/, "");
  return {
    endpoint: `${normalizedBaseUrl}${REPORT_PATH}`,
    projectKey,
    timeoutMs,
  };
}

function createMetadata(report: KueFinding): string {
  if ("video" in report) return JSON.stringify({ schemaVersion: 2, context: report.context, capture: {
    kind: "video", capturedAt: report.capturedAt, mimeType: "video/mp4", durationMs: report.video.durationMs,
    outputSize: { width: report.video.width, height: report.video.height },
  } });
  return JSON.stringify({
    schemaVersion: 1,
    context: report.context,
    capture: {
      capturedAt: report.capturedAt,
      crop: report.crop,
      sourceSize: report.sourceSize,
      outputSize: {
        width: report.screenshot.width,
        height: report.screenshot.height,
      },
      mimeType: report.screenshot.mimeType,
    },
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}

async function readServerCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return undefined;
    const error = (body as { error?: unknown }).error;
    if (!error || typeof error !== "object") return undefined;
    const code = (error as { code?: unknown }).code;
    if (typeof code !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(code)) return undefined;
    return code;
  } catch {
    return undefined;
  }
}

async function rejectedUploadError(response: Response): Promise<KueCloudError> {
  const status = response.status;
  const serverCode = await readServerCode(response);
  const quotaExceeded = status === 429 && serverCode === "quota_exceeded";
  const retryable = (status === 429 && !quotaExceeded) || status >= 500;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));

  let message = `KUE Cloud rejected the report (HTTP ${status}).`;
  if (status === 401 || status === 403) message = "KUE projectKey was rejected.";
  if (status === 413) message = "The KUE capture is too large to upload.";
  if (status === 429) message = "KUE Cloud is receiving too many reports. Please try again.";
  if (quotaExceeded) message = "The KUE monthly report quota has been reached.";
  if (serverCode === "project_plan_paused") message = "This project is paused on KUE Free. Select it in the dashboard or upgrade to Indie.";
  if (serverCode === "storage_quota_exceeded") message = "KUE image storage is full. Free space in the dashboard or upgrade from Free to Indie.";
  if (serverCode === "recording_requires_indie") message = "Screen recording requires an active Indie subscription. Check the workspace plan in the dashboard.";
  if (serverCode === "recording_unavailable") message = "Screen recording is not enabled on this KUE Cloud.";

  return new KueCloudError(message, {
    code: "upload_rejected",
    retryAfterMs,
    retryable,
    serverCode,
    status,
  });
}

function isReceiptBody(value: unknown): value is { id: string; status: KueReceiptStatus; receiptToken?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; status?: unknown; receiptToken?: unknown };
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    (candidate.status === "received" || candidate.status === "queued") &&
    (candidate.receiptToken === undefined || (typeof candidate.receiptToken === "string" && /^[A-Za-z0-9_-]{43}$/u.test(candidate.receiptToken)))
  );
}

function requestTimeoutError(cause?: unknown): KueCloudError {
  return new KueCloudError(
    "KUE Cloud did not respond in time. The report was kept so you can retry.",
    {
      cause,
      code: "request_timeout",
      retryable: true,
    },
  );
}

export async function submitKueReport(
  report: KueLocalReport,
  config: KueCloudConfig,
): Promise<KueReceipt> {
  const clientReportId = report.clientReportId.trim();
  if (!CLIENT_REPORT_ID_PATTERN.test(clientReportId)) {
    throw new KueCloudError("KUE clientReportId must contain 16 to 128 URL-safe characters.", {
      code: "invalid_report",
    });
  }

  const normalized = normalizeKueCloudConfig(config);
  const formData = new FormData();
  formData.append("screenshot", new File(report.screenshot.uri));
  formData.append("memo", report.memo);
  formData.append("metadata", createMetadata(report));

  return uploadForm(clientReportId, formData, normalized, normalized.endpoint);
}

export async function submitKueReportGroup(group: KueReportGroup, config: KueCloudConfig): Promise<KueReceipt> {
  if (!CLIENT_REPORT_ID_PATTERN.test(group.clientReportId) || !group.title.trim() ||
    /[\r\n\u0000]/u.test(group.title) || Array.from(group.title.trim()).length > 200 ||
    group.findings.length < 1 || group.findings.length > 10) {
    throw new KueCloudError("A group requires an ID, a title and 1–10 findings.", { code: "invalid_report" });
  }
  const normalized = normalizeKueCloudConfig(config);
  const form = new FormData();
  const manifest = JSON.stringify({ schemaVersion: 1, title: group.title.trim(),
    findings: group.findings.map(report => ({ memo: report.memo, metadata: JSON.parse(createMetadata(report)) })) });
  if (new TextEncoder().encode(manifest).byteLength > 48 * 1024) throw new KueCloudError("Group notes and metadata exceed 48 KiB.", { code: "invalid_report" });
  form.append("manifest", manifest);
  let total = 0;
  group.findings.forEach((report, index) => {
    const file = new File("video" in report ? report.video.uri : report.screenshot.uri);
    total += file.size;
    if (file.size <= 0 || file.size > ("video" in report ? 20 : 10) * 1024 * 1024 || total > 20 * 1024 * 1024) {
      throw new KueCloudError("Images: 10 MiB each; recordings and total: 20 MiB.", { code: "invalid_report" });
    }
    form.append(`capture_${index}`, file);
  });
  return uploadForm(group.clientReportId, form, normalized, normalized.endpoint.replace(/\/reports$/u, "/report-groups"));
}

async function uploadForm(clientReportId: string, formData: FormData, normalized: NormalizedCloudConfig, endpoint: string): Promise<KueReceipt> {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);

  try {
    let response: Response;
    try {
      response = await expoFetch(endpoint, {
        method: "POST",
        // A 307/308 must never resend screenshots or tokens to another origin.
        redirect: "error",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${normalized.projectKey}`,
          "Idempotency-Key": clientReportId,
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) throw requestTimeoutError(cause);

      throw new KueCloudError(
        "KUE Cloud could not be reached. Check the connection and try again.",
        {
          cause,
          code: "network_error",
          retryable: true,
        },
      );
    }

    if (controller.signal.aborted) throw requestTimeoutError();

    if (response.status !== 202) {
      const rejection = await rejectedUploadError(response);
      if (controller.signal.aborted) throw requestTimeoutError();
      throw rejection;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      if (controller.signal.aborted) throw requestTimeoutError(cause);
      throw new KueCloudError("KUE Cloud returned an unreadable receipt.", {
        cause,
        code: "unexpected_response",
        retryable: true,
        status: response.status,
      });
    }

    if (controller.signal.aborted) throw requestTimeoutError();

    if (!isReceiptBody(body)) {
      throw new KueCloudError("KUE Cloud returned an invalid receipt.", {
        code: "unexpected_response",
        retryable: true,
        status: response.status,
      });
    }

    return {
      clientReportId,
      id: body.id.trim(),
      status: body.status,
      ...(body.receiptToken ? { receiptToken: body.receiptToken } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Entitlements are advisory for UI; admission is always checked by Cloud again. */
export async function getKueProjectFeatures(config: KueCloudConfig): Promise<KueProjectFeatures> {
  const normalized = normalizeKueCloudConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
  try {
    const response = await expoFetch(normalized.endpoint.replace(/\/reports$/u, "/project/features"), {
      redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${normalized.projectKey}` },
    });
    if (!response.ok) throw await rejectedUploadError(response);
    const body = await response.json() as KueProjectFeatures & { schemaVersion?: number };
    if (body?.schemaVersion !== 1 || typeof body.groups !== "boolean" || typeof body.recording?.entitled !== "boolean" ||
      typeof body.recording.available !== "boolean") throw new KueCloudError("Could not verify KUE features.", { code: "unexpected_response", retryable: true });
    if (controller.signal.aborted) throw requestTimeoutError();
    return { groups: body.groups, recording: { ...body.recording } };
  } catch (cause) {
    if (controller.signal.aborted) throw requestTimeoutError(cause);
    if (cause instanceof KueCloudError) throw cause;
    throw new KueCloudError("Could not verify KUE features. Check the connection and try again.", { code: "network_error", retryable: true });
  } finally { clearTimeout(timeout); }
}

/** Read one receipt. No automatic polling, background task, or use of the public ingest key. */
export async function getKueReportStatus(
  receipt: Pick<KueReceipt, "id" | "receiptToken">,
  config: Pick<KueCloudConfig, "apiBaseUrl" | "timeoutMs">,
): Promise<KueReportStatus> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(receipt.receiptToken ?? "") || !/^report_[A-Za-z0-9_-]+$/u.test(receipt.id)) {
    throw new KueCloudError("This report does not contain a valid read receipt.", { code: "invalid_report" });
  }
  const normalized = normalizeKueCloudConfig({ ...config, projectKey: "pk_status_only" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalized.timeoutMs);
  try {
    const response = await expoFetch(`${normalized.endpoint}/${encodeURIComponent(receipt.id)}`, {
      redirect: "error", credentials: "omit",
      headers: { Accept: "application/json", Authorization: `Bearer ${receipt.receiptToken}` }, signal: controller.signal,
    });
    if (!response.ok) throw new KueCloudError("Could not read the report status.", {
      code: "unexpected_response", status: response.status, retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
    });
    const body = await response.json() as KueReportStatus;
    const issue = body?.githubIssue;
    if (!body || body.id !== receipt.id || !["received", "queued", "creating_issue", "completed", "failed"].includes(body.status) ||
      (issue !== null && (!issue || !Number.isSafeInteger(issue.number) || issue.number <= 0 || typeof issue.url !== "string" ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/issues\/\d+$/u.test(issue.url))) ||
      (body.error !== undefined && (!body.error || typeof body.error.code !== "string"))) {
      throw new KueCloudError("KUE Cloud returned an invalid report status.", { code: "unexpected_response", retryable: true });
    }
    if (controller.signal.aborted) throw requestTimeoutError();
    return { id: body.id, status: body.status, githubIssue: issue, ...(body.error ? { error: { code: body.error.code } } : {}) };
  } catch (cause) {
    if (controller.signal.aborted) throw requestTimeoutError(cause);
    if (cause instanceof KueCloudError) throw cause;
    throw new KueCloudError("Could not read the report status.", { code: "network_error", retryable: true, cause });
  } finally { clearTimeout(timeout); }
}
