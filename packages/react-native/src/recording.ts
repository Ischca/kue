import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { currentKueText } from "./i18n";
import type { KueCapturedVideo } from "./types";

interface Recorder {
  record(): Promise<KueCapturedVideo>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  preview(uri: string): Promise<void>;
}
// Optional on Free, explicitly disabled builds and Expo Go. Never requireNativeModule.
const recorder = requireOptionalNativeModule<Recorder>("KueRecorder");
export const nativeRecordingAvailable = () => recorder !== null;
export async function recordScreen(): Promise<KueCapturedVideo> {
  if (!recorder) throw new Error(currentKueText().errors.rebuild);
  return recorder.record();
}
export const stopRecording = () => recorder?.stop() ?? Promise.resolve();
export const cancelRecording = () => recorder?.cancel() ?? Promise.resolve();
export const previewRecording = (uri: string) => recorder?.preview(uri) ?? Promise.reject(new Error(currentKueText().errors.previewFailed));
export function releaseRecording(uri: string): void {
  // Only the recorder's cache directory is owned here, never arbitrary adapters/files.
  if (!/^file:\/\//u.test(uri) || !/\/kue-recordings\/[A-Za-z0-9_-]+\.mp4$/u.test(uri)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* OS cache eviction is also safe. */ }
}
