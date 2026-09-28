import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { discardStoredKueReport, pendingKueReports, retryPendingKueReports } from "./outbox";
import type { KueCloudConfig } from "./types";

export function OutboxView({ cloud, visible, onClose }: { cloud: KueCloudConfig; visible: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<ReturnType<typeof pendingKueReports>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    try { setEntries(pendingKueReports(cloud, true)); } catch (cause) { setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。"); }
  }, [cloud.apiBaseUrl, cloud.projectKey]);
  useEffect(() => { if (visible) { setError(""); refresh(); } }, [visible, refresh]);
  const retry = async () => {
    setBusy(true); setError("");
    try { await retryPendingKueReports(cloud, { force: true, active: () => AppState.currentState === "active", error: (cause) => setError(cause instanceof Error ? cause.message : "送信に失敗しました。") }); }
    finally { setBusy(false); refresh(); }
  };
  return <Modal visible={visible} onRequestClose={() => { if (!busy) onClose(); }} animationType="slide">
    <SafeAreaProvider><SafeAreaView style={styles.page}>
      <View style={styles.row}><Text style={styles.title}>KUE · 送信待ち</Text><Pressable disabled={busy} onPress={onClose} accessibilityRole="button"><Text>閉じる</Text></Pressable></View>
      <Text>現在の送信先だけを再送します。保存から7日後、次の起動・確認時に削除されます。</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable disabled={busy || !entries.length} accessibilityRole="button" onPress={() => void retry().catch((cause: unknown) => setError(String(cause)))} style={styles.button}><Text>{busy ? "送信中…" : "今すぐ再送"}</Text></Pressable>
      <ScrollView>{!entries.length && <Text>送信待ちはありません。</Text>}{entries.map((entry) => <View key={entry.clientReportId} style={styles.item}>
        <Text>{new Date(entry.savedAt).toLocaleString()} · {!entry.currentDestination ? "別の送信先（再送しません）" : entry.state === "blocked" ? "要確認" : "送信待ち"}</Text>
        <Text selectable>{entry.clientReportId}</Text>
        <Pressable disabled={busy} accessibilityRole="button" onPress={() => Alert.alert("送信待ちを削除", "この端末に保存した画像とメモを削除します。取り消せません。", [
          { text: "キャンセル", style: "cancel" }, { text: "削除", style: "destructive", onPress: () => {
            try { discardStoredKueReport(entry.clientReportId); refresh(); } catch (cause) { setError(String(cause)); }
          } },
        ])}><Text style={styles.error}>削除</Text></Pressable>
      </View>)}</ScrollView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({ page: { flex: 1, padding: 20, backgroundColor: "#fff" }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }, title: { fontSize: 20, fontWeight: "700" }, error: { color: "#a32a2a", marginVertical: 10 }, button: { backgroundColor: "#e4eee8", padding: 16, marginVertical: 20, borderRadius: 8 }, item: { paddingVertical: 18, borderBottomWidth: 1, borderColor: "#ddd", gap: 6 } });
