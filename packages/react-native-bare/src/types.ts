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
}
/** Capture/host overrides cannot replace the actual native platform. */
export type KueContextOverrides = Partial<Omit<KueReportContext, "platform">>;

export interface KueCapturedImage {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  capturedAt: string;
  context?: KueContextOverrides;
  /** Called once after native import or cancellation. Native never deletes this source. */
  cleanup?: () => void | Promise<void>;
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
  context?: KueContextOverrides;
}

export interface KueCapturedVideo {
  uri: string;
  width: number;
  height: number;
  durationMs: number;
  byteSize: number;
  mimeType: "video/mp4";
  capturedAt: string;
}
export interface KueVideoReport {
  clientReportId: string;
  memo: string;
  video: KueCapturedVideo;
  context: KueReportContext;
  capturedAt: string;
}
export type KueFinding = KueLocalReport | KueVideoReport;

/** One ordered Issue submission. Every finding consumes one capture of quota. */
export interface KueReportGroup {
  clientReportId: string;
  title: string;
  findings: readonly KueFinding[];
}
export interface KueProjectFeatures {
  groups: boolean;
  recording: { entitled: boolean; available: boolean };
}
export type KueGroupSubmitHandler = (group: KueReportGroup) => void | Promise<void>;
/** Runtime opt-out. Native inclusion is determined separately by the optional recorder dependency. */
export type KueRecordingMode = "auto" | "off";
/** Display language of the KUE screens. */
export type KueLocale = "ja" | "en";

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
  /** Explicit Debug-only loopback HTTP opt-in. Defaults to false. */
  allowDevelopmentLocalhostHttp?: boolean;
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
  | "upload_rejected"
  | "request_cancelled"
  | "configuration_changed"
  | "native_module_unavailable"
  | "local_save_failed"
  | "capture_unavailable"
  | "busy"
  | "invalid_response"
  | (string & {});

/** Props shared by every destination. */
export interface KueBaseProps {
  /** Defaults to auto. off prevents recording but does not rewrite an installed binary. */
  recording?: KueRecordingMode;
  /** Opt-in, SDK-owned durable Cloud outbox: 10 reports / 50MB / 7 days. No background tasks. */
  offlineQueue?: boolean;
  /** Locally persisted, not yet accepted by Cloud. Does not call onReceipt. */
  onQueued?: (report: { clientReportId: string }) => void | Promise<void>;
  /** Keep the default floating button, or hide it when using other triggers. Defaults to true. */
  floatingButton?: boolean;
  /** Floating button artwork. Defaults to the classic viewfinder button. */
  buttonDesign?: "classic" | "mascot";
  /** Fixes the display language. By default, Japanese when it comes before English in the
   * device's preferred languages, English otherwise. */
  locale?: KueLocale;
  /** Optional sources, subscribed only while active, foregrounded and idle. */
  triggers?: readonly KueTriggerSource[];
  /** Defaults to __DEV__. */
  enabled?: boolean;
  shakeTrigger?: boolean;
  systemScreenshotTrigger?: boolean;
  /** Callback deadline, in milliseconds. Default 30000; range 1–120000. Immutable per host. */
  callbackTimeoutMs?: number;
  groupSubmitLabel?: string;
  onState?: (state: KueRuntimeState) => void;
  onOutcome?: (outcome: KueReportOutcome) => void;
  /** Called after KUE Cloud accepts the report with HTTP 202. */
  onReceipt?: KueReceiptHandler;
  /** Called for capture and submit failures. */
  onError?: (error: Error) => void;
  /** Metadata merged into each report. */
  context?: KueContextOverrides;
  /** Replaces native screen capture, primarily for tests and custom adapters. */
  capture?: KueCaptureAdapter;
}

/**
 * Where submissions go. KUE Cloud always creates an Issue, but only the app knows what its own
 * handler does, so a handler requires `submitLabel`. One of `cloud` or `onSubmit` is required.
 */
export type KueDestination =
  | {
      /** Uploads to KUE Cloud; the action reads 「Issueを作る」. */
      cloud: KueCloudConfig;
      onSubmit?: undefined;
      onSubmitGroup?: undefined;
      submitLabel?: undefined;
    }
  | {
      /** Custom handler. Takes priority over `cloud`, which then only serves recording checks. */
      onSubmit: KueSubmitHandler;
      /** Handles an explicitly confirmed group. Never falls back to one onSubmit per finding. */
      onSubmitGroup?: KueGroupSubmitHandler;
      cloud?: KueCloudConfig;
      /** Button text for the handler's action, such as 「Slackに送る」. Counts are appended. */
      submitLabel: string;
    }
  | {
      /** Single findings still create an Issue through Cloud. */
      cloud: KueCloudConfig;
      onSubmit?: undefined;
      /** Confirmed groups go to this handler instead of Cloud. */
      onSubmitGroup: KueGroupSubmitHandler;
      /** Button text for the group handler's action. Counts are appended. */
      submitLabel: string;
    };

export type KueProps = KueBaseProps & KueDestination;


export type KueRecordingAvailability = "off" | "cloud_required" | "checking" | "check_failed" | "upgrade" | "unavailable" | "rebuild" | "ready";
export interface KueRuntimeState {
  attached: boolean; enabled: boolean; foreground: boolean; reporterOpen: boolean;
  capturing: boolean; recordingActive: boolean; busy: boolean;
  savedCount: number; pendingCount: number; recordingAvailability: KueRecordingAvailability;
  groupLocked: boolean; groupFull: boolean; recorderIncluded: boolean;
}
export interface KueReportOutcome {
  operationId: string;
  outcome: "submitted" | "cancelled" | "queued" | "findingAdded" | "failed";
  error?: Error;
}
export interface KuePendingReport {
  clientReportId: string; savedAt: number; state: "pending" | "blocked";
  currentDestination: boolean; attempts?: number; nextAttemptAt?: number;
}
export interface KueRetryOptions {
  force?: boolean;
  /** Checked before retry and every 250 ms while it runs. False cancels native transport. */
  active?: () => boolean;
  receipt?: (receipt: KueReceipt) => void | Promise<void>;
  error?: (error: unknown) => void;
}
