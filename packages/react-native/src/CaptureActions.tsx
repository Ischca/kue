import { useEffect, useState } from "react";
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { getKueProjectFeatures, normalizeKueCloudConfig } from "./cloud";
import type { KueCloudConfig, KueProjectFeatures, KueRecordingMode } from "./types";
import { recordingAvailability, recordingMessages } from "./recordingAvailability";
import { nativeRecordingAvailable } from "./recording";
import type { CaptureAction } from "./radialMenu";

interface CaptureActionsOptions {
  visible: boolean; cloud?: KueCloudConfig; groupCount: number; hasGroup: boolean; canGroup: boolean; outbox: boolean;
  recording?: KueRecordingMode;
  onClose: () => void; onCapture: () => void; onCollect: () => void; onReview: () => void; onOutbox: () => void;
  onRecord: () => void;
}

export function useCaptureActions({ visible, cloud, recording = "auto", groupCount, hasGroup, canGroup, outbox, onClose, onCapture, onCollect, onReview, onOutbox, onRecord }: CaptureActionsOptions): CaptureAction[] {
  const [features, setFeatures] = useState<KueProjectFeatures | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFeatures(null); setFailure(false);
    if (!visible || !cloud || recording === "off") return;
    let cancelled = false;
    void getKueProjectFeatures(cloud).then(value => { if (!cancelled) setFeatures(value); })
      .catch(() => { if (!cancelled) setFailure(true); });
    return () => { cancelled = true; };
  }, [visible, cloud?.apiBaseUrl, cloud?.projectKey, attempt, recording]);
  const availability = recordingAvailability({ mode: recording, hasCloud: Boolean(cloud), features, failed: failure, nativeAvailable: nativeRecordingAvailable() });
  const record = () => {
    if (availability === "ready") { onRecord(); return; }
    onClose();
    if (availability !== "upgrade") {
      if (availability === "check_failed") setAttempt(value => value + 1);
      Alert.alert("画面録画", recordingMessages[availability]); return;
    }
    if (availability === "upgrade" && cloud) {
      Alert.alert("Indieで画面録画を解放", "画面録画はIndieプランで利用できます。スクリーンショットとまとめ送信はFreeでも利用できます。", [
        { text: "閉じる", style: "cancel" },
        { text: "プランを確認", onPress: () => {
          const url = normalizeKueCloudConfig(cloud).endpoint.replace(/\/v1\/reports$/u, "/app");
          void Linking.openURL(url).catch(() => Alert.alert("KUE", "ブラウザを開けませんでした。"));
        } },
      ]); return;
    }
  };
  return [
    { id: "screenshot", label: "スクリーンショット", symbol: "▣", onSelect: onCapture },
    { id: "collect", label: hasGroup ? "指摘を追加" : "指摘をまとめる", symbol: "+", onSelect: onCollect, disabled: !canGroup },
    ...(hasGroup ? [{ id: "review", label: `まとめを確認（${groupCount}件）`, symbol: "≡", onSelect: onReview }] : []),
    { id: "recording", label: availability === "upgrade" ? "画面録画 · Indieで解放" : recording === "off" ? "画面録画（オフ）" : "画面録画",
      symbol: "●", onSelect: record, locked: availability === "upgrade" },
    ...(outbox ? [{ id: "outbox", label: "送信待ち", symbol: "↑", onSelect: onOutbox }] : []),
  ];
}

/** TalkBack/VoiceOver and tiny-window fallback. Touch users use the radial menu. */
export function CaptureActions({ visible, actions, onClose }: { visible: boolean; actions: CaptureAction[]; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.card} accessibilityViewIsModal>
      <Text accessibilityRole="header" style={styles.heading}>KUE</Text>
      {actions.map(action => <Pressable key={action.id} accessibilityRole="button" accessibilityState={{ disabled: !!action.disabled }}
        disabled={action.disabled} onPress={action.onSelect} style={[styles.action, action.disabled && styles.disabled]} testID={`kue-menu-${action.id}`}>
        <Text style={styles.text}>{action.label}{action.locked ? " 🔒" : ""}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.action} testID="kue-menu-close"><Text style={styles.text}>閉じる</Text></Pressable>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(15,23,42,0.55)" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20 },
  heading: { color: "#0F172A", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  action: { paddingVertical: 15, minHeight: 48 }, text: { color: "#0F172A", fontSize: 17 }, disabled: { opacity: 0.4 },
});
