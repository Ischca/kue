import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { captureCurrentScreen, releaseTemporaryImage, waitForFrames } from "./capture";
import { submitKueReport } from "./cloud";
import { createReportContext } from "./context";
import { registerKueHost } from "./controller";
import { DeferredImageRelease } from "./deferredRelease";
import { createLatestCallbackProxy, type LatestCallbackProxy } from "./latestCallback";
import { Reporter } from "./Reporter";
import { KueTrigger } from "./KueTrigger";
import { dispatchKueReport } from "./submission";
import { subscribeTriggers } from "./triggerSubscriptions";
import { retryPendingKueReports, submitWithOutbox } from "./outbox";
import { OutboxView } from "./OutboxView";
import type {
  KueCapturedImage,
  KueLocalReport,
  KueProps,
  KueReportContext,
  ReportIssueOptions,
} from "./types";

declare const __DEV__: boolean;

type Phase = "idle" | "capturing" | "editing";
type OpenReporter = (options?: ReportIssueOptions) => Promise<void>;

function defaultEnabled(): boolean {
  return typeof __DEV__ === "boolean" ? __DEV__ : false;
}

const defaultSubmit = () => {
  console.info("[KUE] Capture prepared. Configure onSubmit or cloud to save the report.");
};

const asError = (value: unknown) =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : "Unknown error");

