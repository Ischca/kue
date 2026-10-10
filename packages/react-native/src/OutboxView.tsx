import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { discardStoredKueReport, pendingKueReports, retryPendingKueReports } from "./outbox";
import type { KueText } from "./i18n";
import type { KueCloudConfig } from "./types";

export function OutboxView({ cloud, visible, onClose, text }: { cloud: KueCloudConfig; visible: boolean; onClose: () => void; text: KueText }) {
  const [entries, setEntries] = useState<ReturnType<typeof pendingKueReports>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    try { setEntries(pendingKueReports(cloud, true)); } catch (cause) { setError(cause instanceof Error ? cause.message : text.outbox.loadFailed); }
  }, [cloud.apiBaseUrl, cloud.projectKey]);
  useEffect(() => { if (visible) { setError(""); refresh(); } }, [visible, refresh]);
  const retry = async () => {
    setBusy(true); setError("");
    try { await retryPendingKueReports(cloud, { force: true, active: () => AppState.currentState === "active", error: (cause) => setError(cause instanceof Error ? cause.message : text.outbox.sendFailed) }); }
    finally { setBusy(false); refresh(); }
  };
  return <Modal visible={visible} onRequestClose={() => { if (!busy) onClose(); }} animationType="slide">
    <SafeAreaProvider><SafeAreaView style={styles.page}>
      <View style={styles.row}><Text style={styles.title}>{text.outbox.title}</Text><Pressable disabled={busy} onPress={onClose} accessibilityRole="button"><Text>{text.outbox.close}</Text></Pressable></View>
      <Text>{text.outbox.note}</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable disabled={busy || !entries.length} accessibilityRole="button" onPress={() => void retry().catch((cause: unknown) => setError(String(cause)))} style={styles.button}><Text>{busy ? text.outbox.sending : text.outbox.resend}</Text></Pressable>
      <ScrollView>{!entries.length && <Text>{text.outbox.empty}</Text>}{entries.map((entry) => <View key={entry.clientReportId} style={styles.item}>
        <Text>{new Date(entry.savedAt).toLocaleString()} · {!entry.currentDestination ? text.outbox.otherDestination : entry.state === "blocked" ? text.outbox.blocked : text.outbox.pending}</Text>
        <Text selectable>{entry.clientReportId}</Text>
        <Pressable disabled={busy} accessibilityRole="button" onPress={() => Alert.alert(text.outbox.deleteTitle, text.outbox.deleteBody, [
          { text: text.outbox.cancel, style: "cancel" }, { text: text.outbox.delete, style: "destructive", onPress: () => {
            try { discardStoredKueReport(entry.clientReportId); refresh(); } catch (cause) { setError(String(cause)); }
          } },
        ])}><Text style={styles.error}>{text.outbox.delete}</Text></Pressable>
      </View>)}</ScrollView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({ page: { flex: 1, padding: 20, backgroundColor: "#fff" }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }, title: { fontSize: 20, fontWeight: "700" }, error: { color: "#a32a2a", marginVertical: 10 }, button: { backgroundColor: "#e4eee8", padding: 16, marginVertical: 20, borderRadius: 8 }, item: { paddingVertical: 18, borderBottomWidth: 1, borderColor: "#ddd", gap: 6 } });
