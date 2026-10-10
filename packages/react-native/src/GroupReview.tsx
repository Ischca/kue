import { useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { GroupDraft } from "./groupDraft";
import type { KueText } from "./i18n";
import { defaultIssueTitle } from "./issueFlow";
import { previewRecording } from "./recording";

export function GroupReview({ draft, visible, validDestination, label, toCloud, onClose, onDiscard, onChanged, onSubmit, text }: {
  draft: GroupDraft | null; visible: boolean; validDestination: boolean; onClose: () => void; text: KueText;
  /** The group action, e.g. 「Issueを作る」; `toCloud` is false when an app handler receives the group. */
  label: string; toCloud: boolean;
  onDiscard: () => void; onChanged: () => void; onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(""); setError(""); setBusy(false); }, [draft]);
  // Start from the first finding's memo each time the screen opens; an edited title is kept.
  useEffect(() => {
    if (visible && draft && !draft.locked) setTitle(current => current || defaultIssueTitle(draft.findings));
  }, [visible, draft]);
  const action = (label: string, fn: () => void, disabled = false) => <Pressable accessibilityRole="button"
    disabled={disabled || busy} onPress={fn} style={[styles.action, (disabled || busy) && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
  const send = async () => {
    if (busy || !draft) return;
    setBusy(true); setError("");
    try { await onSubmit(title); }
    catch (cause) { setError(cause instanceof Error ? cause.message : text.review.sendFailed); }
    finally { setBusy(false); onChanged(); }
  };
  return <Modal visible={visible && !!draft} onRequestClose={() => { if (!busy) onClose(); }} animationType="slide">
    <SafeAreaProvider><SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>{label}</Text>
      <Text style={styles.note}>{text.review.note(toCloud)}</Text>
      {!validDestination ? <Text style={styles.error}>{text.review.destinationChanged}</Text> : null}
      {draft?.locked ? <Text style={styles.note}>{text.review.maybeSent}</Text> : null}
      {draft?.full && !draft.locked ? <Text style={styles.note}>{text.review.full(toCloud)}</Text> : null}
      <TextInput accessibilityLabel={text.review.title(toCloud)} placeholder={text.review.title(toCloud)} placeholderTextColor="#64748B"
        editable={!busy && !draft?.locked} value={title} onChangeText={setTitle} maxLength={200} style={styles.input} />
      {draft?.findings.map((finding, index) => <View key={finding.clientReportId} style={styles.finding}>
        <Text style={styles.text}>{index + 1}. {finding.memo}</Text>
        {"video" in finding ? <>
          <Text style={styles.note}>{text.review.video((finding.video.durationMs / 1000).toFixed(1))}</Text>
          {action(text.review.play, () => { void previewRecording(finding.video.uri).catch(() => setError(text.review.playFailed)); })}
        </>
          : <Image source={{ uri: finding.screenshot.uri }} style={styles.image} resizeMode="contain" accessibilityLabel={text.review.image(index + 1)} />}
        {action(text.review.remove, () => { draft.remove(finding.clientReportId); onChanged(); }, draft.locked)}
      </View>)}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {action(busy ? text.review.sending : draft?.locked ? text.review.resend : text.count(label, draft?.findings.length ?? 0), () => void send(),
        !validDestination || !draft?.findings.length || (!draft.locked && !title.trim()))}
      {action(text.review.back, onClose)}
      {action(text.review.discardAll, () => Alert.alert(text.review.discardAll, draft?.locked
        ? text.review.discardLocked(toCloud)
        : text.review.discardUnlocked, [
        { text: text.review.cancel, style: "cancel" }, { text: text.review.discard, style: "destructive", onPress: onDiscard },
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
