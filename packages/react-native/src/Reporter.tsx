import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createClientReportId } from "./clientReportId";
import { CropEditor } from "./CropEditor";
import { FULL_CROP, normalizeCrop } from "./crop";
import { findingActionLabel, type FindingAction } from "./issueFlow";
import { createCroppedScreenshot } from "./manipulate";
import { OperationGeneration } from "./operationGeneration";
import {
  createPreparedReportKey,
  PreparedReportCache,
  PreparedReportInvalidatedError,
} from "./preparedReport";
import type {
  KueCapturedImage,
  KueLocalReport,
  KueReportContext,
  NormalizedCrop,
} from "./types";

interface ReporterProps {
  capture: KueCapturedImage | null;
  context: KueReportContext | null;
  initialMemo: string;
  onCancel: () => void;
  onError: (error: Error) => void;
  onRelease: (uri: string) => void;
  onSubmit: (report: KueLocalReport, action: FindingAction) => void | Promise<void>;
  onSubmitted: (report: KueLocalReport) => void;
  onSubmittingChange: (submitting: boolean) => void;
  /** Findings already in the draft; the main action includes them. */
  collectedCount?: number;
  /** Main action without collected findings, e.g. 「Issueを作る」 or the app's submitLabel. */
  singleLabel: string;
  /** Main action when it includes collected findings; the count is appended. */
  groupLabel: string;
  /** Add finding needs a group destination (Cloud, or onSubmitGroup with a custom onSubmit). */
  canCollect?: boolean;
  /** Why this finding goes alone when the saved draft cannot take it. */
  notice?: string;
  /** Replaces Add finding while the draft cannot take this finding; the finding stays open. */
  onOpenSaved?: () => void;
  /** Hidden while the saved findings it opened are shown; memo and crop are kept. */
  hidden?: boolean;
}

const asError = (value: unknown) =>
  value instanceof Error ? value : new Error(typeof value === "string" ? value : "Unknown error");

