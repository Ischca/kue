import { Accelerometer } from "expo-sensors";
import { createShakeDetector } from "./shakeDetector";
import type { KueTriggerSource } from "./types";

/** Optional entry point; requires expo-sensors in the development build. */
export const shakeTrigger: KueTriggerSource = async (open) => {
  // Simulators commonly lack an accelerometer; keep the other activation paths usable.
  if (!await Accelerometer.isAvailableAsync()) return () => undefined;
  const detect = createShakeDetector();
  // Do not change a shared accelerometer's update interval or remove other listeners.
  const subscription = Accelerometer.addListener((sample) => { if (detect(sample)) open(); });
  return () => subscription.remove();
};
