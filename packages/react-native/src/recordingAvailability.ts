import type { KueProjectFeatures, KueRecordingMode } from "./types";

export type RecordingAvailability = "off" | "cloud_required" | "checking" | "check_failed" | "upgrade" | "unavailable" | "rebuild" | "ready";
export function recordingAvailability({ mode = "auto", hasCloud, features, failed, nativeAvailable }: {
  mode?: KueRecordingMode; hasCloud: boolean; features: KueProjectFeatures | null; failed: boolean; nativeAvailable: boolean;
}): RecordingAvailability {
  if (mode === "off") return "off";
  if (!hasCloud) return "cloud_required";
  if (!features) return failed ? "check_failed" : "checking";
  if (!features.recording.entitled) return "upgrade";
  if (!features.recording.available) return "unavailable";
  return nativeAvailable ? "ready" : "rebuild";
}

export const recordingMessages = {
  off: "録画は設定で無効になっています。利用するには録画設定をautoに変更し、アプリを再ビルドしてください。",
  cloud_required: "録画の利用にはKUE Cloudへの接続とIndieプランが必要です。",
  checking: "プランを確認しています。",
  check_failed: "プランを確認できませんでした。通信状態を確認して再試行してください。",
  unavailable: "現在、このCloudでは録画を利用できません。",
  rebuild: "録画を使うにはアプリの再ビルドが必要です。CLIで設定を更新してから再ビルドしてください。",
} as const;
