import { Platform } from "react-native";
import { addScreenshotListener } from "expo-screen-capture";
import { currentKueText } from "./i18n";
import type { KueTriggerSource } from "./types";

/** Opens the editor after an OS screenshot; never reads the photo library or uploads it. */
export const screenshotTrigger: KueTriggerSource = (open) => {
  if (Platform.OS === "android" && Number(Platform.Version) < 34) {
    throw new Error(currentKueText().errors.screenshotTrigger);
  }
  const subscription = addScreenshotListener(open);
  return () => subscription.remove();
};
