import { call, encode, errorFromNative, fail, identifier, KueCloudError, parse, safeObserve, uniqueId, utf8Size, type BridgeEvent, type BridgeRequest } from "./bridge";
import { registerHost, reserveHostOrder, type HostCommands } from "./controller";
import { capturedImage, clientId, context, features, group, memo, normalizeCloud, pending, readReceipt, receipt, report, runtimeState, status } from "./models";
import type { BridgeRuntime, SessionEndpoint } from "./runtime";
import type { KueCapturedImage, KueProps, KueReportOutcome, KueRuntimeState, ReportIssueOptions } from "./types";

const functionIds = new WeakMap<Function, string>();
function functionId(value: Function | undefined, prefix: string): string | null {
  if (!value) return null;
  const old = functionIds.get(value); if (old) return old;
  const id = uniqueId(prefix); functionIds.set(value, id); return id;
}
const frozenKeys = ["mountOrder", "cloud", "hasOnSubmit", "hasOnSubmitGroup", "handlerId", "groupHandlerId", "hasCaptureAdapter", "captureAdapterId", "offlineQueue", "triggerIds", "callbackTimeoutMs"] as const;
function fingerprint(config: Record<string, unknown>): string { return JSON.stringify(frozenKeys.map(key => config[key])); }
function config(props: KueProps, development: boolean, mountOrder: number): Record<string, unknown> {
  if (!Number.isInteger(mountOrder) || mountOrder <= 0 || mountOrder > 2147483647) return fail("invalid_config");
  if (props.onSubmit !== undefined && typeof props.onSubmit !== "function") return fail("invalid_config");
  if (props.onSubmitGroup !== undefined && typeof props.onSubmitGroup !== "function") return fail("invalid_config");
  if (props.capture !== undefined && typeof props.capture !== "function") return fail("invalid_config");
  if (!props.onSubmit && !props.cloud) return fail("invalid_config");
  const label = (value: unknown) => {
    if (value === undefined) return null;
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || utf8Size(value) > 256) return fail("invalid_config"); return value;
  };
  const submitLabel = label(props.submitLabel), groupSubmitLabel = label(props.groupSubmitLabel);
  if ((props.onSubmit || props.onSubmitGroup) && !submitLabel) return fail("invalid_config");
  const callbackTimeoutMs = props.callbackTimeoutMs ?? 30000;
  if (!Number.isInteger(callbackTimeoutMs) || callbackTimeoutMs < 1 || callbackTimeoutMs > 120000) return fail("invalid_config");
  const bool = (value: unknown, fallback: boolean): boolean => { if (value === undefined) return fallback; if (typeof value !== "boolean") return fail("invalid_config"); return value; };
  if (props.locale !== undefined && props.locale !== "ja" && props.locale !== "en") return fail("invalid_config");
  if (props.buttonDesign !== undefined && props.buttonDesign !== "classic" && props.buttonDesign !== "mascot") return fail("invalid_config");
  if (props.recording !== undefined && props.recording !== "auto" && props.recording !== "off") return fail("invalid_config");
  const triggers = props.triggers ?? [];
  if (!Array.isArray(triggers) || triggers.length > 32 || triggers.some(v => typeof v !== "function") || new Set(triggers).size !== triggers.length) return fail("invalid_config");
  return {
    mountOrder, enabled: bool(props.enabled, development), locale: props.locale ?? null, buttonDesign: props.buttonDesign ?? "classic",
    context: context(props.context), floatingButton: bool(props.floatingButton, true), recording: props.recording ?? "auto",
    offlineQueue: bool(props.offlineQueue, false), shakeTrigger: bool(props.shakeTrigger, false), systemScreenshotTrigger: bool(props.systemScreenshotTrigger, false),
    cloud: props.cloud ? normalizeCloud(props.cloud, development) : null, submitLabel, groupSubmitLabel,
    hasOnSubmit: Boolean(props.onSubmit), hasOnSubmitGroup: Boolean(props.onSubmitGroup), handlerId: functionId(props.onSubmit, "handler"), groupHandlerId: functionId(props.onSubmitGroup, "group"),
    hasCaptureAdapter: Boolean(props.capture), captureAdapterId: functionId(props.capture, "capture"), triggerIds: triggers.map(source => functionId(source, "trigger")), callbackTimeoutMs,
  };
}
interface RequestState {
  request: BridgeRequest; active: boolean; retired: boolean; nativeRetired: boolean; cleanupDone: boolean;
  cleanup?: () => unknown; unlease?: () => void; timer?: ReturnType<typeof setTimeout>;
  subscriptionId?: string;
}
export class KueSession implements HostCommands, SessionEndpoint {
  readonly id = uniqueId("session");
  private readonly mountOrder = reserveHostOrder();
  private config: Record<string, unknown>;
  private readonly immutableFingerprint: string;
  private readonly frozenProps: KueProps;
  private observers: KueProps;
  private readonly requests = new Map<string, RequestState>();
  private readonly triggerCleanups = new Map<string, () => void>();
  private unregisterHost?: () => void;
  private attachPromise?: Promise<void>;
  private mutation: Promise<void> = Promise.resolve();
  private attached = false;
  private disposed = false;
  private foreground = true;
  private lastState?: KueRuntimeState;
  private lastRejected?: string;
  constructor(private readonly runtime: BridgeRuntime, props: KueProps) {
    this.config = config(props, runtime.development, this.mountOrder);
    this.immutableFingerprint = fingerprint(this.config);
    this.frozenProps = { ...props, triggers: props.triggers?.slice() } as KueProps;
    this.observers = props;
    runtime.sessions.set(this.id, this);
  }
  private observeError(error: unknown): void {
    const safe = error instanceof KueCloudError ? error : new KueCloudError("unexpected_response");
    safeObserve(() => this.observers.onError?.(safe));
  }
  private syncRegistration(): void {
    const active = !this.disposed && this.attached && this.foreground && this.config.enabled === true;
    if (active && !this.unregisterHost) this.unregisterHost = registerHost(this, this.mountOrder);
    if (!active) { this.unregisterHost?.(); this.unregisterHost = undefined; }
  }
  /** Called only after Fabric reports its actual native window/Activity. */
  ready(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.attachPromise) return this.attachPromise;
    this.attachPromise = (async () => {
      if (this.runtime.recorder) await call(() => this.runtime.recorder!.install(this.id));
      if (this.disposed) { if (this.runtime.recorder) await call(() => this.runtime.recorder!.remove(this.id)); return; }
      const attachedConfig = encode(this.config);
      await call(() => this.runtime.native.attach(this.id, attachedConfig));
      if (this.disposed) { await call(() => this.runtime.native.detach(this.id)); return; }
      this.attached = true; this.syncRegistration();
      // Updates arriving during asynchronous installation are applied to the frozen session after attach.
      if (attachedConfig !== encode(this.config)) await call(() => this.runtime.native.update(this.id, encode(this.config)));
    })().catch(async error => {
      if (!this.attached) {
        this.cancelCallbacks();
        try { await call(() => this.runtime.native.detach(this.id)); } catch {}
        if (this.runtime.recorder) { try { await call(() => this.runtime.recorder!.remove(this.id)); } catch {} }
      }
      if (!this.disposed) this.observeError(error);
    });
    return this.attachPromise;
  }
  setForeground(active: boolean): void {
    this.foreground = active; this.syncRegistration();
    if (!active) this.cancelCallbacks();
  }
  update(props: KueProps): void {
    if (this.disposed) return;
    this.observers = props;
    // Safety opt-outs take effect even if an unrelated immutable setting is invalid or changed.
    const safety = { ...this.config };
    if (props.enabled === false) safety.enabled = false;
    if (props.recording === "off") safety.recording = "off";
    // Apply before validation/error observers so reentrant application code cannot use the old enabled host.
    this.applyConfig(safety);
    let next = safety;
    try {
      const candidate = config(props, this.runtime.development, this.mountOrder);
      if (fingerprint(candidate) !== this.immutableFingerprint) throw new KueCloudError("configuration_changed");
      next = candidate; this.lastRejected = undefined;
    } catch (error) {
      const code = error instanceof KueCloudError ? error.code : "invalid_config";
      const rejected = `${code}:${functionId(typeof props.onSubmit === "function" ? props.onSubmit : undefined, "handler")}:${functionId(typeof props.capture === "function" ? props.capture : undefined, "capture")}`;
      if (rejected !== this.lastRejected) { this.lastRejected = rejected; this.observeError(error); }
    }
    this.applyConfig(next);
  }
  private applyConfig(next: Record<string, unknown>): void {
    if (JSON.stringify(next) === JSON.stringify(this.config)) return;
    this.config = next; this.syncRegistration();
    if (next.enabled === false) this.cancelCallbacks();
    if (!this.attached) return;
    const snapshot = encode(next);
    this.mutation = this.mutation.then(async () => { if (!this.disposed) await call(() => this.runtime.native.update(this.id, snapshot)); }).catch(error => { if (!this.disposed) this.observeError(error); });
  }
  async reportIssue(options: ReportIssueOptions = {}): Promise<void> {
    // Validate before allocating/reserving any native screenshot operation.
    const memoValue = options.memo === undefined ? undefined : memo(options.memo, false), overrides = context(options.context);
    if (!this.attached || this.disposed || !this.foreground || this.config.enabled !== true) return fail("inactive_session");
    await this.mutation;
    if (this.disposed || !this.foreground || this.config.enabled !== true) return fail("request_cancelled");
    await call(() => this.runtime.native.execute(this.id, "reportIssue", encode({ operationId: uniqueId("capture"), memo: memoValue, context: overrides })));
  }
  async command(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.attached || this.disposed || !this.foreground || this.config.enabled !== true) return fail("inactive_session");
    let input = args;
    if (action === "status") input = { receipt: readReceipt(args.receipt) };
    if (action === "discardPendingReport") input = { ...args, clientReportId: clientId(args.clientReportId) };
    await this.mutation;
    if (this.disposed || !this.foreground || this.config.enabled !== true) return fail("request_cancelled");
    const result = await call(() => this.runtime.native.execute(this.id, action, encode(input)));
    if (action === "state") return runtimeState(result);
    if (action === "features") return features(result);
    if (action === "status") return status(result, readReceipt(args.receipt).id);
    if (action === "pendingReports") return pending(result);
    return result;
  }
  private cleanup(state: RequestState): void {
    if (!state.cleanup || state.cleanupDone) return;
    state.cleanupDone = true; safeObserve(state.cleanup);
  }
  private retire(state: RequestState, nativeRetired = false): void {
    state.active = false; state.retired = true;
    state.nativeRetired = state.nativeRetired || nativeRetired;
    if (state.timer) clearTimeout(state.timer);
    state.unlease?.(); state.unlease = undefined;
    // A capture URI remains caller-owned while native may still be importing it.
    // Only the explicit import/retirement event (or completed detach) releases it.
    if (state.request.kind !== "capture" || state.nativeRetired) {
      this.cleanup(state); this.requests.delete(state.request.requestId);
    }
  }
  private cancelCallbacks(): void {
    this.triggerCleanups.forEach(cleanup => cleanup()); this.triggerCleanups.clear();
    for (const state of this.requests.values()) {
      if (state.active) this.runtime.ack(state.request, { ok: false, error: { code: "request_cancelled", retryable: true } });
      this.retire(state);
    }
  }
  request(request: BridgeRequest): void {
    if (this.disposed || !this.foreground || this.config.enabled !== true) { this.runtime.ack(request, { ok: false, error: { code: "request_cancelled", retryable: true } }); return; }
    let payload: Record<string, unknown>;
    try {
      identifier(request.requestId);
      // A duplicated event must not acknowledge/reject the original in-flight native callback.
      if (this.requests.has(request.requestId)) return;
      if (this.requests.size >= 32) throw new KueCloudError("busy");
      payload = parse(request.payload);
    } catch { this.runtime.ack(request, { ok: false, error: { code: "invalid_report", retryable: false } }); return; }
    const state: RequestState = { request, active: true, retired: false, nativeRetired: false, cleanupDone: false };
    this.requests.set(request.requestId, state);
    const deadline = Number(this.config.callbackTimeoutMs);
    state.timer = setTimeout(() => {
      if (!state.active) return;
      this.runtime.ack(request, { ok: false, error: { code: "request_timeout", retryable: true } });
      this.retire(state);
    }, deadline);
    void this.handleRequest(state, payload).then(value => {
      if (!state.active || this.disposed) return;
      state.active = false; if (state.timer) clearTimeout(state.timer);
      this.runtime.ack(request, { ok: true, value });
      if (request.kind !== "capture") { state.unlease?.(); this.requests.delete(request.requestId); }
    }).catch(() => {
      if (!state.active || this.disposed) return;
      this.runtime.ack(request, { ok: false, error: { code: request.kind === "capture" ? "capture_unavailable" : "local_save_failed", retryable: true } });
      this.retire(state);
    });
  }
  private async handleRequest(state: RequestState, payload: Record<string, unknown>): Promise<unknown> {
    const { kind, requestId } = state.request;
    if (kind === "capture") {
      if (!this.frozenProps.capture || payload.captureAdapterId !== this.config.captureAdapterId) return fail("capture_unavailable");
      identifier(payload.operationId);
      const result: KueCapturedImage = await this.frozenProps.capture();
      if (result?.cleanup !== undefined && typeof result.cleanup !== "function") return fail("capture_unavailable");
      if (result && typeof result.cleanup === "function") state.cleanup = result.cleanup;
      if (state.retired || this.disposed) { if (state.nativeRetired) this.cleanup(state); return null; }
      return capturedImage(result);
    }
    if (kind === "submit") {
      if (!this.frozenProps.onSubmit || payload.handlerId !== this.config.handlerId) return fail("local_save_failed");
      const value = report(payload.report);
      state.unlease = this.runtime.lease(this.id, requestId, [value.screenshot.uri]);
      await this.frozenProps.onSubmit(value); return null;
    }
    if (kind === "submitGroup") {
      if (!this.frozenProps.onSubmitGroup || payload.handlerId !== this.config.groupHandlerId) return fail("local_save_failed");
      const value = group(payload.group);
      state.unlease = this.runtime.lease(this.id, requestId, value.findings.map(f => "video" in f ? f.video.uri : f.screenshot.uri));
      await this.frozenProps.onSubmitGroup(value); return null;
    }
    if (kind === "subscribeTrigger") {
      const index = (this.config.triggerIds as readonly string[]).indexOf(identifier(payload.triggerId));
      const source = this.frozenProps.triggers?.[index]; if (!source) return fail("invalid_config");
      const subscriptionId = identifier(payload.subscriptionId); state.subscriptionId = subscriptionId;
      const cleanup = await source(() => {
        if (state.retired || this.disposed || !this.foreground || this.config.enabled !== true) return;
        void call(() => this.runtime.native.execute(this.id, "trigger", encode({ subscriptionId }))).catch(error => this.observeError(error));
      });
      if (typeof cleanup !== "function") return fail("invalid_config");
      state.cleanup = cleanup;
      if (state.retired || this.disposed || !this.foreground || this.config.enabled !== true) this.cleanup(state);
      else this.triggerCleanups.set(subscriptionId, () => { state.retired = true; this.cleanup(state); });
      return null;
    }
    return fail("unsupported_action");
  }
  event(event: BridgeEvent): void {
    if (this.disposed) return;
    try {
      const payload = parse(event.payload);
      if (event.kind === "captureImported" || event.kind === "cancelRequest") {
        const state = this.requests.get(identifier(payload.requestId)); if (state) this.retire(state, true); return;
      }
      if (event.kind === "unsubscribeTrigger") {
        const id = identifier(payload.subscriptionId); this.triggerCleanups.get(id)?.(); this.triggerCleanups.delete(id);
        for (const request of this.requests.values()) if (request.subscriptionId === id) this.retire(request);
        return;
      }
      if (event.kind === "state") {
        const next = runtimeState(payload.state);
        if (JSON.stringify(next) === JSON.stringify(this.lastState)) return;
        this.lastState = next; safeObserve(() => this.observers.onState?.(next)); return;
      }
      if (event.kind === "receipt") { const value = receipt(payload.receipt); safeObserve(() => this.observers.onReceipt?.(value)); return; }
      if (event.kind === "queued") { const id = clientId(payload.clientReportId); safeObserve(() => this.observers.onQueued?.({ clientReportId: id })); return; }
      if (event.kind === "error") { this.observeError(errorFromNative(payload.error)); return; }
      if (event.kind === "outcome") {
        const operationId = identifier(payload.operationId), outcome = payload.outcome;
        if (!["submitted", "cancelled", "queued", "findingAdded", "failed"].includes(String(outcome))) return fail("unexpected_response");
        const value: KueReportOutcome = Object.freeze({ operationId, outcome: outcome as KueReportOutcome["outcome"], ...(payload.error == null ? {} : { error: errorFromNative(payload.error) }) });
        safeObserve(() => this.observers.onOutcome?.(value));
      }
    } catch (error) { this.observeError(error); }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.unregisterHost?.(); this.unregisterHost = undefined;
    this.triggerCleanups.forEach(cleanup => cleanup()); this.triggerCleanups.clear();
    // Detach cancels native transport/import before retiring JS ownership. No stale ACK follows disposal.
    void (async () => {
      try { await call(() => this.runtime.native.detach(this.id)); }
      catch { /* Disposal must continue after runtime destruction. */ }
      finally {
        this.requests.forEach(request => this.retire(request, true)); this.runtime.sessions.delete(this.id);
        if (this.runtime.recorder) { try { await call(() => this.runtime.recorder!.remove(this.id)); } catch {} }
      }
    })();
  }
}
