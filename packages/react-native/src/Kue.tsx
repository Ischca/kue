import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext, SafeAreaProvider } from "react-native-safe-area-context";

import { captureCurrentScreen, releaseTemporaryImage, waitForFrames } from "./capture";
import { getKueProjectFeatures, submitKueReport, submitKueReportGroup } from "./cloud";
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
import { CaptureActions, useCaptureActions } from "./CaptureActions";
import { GroupReview } from "./GroupReview";
import { createGroupDraft, removeOrphanedGroupDrafts } from "./groupDraftStorage";
import { RecordingFlow, type RecordingControl } from "./RecordingFlow";
import { createClientReportId } from "./clientReportId";
import { deviceKueLocale } from "./deviceLocale";
import { kueText, setKueLocale } from "./i18n";
import { actionLabels, closedDraftNotice, draftAccepts, joinedFindings, planFindingAction, type FindingAction } from "./issueFlow";
import type { GroupDraft } from "./groupDraft";
import type {
  KueCapturedImage,
  KueCapturedVideo,
  KueLocalReport,
  KueProps,
  KueReportContext,
  ReportIssueOptions,
} from "./types";

declare const __DEV__: boolean;

type Phase = "idle" | "capturing" | "editing";
type OpenReporter = (options?: ReportIssueOptions) => Promise<void>;
interface GroupSession {
  draft: GroupDraft;
  cloud?: KueProps["cloud"];
  onSubmitGroup?: KueProps["onSubmitGroup"];
}
const destination = (cloud?: KueProps["cloud"]) => JSON.stringify([cloud?.apiBaseUrl, cloud?.projectKey]);

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
  onSubmitGroup,
  cloud,
  submitLabel,
  recording = "auto",
  onReceipt,
  onError,
  context = {},
  capture,
  floatingButton = true,
  buttonDesign = "classic",
  triggers,
  offlineQueue = false,
  onQueued,
  locale,
}: KueProps) {
  // A second native provider overlay can intercept Android host-app touches.
  const TriggerSurface = useContext(SafeAreaInsetsContext) ? View : SafeAreaProvider;
  const supportedPlatform = Platform.OS === "ios" || Platform.OS === "android";
  const active = (enabled ?? defaultEnabled()) && supportedPlatform;
  const captureAdapter = capture ?? captureCurrentScreen;
  const displayLocale = useMemo(() => locale ?? deviceKueLocale(), [locale]);
  const text = kueText(displayLocale);
  const { singleLabel, groupLabel, groupToCloud, missingLabel } = actionLabels({ cloud, onSubmit, onSubmitGroup, submitLabel }, text);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [outboxVisible, setOutboxVisible] = useState(false);
  const [overlay, setOverlayState] = useState<"none" | "radial" | "actions" | "group" | "recording">("none");
  const [recordingControl, setRecordingControl] = useState<RecordingControl | null>(null);
  const overlayRef = useRef(overlay);
  // Counts every overlay change, so a slow recording check never starts after the user moved on.
  const overlayChangesRef = useRef(0);
  // The finding screen stays mounted behind the saved findings it opened, keeping its capture, memo
  // and crop. Leaving them returns to it, and the finding then joins the draft as it is by then.
  const [savedOpen, setSavedOpen] = useState(false);
  const savedOpenRef = useRef(false);
  const setOverlay = (value: typeof overlay) => {
    overlayRef.current = value; overlayChangesRef.current++; setOverlayState(value);
    if (value !== "group" && savedOpenRef.current) {
      savedOpenRef.current = false; setSavedOpen(false);
      captureGroupRef.current = groupRef.current;
    }
  };
  const groupRef = useRef<GroupSession | null>(null);
  const captureGroupRef = useRef<GroupSession | null>(null);
  const recordingSessionRef = useRef<{ group: GroupSession | null; cloud: KueProps["cloud"]; onSubmitGroup: KueProps["onSubmitGroup"]; context: KueReportContext } | null>(null);
  const startingRecordingRef = useRef(false);
  const currentRecordingConfig = useRef({ recording, cloud });
  currentRecordingConfig.current = { recording, cloud };
  // Create Issue with collected findings opens the confirmation once the finding screen has closed.
  const reviewAfterCloseRef = useRef(false);
  const [, refreshGroup] = useState(0);
  const changed = () => { if (mountedRef.current) refreshGroup(value => value + 1); };
  const group = groupRef.current;
  // A custom handler is captured once for this draft; ordinary React rerenders
  // may change its function identity and must not invalidate existing findings.
  const validGroupDestination = !group || !!group.onSubmitGroup || destination(group.cloud) === destination(cloud);
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
    savedOpenRef.current = false;
    setSavedOpen(false);
    setCurrentCapture(null);
    setCurrentContext(null);
    setInitialMemo("");
    setPhase("idle");
  }, [setPhase]);

  const openReporter = useCallback(
    async (options: ReportIssueOptions = {}) => {
      if (phaseRef.current === "editing" || outboxVisible) return;
      if (overlayRef.current !== "none") return;
      // Tapping always captures; a draft that cannot take the finding makes it a lone report, and
      // the finding screen opens that draft.
      if (openingRef.current) return openingRef.current;
      captureGroupRef.current = groupRef.current;

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
    if (!active || !foreground || phase !== "idle" || outboxVisible || overlay !== "none" || !triggers?.length) return;
    return subscribeTriggers(triggers, () => {
      if (activeRef.current && phaseRef.current === "idle" && AppState.currentState === "active") {
        void registeredOpenReporter().catch(() => undefined);
      }
    }, reportError);
  }, [active, foreground, phase, outboxVisible, overlay, triggers, registeredOpenReporter, reportError]);

  const notifications = useRef({ onReceipt, reportError });
  notifications.current = { onReceipt, reportError };
  useEffect(() => {
    if (!active || !foreground || !durable || !cloud || outboxVisible || overlay !== "none" || phase !== "idle") return;
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
  }, [active, foreground, durable, cloud?.apiBaseUrl, cloud?.projectKey, outboxVisible, overlay, phase]);

  useEffect(() => { if (!active || !durable) setOutboxVisible(false); }, [active, durable]);
  useEffect(() => {
    if ((!active || recording === "off") && overlayRef.current === "recording") {
      recordingSessionRef.current = null;
      setOverlay("none");
    }
  }, [active, recording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureRequestRef.current += 1;
      const captureToRelease = captureRef.current;
      if (captureToRelease) releaseOrDefer(captureToRelease.uri);
      groupRef.current?.draft.dispose();
    };
  }, [releaseOrDefer]);

  useEffect(() => {
    if (!active) return undefined;
    return registerKueHost(registeredOpenReporter);
  }, [active, registeredOpenReporter]);

  // Copies left by a terminated or reloaded session can never be reviewed or sent.
  useEffect(() => { if (active) removeOrphanedGroupDrafts(); }, [active]);

  // Errors from drafts, the outbox and recording follow the screens' language.
  useEffect(() => { setKueLocale(displayLocale); }, [displayLocale]);

  // The types require submitLabel with a custom handler; untyped callers get the neutral fallback.
  useEffect(() => {
    if (active && missingLabel) console.warn(`[KUE] Set submitLabel when using onSubmit or onSubmitGroup. Showing "${text.send}" until then.`);
  }, [active, missingLabel, text]);

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
      if (reviewAfterCloseRef.current) {
        reviewAfterCloseRef.current = false;
        setOverlay("group");
      }
    },
    [closeReporter, releaseOrDefer],
  );

  const handleSubmit = useCallback(
    async (report: KueLocalReport, action: FindingAction) => {
      const collected = captureGroupRef.current;
      const plan = planFindingAction(action, joinedFindings(collected?.draft));
      if (plan !== "submit") {
        const session = collected ?? { draft: createGroupDraft(), cloud: cloud ? { ...cloud } : undefined, onSubmitGroup };
        if (collected !== groupRef.current || (!session.onSubmitGroup && destination(session.cloud) !== destination(cloud))) {
          throw new Error(text.errors.destinationLocked);
        }
        session.draft.add(report);
        groupRef.current = session;
        reviewAfterCloseRef.current = plan === "collect-and-review";
        changed();
        return;
      }
      await dispatchKueReport(report, {
        cloud,
        onReceipt,
        onSubmit,
        submitCloud: submitKueReport,
        submitPersistent: durable ? submitWithOutbox : undefined,
        onQueued: onQueued ?? (() => Alert.alert("KUE", text.errors.queued)),
        submitLocal: defaultSubmit,
      });
    },
    [cloud, onReceipt, onSubmit, onSubmitGroup, durable, onQueued, text],
  );

  const openSavedFindings = () => {
    if (!groupRef.current || phaseRef.current !== "editing") return;
    savedOpenRef.current = true; setSavedOpen(true); setOverlay("group");
  };
  const discardGroup = () => {
    groupRef.current?.draft.discard(); groupRef.current = null;
    setOverlay("none"); changed();
  };
  const beginRecording = async () => {
    if (startingRecordingRef.current) return;
    if (recording === "off" || !cloud || (onSubmit && !onSubmitGroup)) {
      reportError(new Error(text.errors.recordingNeedsCloud)); return;
    }
    if (groupRef.current?.draft.locked || groupRef.current?.draft.full || !validGroupDestination) { setOverlay("group"); return; }
    // The radial menu has already closed when its action runs, while the list stays open until
    // recording starts; either way, closing the list or another capture cancels the start.
    const requested = overlayChangesRef.current;
    startingRecordingRef.current = true;
    try {
      const features = await getKueProjectFeatures(cloud);
      if (!features.recording.entitled) throw new Error(text.errors.recordingNeedsIndie);
      if (!features.recording.available) throw new Error(text.errors.recordingUnavailable);
      if (!mountedRef.current || !activeRef.current || overlayChangesRef.current !== requested || phaseRef.current !== "idle" ||
        openingRef.current || currentRecordingConfig.current.recording === "off" ||
        destination(currentRecordingConfig.current.cloud) !== destination(cloud)) return;
      recordingSessionRef.current = { group: groupRef.current, cloud: { ...cloud }, onSubmitGroup, context: createReportContext(context) };
      setOverlay("recording");
    } catch (cause) { if (mountedRef.current && activeRef.current) reportError(cause); }
    finally { startingRecordingRef.current = false; }
  };
  const saveRecording = (video: KueCapturedVideo, memo: string) => {
    const session = recordingSessionRef.current;
    if (!session || session.group !== groupRef.current || destination(session.cloud) !== destination(cloud)) {
      throw new Error(text.errors.destinationChanged);
    }
    const nextGroup = session.group ?? { draft: createGroupDraft(), cloud: session.cloud, onSubmitGroup: session.onSubmitGroup };
    nextGroup.draft.add({ clientReportId: createClientReportId(), video, memo, context: session.context, capturedAt: video.capturedAt });
    groupRef.current = nextGroup;
    setOverlay("group"); changed();
  };
  const submitGroup = async (title: string) => {
    const session = groupRef.current;
    if (!session || !validGroupDestination) throw new Error(text.errors.destinationChanged);
    await session.draft.submit(title, async (payload) => {
      if (session.onSubmitGroup) { await session.onSubmitGroup(payload); return; }
      if (!session.cloud) throw new Error(text.errors.noGroupDestination);
      const receipt = await submitKueReportGroup(payload, session.cloud);
      // Notification failure must not change the accepted group into a retry.
      try { void Promise.resolve(onReceipt?.(receipt)).catch(() => undefined); } catch { /* Accepted. */ }
    });
    if (mountedRef.current && groupRef.current === session) {
      groupRef.current = null; setOverlay("none"); changed();
    }
  };

  // Groups need Cloud, or onSubmitGroup next to a custom onSubmit.
  const groupable = !!onSubmitGroup || (!!cloud && !onSubmit);
  // A recording joins a group and needs Cloud for the plan check; elsewhere the menu treats it as off.
  const menuRecording = cloud && groupable ? recording : "off";
  const captureActions = useCaptureActions({ visible: active && (overlay === "radial" || overlay === "actions"), cloud, recording: menuRecording,
    groupCount: group?.draft.findings.length ?? 0, groupLabel, outbox: durable,
    onClose: () => setOverlay("none"), onRecord: () => void beginRecording(),
    onCreateIssue: () => setOverlay("group"), onOutbox: () => { setOverlay("none"); setOutboxVisible(true); }, text });

  if (!active) return null;
  const recordingTrigger = overlay === "recording" && recordingControl !== null;

  return (
    <>
      <TriggerSurface pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <KueTrigger visible={foreground && (recordingTrigger || (floatingButton && phase === "idle" && !outboxVisible && (overlay === "none" || overlay === "radial")))} design={buttonDesign} count={group?.draft.findings.length ?? 0}
          recording={recordingTrigger} stopping={recordingTrigger && recordingControl.stopping}
          onPress={recordingTrigger ? recordingControl.stop : () => void openReporter().catch(() => undefined)}
          actions={captureActions} onMenuVisibilityChange={open => { if (open) setOverlay("radial"); else if (overlayRef.current === "radial") setOverlay("none"); }}
          onLongPress={recordingTrigger || captureActions.length === 0 ? undefined : () => setOverlay("actions")} text={text} />
      </TriggerSurface>
      <CaptureActions visible={overlay === "actions"} actions={captureActions} onClose={() => setOverlay("none")} text={text} />
      <GroupReview draft={group?.draft ?? null} visible={overlay === "group"} validDestination={validGroupDestination} label={groupLabel} toCloud={groupToCloud}
        onClose={() => setOverlay("none")} onDiscard={discardGroup} onChanged={changed} onSubmit={submitGroup} text={text} />
      {overlay === "recording" ? <RecordingFlow onSave={saveRecording} onClose={() => setOverlay("none")} onControlChange={setRecordingControl} text={text} /> : null}
      {durable && cloud ? <OutboxView cloud={cloud} visible={outboxVisible} onClose={() => setOutboxVisible(false)} text={text} /> : null}
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
        collectedCount={joinedFindings(captureGroupRef.current?.draft)}
        singleLabel={singleLabel}
        groupLabel={groupLabel}
        canCollect={groupable && draftAccepts(captureGroupRef.current?.draft)}
        notice={groupable ? closedDraftNotice(captureGroupRef.current?.draft, text) : undefined}
        onOpenSaved={groupable && !draftAccepts(captureGroupRef.current?.draft) ? openSavedFindings : undefined}
        hidden={savedOpen}
        text={text}
      />
    </>
  );
}