export function Kue({
  enabled,
  onSubmit,
  cloud,
  onReceipt,
  onError,
  context = {},
  capture,
  floatingButton = true,
  buttonDesign = "classic",
  triggers,
  offlineQueue = false,
  onQueued,
}: KueProps) {
  const supportedPlatform = Platform.OS === "ios" || Platform.OS === "android";
  const active = (enabled ?? defaultEnabled()) && supportedPlatform;
  const captureAdapter = capture ?? captureCurrentScreen;
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [outboxVisible, setOutboxVisible] = useState(false);
  const durable = offlineQueue && !!cloud && !onSubmit;
  const [currentCapture, setCurrentCapture] = useState<KueCapturedImage | null>(null);
  const [currentContext, setCurrentContext] = useState<KueReportContext | null>(null);
  const [initialMemo, setInitialMemo] = useState("");
  const phaseRef = useRef<Phase>("idle");
  const captureRef = useRef<KueCapturedImage | null>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const captureRequestRef = useRef(0);
  const openingRef = useRef<Promise<void> | null>(null);
  const deferredReleaseRef = useRef(new DeferredImageRelease());
  activeRef.current = active;

  const releaseOrDefer = useCallback((uri: string) => {
    deferredReleaseRef.current.release(uri, releaseTemporaryImage);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    deferredReleaseRef.current.setSubmitting(submitting, releaseTemporaryImage);
  }, []);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const reportError = useCallback(
    (cause: unknown) => {
      const error = asError(cause);
      if (onError) {
        onError(error);
      } else {
        Alert.alert("KUE", error.message);
      }
    },
    [onError],
  );

  const closeReporter = useCallback(() => {
    captureRef.current = null;
    setCurrentCapture(null);
    setCurrentContext(null);
    setInitialMemo("");
    setPhase("idle");
  }, [setPhase]);

  const openReporter = useCallback(
    async (options: ReportIssueOptions = {}) => {
      if (phaseRef.current === "editing" || outboxVisible) return;
      if (openingRef.current) return openingRef.current;

      const requestId = ++captureRequestRef.current;
      const operation = (async () => {
        setPhase("capturing");
        let nextCapture: KueCapturedImage | null = null;

        try {
          await waitForFrames(2);
          nextCapture = await captureAdapter();

          if (
            !mountedRef.current ||
            !activeRef.current ||
            requestId !== captureRequestRef.current
          ) {
            releaseTemporaryImage(nextCapture.uri);
            return;
          }

          const nextContext = createReportContext(context, options.context);
          captureRef.current = nextCapture;
          setCurrentCapture(nextCapture);
          setCurrentContext(nextContext);
          setInitialMemo(options.memo ?? "");
          setPhase("editing");
        } catch (cause) {
          if (nextCapture && captureRef.current?.uri !== nextCapture.uri) {
            releaseTemporaryImage(nextCapture.uri);
          }

          if (
            mountedRef.current &&
            activeRef.current &&
            requestId === captureRequestRef.current
          ) {
            setPhase("idle");
            reportError(cause);
          }
          throw cause;
        }
      })();

      openingRef.current = operation;

      try {
        await operation;
      } finally {
        if (openingRef.current === operation) openingRef.current = null;
      }
    },
    [captureAdapter, context, reportError, setPhase, outboxVisible],
  );

  const registeredOpenReporterRef = useRef<LatestCallbackProxy<OpenReporter> | null>(null);
  if (!registeredOpenReporterRef.current) {
    registeredOpenReporterRef.current = createLatestCallbackProxy(openReporter);
  } else {
    registeredOpenReporterRef.current.update(openReporter);
  }
  const registeredOpenReporter = registeredOpenReporterRef.current.callback;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active || !foreground || phase !== "idle" || outboxVisible || !triggers?.length) return;
    return subscribeTriggers(triggers, () => {
      if (activeRef.current && phaseRef.current === "idle" && AppState.currentState === "active") {
        void registeredOpenReporter().catch(() => undefined);
      }
    }, reportError);
  }, [active, foreground, phase, outboxVisible, triggers, registeredOpenReporter, reportError]);

  const notifications = useRef({ onReceipt, reportError });
  notifications.current = { onReceipt, reportError };
  useEffect(() => {
    if (!active || !foreground || !durable || !cloud || outboxVisible || phase !== "idle") return;
    let stopped = false;
    let running = false;
    const flush = async () => {
      if (running) return;
      running = true;
      try {
        await retryPendingKueReports(cloud, { active: () => !stopped && AppState.currentState === "active",
          receipt: (receipt) => { if (!stopped) void Promise.resolve(notifications.current.onReceipt?.(receipt)).catch(() => undefined); },
          error: (error) => { if (!stopped) notifications.current.reportError(error); } });
      } catch (error) { if (!stopped) notifications.current.reportError(error); }
      finally { running = false; }
    };
    void flush();
    const timer = setInterval(() => { void flush(); }, 60_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [active, foreground, durable, cloud?.apiBaseUrl, cloud?.projectKey, outboxVisible, phase]);

  useEffect(() => { if (!active || !durable) setOutboxVisible(false); }, [active, durable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureRequestRef.current += 1;
      const captureToRelease = captureRef.current;
      if (captureToRelease) releaseOrDefer(captureToRelease.uri);
    };
  }, [releaseOrDefer]);

  useEffect(() => {
    if (!active) return undefined;
    return registerKueHost(registeredOpenReporter);
  }, [active, registeredOpenReporter]);

  useEffect(() => {
    if (active) return;

    captureRequestRef.current += 1;
    openingRef.current = null;

    if (captureRef.current) {
      releaseOrDefer(captureRef.current.uri);
    }

    if (captureRef.current || phaseRef.current !== "idle") {
      closeReporter();
    }
  }, [active, closeReporter, releaseOrDefer]);

  const handleCancel = useCallback(() => {
    const captureToRelease = captureRef.current;
    if (captureToRelease) releaseTemporaryImage(captureToRelease.uri);
    closeReporter();
  }, [closeReporter]);

  const handleSubmitted = useCallback(
    (report: KueLocalReport) => {
      const original = captureRef.current;
      if (original) {
        releaseOrDefer(original.uri);
      }
      if (!original || report.screenshot.uri !== original.uri) {
        releaseOrDefer(report.screenshot.uri);
      }
      closeReporter();
    },
    [closeReporter, releaseOrDefer],
  );

  const handleSubmit = useCallback(
    async (report: KueLocalReport) => {
      await dispatchKueReport(report, {
        cloud,
        onReceipt,
        onSubmit,
        submitCloud: submitKueReport,
        submitPersistent: durable ? submitWithOutbox : undefined,
        onQueued: onQueued ?? (() => Alert.alert("KUE", "端末に保存しました。接続後に再送します。")),
        submitLocal: defaultSubmit,
      });
    },
    [cloud, onReceipt, onSubmit, durable, onQueued],
  );

  if (!active) return null;

  return (
    <>
      <SafeAreaProvider pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <KueTrigger visible={floatingButton && phase === "idle" && !outboxVisible} design={buttonDesign}
          onPress={() => void openReporter().catch(() => undefined)}
          onLongPress={durable ? () => setOutboxVisible(true) : undefined} />
      </SafeAreaProvider>
      {durable && cloud ? <OutboxView cloud={cloud} visible={outboxVisible} onClose={() => setOutboxVisible(false)} /> : null}
      <Reporter
        capture={currentCapture}
        context={currentContext}
        initialMemo={initialMemo}
        onCancel={handleCancel}
        onError={reportError}
        onRelease={releaseOrDefer}
        onSubmit={handleSubmit}
        onSubmitted={handleSubmitted}
        onSubmittingChange={handleSubmittingChange}
      />
    </>
  );
}
