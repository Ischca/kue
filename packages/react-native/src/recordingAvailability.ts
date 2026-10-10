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

