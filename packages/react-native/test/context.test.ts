import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  platform: { OS: "ios", Version: "26.5" },
  application: { nativeApplicationVersion: "2.0", nativeBuildVersion: "42" },
  constants: { executionEnvironment: "bare", expoConfig: { version: "1.0" } },
  updates: { updateId: "ota-123", runtimeVersion: "2" } as { updateId?: string; runtimeVersion?: string } | null,
}));
vi.mock("react-native", () => ({ Platform: mocks.platform, Dimensions: { get: () => ({ width: 390, height: 844 }) } }));
vi.mock("expo-application", () => mocks.application);
vi.mock("expo-constants", () => ({ default: mocks.constants }));
vi.mock("expo-device", () => ({ modelName: "iPhone 17", osVersion: "26.5", deviceName: "PRIVATE NAME" }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => mocks.updates }));
import { createReportContext } from "../src/context";
beforeEach(() => { mocks.platform.OS = "ios"; mocks.constants.executionEnvironment = "bare"; mocks.updates = { updateId: "ota-123", runtimeVersion: "2" }; });
it("fills non-identifying metadata from the actual native build", () => {
  expect(createReportContext()).toMatchObject({ platform: "ios", osVersion: "26.5", deviceModel: "iPhone 17", appVersion: "2.0", buildNumber: "42", screenWidth: 390, screenHeight: 844, expo: { updateId: "ota-123", runtimeVersion: "2" } });
  expect(JSON.stringify(createReportContext())).not.toContain("PRIVATE");
  expect(createReportContext().route).toBeUndefined();
});
it("preserves caller precedence and merges nested Expo fields", () => {
  expect(createReportContext({ route: "/items/[id]", expo: { runtimeVersion: "manual" } }, { appVersion: "override", expo: { updateId: "other" } }))
    .toMatchObject({ route: "/items/[id]", appVersion: "override", expo: { updateId: "other", runtimeVersion: "manual" } });
});
it("does not misidentify Expo Go or require expo-updates", () => {
  mocks.constants.executionEnvironment = "storeClient"; mocks.updates = null;
  expect(createReportContext()).toMatchObject({ appVersion: "1.0", buildNumber: undefined, expo: {} });
});
it("rejects unsupported capture platforms", () => { mocks.platform.OS = "web"; expect(() => createReportContext()).toThrow(/iOS and Android/); });
