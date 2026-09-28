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
  KueSubmitHandler,
  NormalizedCrop,
} from "./types";

interface ReporterProps {
  capture: KueCapturedImage | null;
  context: KueReportContext | null;
  initialMemo: string;
  onCancel: () => void;
  onError: (error: Error) => void;
  onRelease: (uri: string) => void;
  onSubmit: KueSubmitHandler;
  onSubmitted: (report: KueLocalReport) => void;
  onSubmittingChange: (submitting: boolean) => void;
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
}: ReporterProps) {
  const [memo, setMemo] = useState(initialMemo);
  const [crop, setCrop] = useState<NormalizedCrop>({ ...FULL_CROP });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  const handleSubmit = async () => {
    if (!capture || !context || submittingRef.current) return;
    const operationGeneration = operationGenerationRef.current.current();
    if (operationGeneration === null) return;
    const trimmedMemo = memo.trim();
    if (!trimmedMemo) return;

    submittingRef.current = true;
    onSubmittingChange(true);
    setSubmitting(true);
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
      await onSubmit(report);
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
      visible={Boolean(capture && context)}
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
                <Text style={styles.cancelText}>Cancel</Text>
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
                <Text style={styles.resetText}>Reset crop</Text>
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

              <Pressable
                accessibilityLabel="KUEを送信"
                accessibilityRole="button"
                disabled={submitting || memo.trim().length === 0}
                onPress={() => void handleSubmit()}
                style={({ pressed }) => [
                  styles.sendButton,
                  (submitting || memo.trim().length === 0) && styles.sendButtonDisabled,
                  pressed && styles.pressed,
                ]}
                testID="kue-send"
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.sendText}>Send →</Text>
                )}
              </Pressable>
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
  sendButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "#0F172A",
    borderRadius: 12,
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
  },
  pressed: {
    opacity: 0.65,
  },
});
