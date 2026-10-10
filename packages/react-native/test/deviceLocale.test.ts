import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ os: "ios", languages: undefined as unknown, settingsFail: false }));
vi.mock("react-native", () => ({
  Platform: { get OS() { return mocks.os; } },
  Settings: {
    get: (key: string) => {
      if (mocks.settingsFail) throw new Error("SettingsManager is unavailable");
      return key === "AppleLanguages" ? mocks.languages : undefined;
    },
  },
}));

import { deviceKueLocale } from "../src/deviceLocale";

/** What Hermes reports, which on iOS follows the host app's localizations. */
function runtimeLocale(locale: string) {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => ({ resolvedOptions: () => ({ locale }) }) as unknown as Intl.DateTimeFormat);
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(mocks, { os: "ios", languages: undefined, settingsFail: false });
});

describe("device display language", () => {
  it("reads the preferred languages on iOS even when the app's own locale is English", () => {
    // An app without a Japanese localization reports en-JP through Intl on a Japanese device.
    runtimeLocale("en-JP");
    mocks.languages = ["ja-JP", "en-JP"];
    expect(deviceKueLocale()).toBe("ja");
    mocks.languages = ["fr-FR", "ja-JP"];
    expect(deviceKueLocale()).toBe("ja");
    mocks.languages = ["en-US", "ja-JP"];
    expect(deviceKueLocale()).toBe("en");
  });

  it("falls back to the runtime locale when iOS settings are missing or unreadable", () => {
    runtimeLocale("ja-JP");
    expect(deviceKueLocale()).toBe("ja");
    mocks.settingsFail = true;
    expect(deviceKueLocale()).toBe("ja");
  });

  it("uses the runtime locale on Android, where it follows the device", () => {
    mocks.os = "android";
    mocks.languages = ["en-US"];
    runtimeLocale("ja-JP");
    expect(deviceKueLocale()).toBe("ja");
    runtimeLocale("de-DE");
    expect(deviceKueLocale()).toBe("en");
  });
});
