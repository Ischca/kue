import { useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { GroupDraft } from "./groupDraft";
import { previewRecording } from "./recording";

export function GroupReview({ draft, visible, validDestination, onClose, onDiscard, onChanged, onSubmit }: {
  draft: GroupDraft | null; visible: boolean; validDestination: boolean; onClose: () => void;
  onDiscard: () => void; onChanged: () => void; onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(""); setError(""); setBusy(false); }, [draft]);
  const action = (label: string, fn: () => void, disabled = false) => <Pressable accessibilityRole="button"
    disabled={disabled || busy} onPress={fn} style={[styles.action, (disabled || busy) && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
  const send = async () => {
    if (busy || !draft) return;
    setBusy(true); setError("");
    try { await onSubmit(title); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "送信できませんでした。"); }
    finally { setBusy(false); onChanged(); }
  };
  return <Modal visible={visible && !!draft} onRequestClose={() => { if (!busy) onClose(); }} animationType="slide">
    <SafeAreaProvider><SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>1つのIssueにまとめる</Text>
      <Text style={styles.note}>送信するまでCloudにはアップロードしません。下書きはアプリを終了すると失われます。</Text>
      {!validDestination ? <Text style={styles.error}>接続先が変更されています。元の設定に戻すか、この下書きを破棄してください。</Text> : null}
      {draft?.locked ? <Text style={styles.note}>送信済みの可能性があります。同じ内容で再送して受付を確認します。</Text> : null}
      <TextInput accessibilityLabel="Issueのタイトル" placeholder="Issueのタイトル" placeholderTextColor="#64748B"
        editable={!busy && !draft?.locked} value={title} onChangeText={setTitle} maxLength={200} style={styles.input} />
      {draft?.findings.map((finding, index) => <View key={finding.clientReportId} style={styles.finding}>
        <Text style={styles.text}>{index + 1}. {finding.memo}</Text>
        {"video" in finding ? <>
          <Text style={styles.note}>画面録画 · {(finding.video.durationMs / 1000).toFixed(1)}秒 · 無音</Text>
          {action("動画を再生", () => { void previewRecording(finding.video.uri).catch(() => setError("動画を再生できませんでした。")); })}
        </>
          : <Image source={{ uri: finding.screenshot.uri }} style={styles.image} resizeMode="contain" accessibilityLabel={`指摘${index + 1}の画像`} />}
        {action("この指摘を削除", () => { draft.remove(finding.clientReportId); onChanged(); }, draft.locked)}
      </View>)}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {action(busy ? "送信中…" : draft?.locked ? "同じ内容で再送" : `${draft?.findings.length ?? 0}件を1つのIssueとして送信`, () => void send(),
        !validDestination || !draft?.findings.length || (!draft.locked && !title.trim()))}
      {action("戻る", onClose)}
      {action("まとめを破棄", () => Alert.alert("まとめを破棄", draft?.locked
        ? "端末の下書きを削除します。すでに受付済みの場合、Issueの作成は取り消されません。"
        : "保存した指摘と画像を端末から削除します。送信はしません。", [
        { text: "キャンセル", style: "cancel" }, { text: "破棄", style: "destructive", onPress: onDiscard },
      ]))}
    </ScrollView></SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F8FAFC" }, content: { padding: 20, gap: 12 },
  heading: { color: "#0F172A", fontSize: 22, fontWeight: "700" }, text: { color: "#0F172A", fontSize: 16 },
  note: { color: "#475569", fontSize: 14 }, error: { color: "#B91C1C" },
  action: { backgroundColor: "#E2E8F0", borderRadius: 10, padding: 15, minHeight: 48 }, disabled: { opacity: 0.4 },
  input: { borderWidth: 1, borderColor: "#94A3B8", padding: 12, borderRadius: 8, color: "#0F172A" },
  finding: { padding: 12, borderWidth: 1, borderColor: "#CBD5E1", gap: 10, borderRadius: 10 },
  image: { height: 200, width: "100%" },
});