export function Reporter({
  capture,
  context,
  initialMemo,
  onCancel,
  onError,
  onRelease,
  onSubmit,
  onSubmitted,
  onSubmittingChange,
  collectedCount = 0,
  singleLabel,
  groupLabel,
  canCollect = false,
  notice,
  onOpenSaved,
  hidden = false,
}: ReporterProps) {
  const [memo, setMemo] = useState(initialMemo);
  const [crop, setCrop] = useState<NormalizedCrop>({ ...FULL_CROP });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<FindingAction | null>(null);
  const inputRef = useRef<TextInput>(null);
  const submittingRef = useRef(false);
  const operationGenerationRef = useRef(new OperationGeneration());
  const preparedReportRef = useRef(new PreparedReportCache());

  useEffect(() => {
    preparedReportRef.current.discard(capture?.uri, onRelease);
    if (!capture) {
      operationGenerationRef.current.invalidate();
      return undefined;
    }

    const generation = operationGenerationRef.current.activate();
    setMemo(initialMemo);
    setCrop({ ...FULL_CROP });
    setErrorMessage(null);
    setSubmitting(false);
    setPendingAction(null);
    submittingRef.current = false;

    const sourceUri = capture.uri;
    return () => {
      operationGenerationRef.current.invalidate(generation);
      preparedReportRef.current.discard(sourceUri, onRelease);
    };
  }, [capture?.uri, initialMemo, onRelease]);

  const handleCancel = () => {
    if (submittingRef.current) return;
    preparedReportRef.current.discard(capture?.uri, onRelease);
    onCancel();
  };

  const updateCrop = (nextCrop: NormalizedCrop) => {
    preparedReportRef.current.discardIfDraftChanged(
      createPreparedReportKey(memo, normalizeCrop(nextCrop)),
      capture?.uri ?? "",
      onRelease,
    );
    setCrop(nextCrop);
    setErrorMessage(null);
  };

  const updateMemo = (value: string) => {
    preparedReportRef.current.discardIfDraftChanged(
      createPreparedReportKey(value, normalizeCrop(crop)),
      capture?.uri ?? "",
      onRelease,
    );
    setMemo(value);
    setErrorMessage(null);
  };

  const handleSubmit = async (action: FindingAction) => {
    if (!capture || !context || submittingRef.current) return;
    const operationGeneration = operationGenerationRef.current.current();
    if (operationGeneration === null) return;
    const trimmedMemo = memo.trim();
    if (!trimmedMemo) return;

    submittingRef.current = true;
    onSubmittingChange(true);
    setSubmitting(true);
    setPendingAction(action);
    setErrorMessage(null);

    try {
      const normalizedCrop = normalizeCrop(crop);
      const preparedKey = createPreparedReportKey(trimmedMemo, normalizedCrop);
      const report = await preparedReportRef.current.getOrCreate(
        preparedKey,
        async (): Promise<KueLocalReport> => ({
          clientReportId: createClientReportId(),
          memo: trimmedMemo,
          crop: normalizedCrop,
          screenshot: await createCroppedScreenshot(capture, normalizedCrop),
          sourceSize: { width: capture.width, height: capture.height },
          context,
          capturedAt: capture.capturedAt,
        }),
        capture.uri,
        onRelease,
      );

      if (!operationGenerationRef.current.isActive(operationGeneration)) return;
      await onSubmit(report, action);
      if (!operationGenerationRef.current.isActive(operationGeneration)) return;
      const submittedReport = preparedReportRef.current.take();
      if (submittedReport) onSubmitted(submittedReport);
    } catch (cause) {
      if (
        cause instanceof PreparedReportInvalidatedError ||
        !operationGenerationRef.current.isActive(operationGeneration)
      ) {
        return;
      }
      const error = asError(cause);
      setErrorMessage(error.message);
      onError(error);
    } finally {
      if (operationGenerationRef.current.isActive(operationGeneration)) {
        submittingRef.current = false;
        setSubmitting(false);
        setPendingAction(null);
      }
      onSubmittingChange(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleCancel}
      onShow={() => requestAnimationFrame(() => inputRef.current?.focus())}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={Boolean(capture && context) && !hidden}
    >
      <SafeAreaProvider style={styles.provider}>
        <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.keyboardArea}
          >
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="KUEを閉じる"
                accessibilityRole="button"
                disabled={submitting}
                hitSlop={12}
                onPress={handleCancel}
                style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
                testID="kue-cancel"
              >
                <Text style={styles.cancelText}>キャンセル</Text>
              </Pressable>
              <Text accessibilityRole="header" style={styles.title}>
                KUE
              </Text>
              <Pressable
                accessibilityLabel="クロップ範囲を全画面に戻す"
                accessibilityRole="button"
                disabled={submitting}
                hitSlop={12}
                onPress={() => updateCrop({ ...FULL_CROP })}
                style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
                testID="kue-reset-crop"
              >
                <Text style={styles.resetText}>範囲をリセット</Text>
              </Pressable>
            </View>

            {capture ? (
              <CropEditor
                capture={capture}
                crop={crop}
                disabled={submitting}
                onChange={updateCrop}
              />
            ) : null}

            <View style={styles.composer}>
              <Text style={styles.label}>何を直したい？</Text>
              <TextInput
                accessibilityLabel="修正したい内容"
                autoFocus
                editable={!submitting}
                multiline
                onChangeText={updateMemo}
                placeholder="例：プロフィールカードの左右paddingを広げる"
                placeholderTextColor="#94A3B8"
                ref={inputRef}
                returnKeyType="default"
                style={styles.input}
                testID="kue-memo-input"
                textAlignVertical="top"
                value={memo}
              />

              {errorMessage ? (
                <Text accessibilityLiveRegion="polite" style={styles.error}>
                  {errorMessage}
                </Text>
              ) : null}

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <View style={styles.actions}>
                {onOpenSaved ? (
                  <Pressable
                    accessibilityHint="この指摘を残したまま、保存した指摘の確認画面を開きます"
                    accessibilityLabel="保存した指摘を開く"
                    accessibilityRole="button"
                    disabled={submitting}
                    onPress={onOpenSaved}
                    style={({ pressed }) => [styles.addButton, submitting && styles.addButtonDisabled, pressed && styles.pressed]}
                    testID="kue-open-saved"
                  >
                    <Text style={styles.addText}>保存した指摘を開く</Text>
                  </Pressable>
                ) : canCollect ? (
                  <Pressable
                    accessibilityHint="送信せずに端末へ保存し、あとでまとめて送ります"
                    accessibilityLabel="指摘を追加"
                    accessibilityRole="button"
                    disabled={submitting || memo.trim().length === 0}
                    onPress={() => void handleSubmit("add")}
                    style={({ pressed }) => [
                      styles.addButton,
                      (submitting || memo.trim().length === 0) && styles.addButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                    testID="kue-add-finding"
                  >
                    {pendingAction === "add" ? (
                      <ActivityIndicator color="#0F172A" />
                    ) : (
                      <Text style={styles.addText}>指摘を追加</Text>
                    )}
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityHint={collectedCount > 0 ? "追加した指摘と合わせて、確認画面を開きます" : undefined}
                  accessibilityLabel={findingActionLabel(singleLabel, groupLabel, collectedCount)}
                  accessibilityRole="button"
                  disabled={submitting || memo.trim().length === 0}
                  onPress={() => void handleSubmit("issue")}
                  style={({ pressed }) => [
                    styles.sendButton,
                    (submitting || memo.trim().length === 0) && styles.sendButtonDisabled,
                    pressed && styles.pressed,
                  ]}
                  testID="kue-send"
                >
                  {pendingAction === "issue" ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.sendText}>{findingActionLabel(singleLabel, groupLabel, collectedCount)}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  provider: {
    flex: 1,
  },
  safeArea: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  keyboardArea: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 16,
  },
  headerAction: {
    justifyContent: "center",
    minHeight: 44,
    minWidth: 72,
  },
  title: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  cancelText: {
    color: "#475569",
    fontSize: 16,
  },
  resetText: {
    color: "#2563EB",
    fontSize: 14,
    textAlign: "right",
  },
  composer: {
    backgroundColor: "#FFFFFF",
    borderTopColor: "#E2E8F0",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    padding: 16,
  },
  label: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 12,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 16,
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: {
    color: "#B91C1C",
    fontSize: 13,
  },
  notice: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  addButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 12,
    borderWidth: 1,
    // Shrinks with the send button on narrow screens instead of overflowing the row.
    flexShrink: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 116,
    paddingHorizontal: 20,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addText: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#0F172A",
    borderRadius: 12,
    // An app-provided submitLabel can be long; wrap inside the row instead of overflowing.
    flexShrink: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 116,
    paddingHorizontal: 20,
  },
  sendButtonDisabled: {
    backgroundColor: "#94A3B8",
  },
  sendText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  pressed: {
    opacity: 0.65,
  },
});
