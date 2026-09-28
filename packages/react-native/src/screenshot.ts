import { Platform } from "react-native";
import { addScreenshotListener } from "expo-screen-capture";
import type { KueTriggerSource } from "./types";

/** Opens the editor after an OS screenshot; never reads the photo library or uploads it. */
export const screenshotTrigger: KueTriggerSource = (open) => {
  if (Platform.OS === "android" && Number(Platform.Version) < 34) {
    throw new Error("KUE: スクリーンショット起動はAndroid 14以降で利用できます。写真アクセス権限は要求しません。");
  }
  const subscription = addScreenshotListener(open);
  return () => subscription.remove();
};
