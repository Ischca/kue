import { Dimensions, Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { requireOptionalNativeModule } from "expo";

import type { KueReportContext } from "./types";

export function createReportContext(
  defaults: Partial<KueReportContext> = {},
  overrides: Partial<KueReportContext> = {},
): KueReportContext {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("KUE report context is currently supported on iOS and Android only.");
  }

  const screen = Dimensions.get("screen");
  // expo-updates is optional. Read only non-identifying build/update constants.
  const updates = requireOptionalNativeModule<{ updateId?: string; runtimeVersion?: string }>("ExpoUpdates");
  const config = Constants.expoConfig;
  const expoGo = Constants.executionEnvironment === "storeClient";
  const auto: Partial<KueReportContext> = {
    osVersion: Device.osVersion ?? String(Platform.Version),
    deviceModel: Device.modelName ?? undefined,
    // Never describe the Expo Go binary as the consuming app's version/build.
    appVersion: (!expoGo && Application.nativeApplicationVersion) || config?.version,
    buildNumber: expoGo ? undefined : Application.nativeBuildVersion ?? undefined,
    expo: {
      updateId: updates?.updateId,
      runtimeVersion: updates?.runtimeVersion,
    },
  };

  return {
    platform: Platform.OS,
    screenWidth: screen.width,
    screenHeight: screen.height,
    ...auto,
    ...defaults,
    ...overrides,
    expo: { ...auto.expo, ...defaults.expo, ...overrides.expo },
  };
}
