import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { cancelRecording, previewRecording, recordScreen, releaseRecording, stopRecording } from "./recording";
import type { KueText } from "./i18n";
import type { KueCapturedVideo } from "./types";

/** Recording never uploads. Save copies into the same explicit-confirmation draft as screenshots. */
export interface RecordingControl { stop: () => void; stopping: boolean }
export function RecordingFlow({ onSave, onClose, onControlChange, text }: {
  onSave: (video: KueCapturedVideo, memo: string) => void;
  text: KueText;
  onClose: () => void;
  onControlChange: (control: RecordingControl | null) => void;
}) {
  const [video, setVideo] = useState<KueCapturedVideo | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const mounted = useRef(false);
  const owned = useRef<KueCapturedVideo | null>(null);
  useEffect(() => {
    mounted.current = true;
    let disposed = false, started = false, settled = false;
    // StrictMode's discarded effect never starts a native capture.
    void Promise.resolve().then(async () => {
      if (disposed) return;
      started = true;
      try {
        const result = await recordScreen(); settled = true;
        if (disposed) { releaseRecording(result.uri); return; }
        owned.current = result; setVideo(result);
      } catch (cause) {
        settled = true;
        if (!disposed) setError(cause instanceof Error ? cause.message : text.recording.startFailed);
      }
    });
    return () => {
      mounted.current = false;
      disposed = true;
      if (started && !settled) void cancelRecording().catch(() => undefined);
      if (owned.current) releaseRecording(owned.current.uri);
      owned.current = null;
    };
  }, []);
  const stop = useCallback(() => {
    if (stoppingRef.current || !mounted.current) return;
    stoppingRef.current = true;
    setStopping(true);
    void stopRecording().catch(() => {
      if (!mounted.current) return;
      stoppingRef.current = false;
      setStopping(false);
      Alert.alert("KUE", text.recording.stopFailed);
    });
  }, []);
  useEffect(() => {
    onControlChange(!video && !error ? { stop, stopping } : null);
    return () => onControlChange(null);
  }, [video, error, stopping, stop, onControlChange]);
  const action = (label: string, fn: () => void, disabled = false) => <Pressable accessibilityRole="button"
    disabled={disabled} onPress={fn} style={[styles.action, disabled && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
  // The existing floating trigger supplies the stop control at its remembered position.
  if (!video && !error) return null;
  return <Modal visible onRequestClose={onClose} animationType="none">
    <SafeAreaProvider><SafeAreaView style={styles.page}>
      <Text style={styles.heading}>{text.recording.heading}</Text>
      {video ? <>
        <Text style={styles.text}>{text.recording.details((video.durationMs / 1000).toFixed(1), (video.byteSize / 1024 / 1024).toFixed(1))}</Text>
        {action(text.review.play, () => { void previewRecording(video.uri).catch(() => setError(text.review.playFailed)); })}
        <TextInput multiline accessibilityLabel={text.recording.memoLabel} placeholder={text.recording.placeholder} placeholderTextColor="#64748B"
          value={memo} onChangeText={setMemo} maxLength={4096} style={styles.input} />
        <Text style={styles.note}>{text.recording.note}</Text>
        {action(text.recording.save, () => {
          try { onSave(video, memo.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : text.recording.saveFailed); }
        }, !memo.trim())}
      </> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {action(text.recording.discard, onClose)}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F8FAFC", padding: 20, gap: 16 }, heading: { color: "#0F172A", fontWeight: "700", fontSize: 22 },
  text: { color: "#0F172A", fontSize: 14 }, note: { color: "#475569", fontSize: 14 }, error: { color: "#B91C1C" },
  action: { backgroundColor: "#E2E8F0", borderRadius: 10, padding: 14, minHeight: 48 }, disabled: { opacity: 0.4 },
  input: { minHeight: 120, borderWidth: 1, borderColor: "#94A3B8", padding: 12, borderRadius: 8, color: "#0F172A", textAlignVertical: "top" },
});
