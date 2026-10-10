import { describe, expect, it } from "vitest";
import { kueText } from "../src/i18n";
import { recordingAvailability } from "../src/recordingAvailability";

const recordingMessages = kueText("ja").recording.messages;

const base = { hasCloud: true, features: null, failed: false, nativeAvailable: false };
const features = (entitled: boolean, available = true) => ({ groups: true, recording: { entitled, available } });
describe("recording availability", () => {
  it("defaults to auto and distinguishes verification failures from Free", () => {
    expect(recordingAvailability(base)).toBe("checking");
    expect(recordingAvailability({ ...base, failed: true })).toBe("check_failed");
    expect(recordingAvailability({ ...base, hasCloud: false })).toBe("cloud_required");
    expect(recordingAvailability({ ...base, features: features(false) })).toBe("upgrade");
  });
  it("off takes precedence over Cloud, plan, native module and availability", () => {
    for (const entitled of [true, false]) {
      expect(recordingAvailability({ ...base, mode: "off", features: features(entitled), nativeAvailable: true })).toBe("off");
    }
    expect(recordingAvailability({ ...base, mode: "off", hasCloud: false })).toBe("off");
  });
  it("keeps Free locked even if an older paid build still has the native module", () => {
    expect(recordingAvailability({ ...base, features: features(false), nativeAvailable: true })).toBe("upgrade");
  });
  it("requires both server availability and a native module", () => {
    expect(recordingAvailability({ ...base, features: features(true, false), nativeAvailable: true })).toBe("unavailable");
    expect(recordingAvailability({ ...base, features: features(true) })).toBe("rebuild");
    expect(recordingAvailability({ ...base, features: features(true), nativeAvailable: true })).toBe("ready");
  });
  it("rebuild and service messages describe the next action without paid-plan commentary", () => {
    expect(recordingMessages.rebuild).toContain("再ビルド");
    expect(recordingMessages.rebuild).not.toMatch(/Indie|有料|プラン/);
    expect(recordingMessages.unavailable).not.toMatch(/Indie|プランを確認/);
  });
});
