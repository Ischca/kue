export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KueReportContext {
  platform: "ios" | "android";
  osVersion?: string;
  deviceModel?: string;
  appVersion?: string;
  buildNumber?: string;
  screenWidth?: number;
  screenHeight?: number;
  route?: string;
  expo?: {
    updateId?: string;
    runtimeVersion?: string;
  };
}

export interface KueCapturedImage {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  capturedAt: string;
}

export interface KueScreenshot {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
}

export interface KueLocalReport {
  /** Stable while retrying the same prepared report payload. */
  clientReportId: string;
  memo: string;
  crop: NormalizedCrop;
  screenshot: KueScreenshot;
  sourceSize: {
    width: number;
    height: number;
  };
  context: KueReportContext;
  capturedAt: string;
}

export interface ReportIssueOptions {
  memo?: string;
  context?: Partial<KueReportContext>;
}

export type KueCaptureAdapter = () => Promise<KueCapturedImage>;
/**
 * Receives a report while its temporary screenshot URI is valid. Copy or upload the image
 * before the returned promise resolves when it must outlive this callback.
 */
export type KueSubmitHandler = (report: KueLocalReport) => void | Promise<void>;

export interface KueCloudConfig {
  /** Base URL of the KUE Worker, without `/v1/reports`. */
  apiBaseUrl: string;
  /** Public, create-only project key (`pk_...`). */
  projectKey: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export type KueReceiptStatus = "received" | "queued";

export interface KueReceipt {
  clientReportId: string;
  id: string;
  status: KueReceiptStatus;
  /** Secret read capability for this report only. Do not log or put in an Issue. */
  receiptToken?: string;
}

export interface KueReportStatus {
  id: string;
  status: "received" | "queued" | "creating_issue" | "completed" | "failed";
  githubIssue: { number: number; url: string } | null;
  error?: { code: string };
}

export type KueReceiptHandler = (receipt: KueReceipt) => void | Promise<void>;
export type KueTriggerSource = (open: () => void) => (() => void) | Promise<() => void>;

export type KueCloudErrorCode =
  | "invalid_config"
  | "invalid_report"
  | "network_error"
  | "request_timeout"
  | "unexpected_response"
  | "upload_rejected";

export interface KueProps {
  /** Opt-in, SDK-owned durable Cloud outbox: 10 reports / 50MB / 7 days. No background tasks. */
  offlineQueue?: boolean;
  /** Locally persisted, not yet accepted by Cloud. Does not call onReceipt. */
  onQueued?: (report: { clientReportId: string }) => void | Promise<void>;
  /** Keep the default floating button, or hide it when using other triggers. Defaults to true. */
  floatingButton?: boolean;
  /** Optional sources, subscribed only while active, foregrounded and idle. */
  triggers?: readonly KueTriggerSource[];
  /** Defaults to __DEV__. */
  enabled?: boolean;
  /** Phase 1/custom handler. Takes priority over `cloud`. */
  onSubmit?: KueSubmitHandler;
  /** Uploads to KUE Cloud when `onSubmit` is not provided. */
  cloud?: KueCloudConfig;
  /** Called after KUE Cloud accepts the report with HTTP 202. */
  onReceipt?: KueReceiptHandler;
  /** Called for capture and submit failures. */
  onError?: (error: Error) => void;
  /** Metadata merged into each report. */
  context?: Partial<KueReportContext>;
  /** Replaces native screen capture, primarily for tests and custom adapters. */
  capture?: KueCaptureAdapter;
}
