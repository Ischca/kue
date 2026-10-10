import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: { record: vi.fn(), stop: vi.fn(), cancel: vi.fn(), preview: vi.fn() }, available: true, remove: vi.fn() }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => mocks.available ? mocks.native : null }));
vi.mock("expo-file-system", () => ({ File: class { exists = true; delete() { mocks.remove(); } } }));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.available = true;
  // A reset module registry has no display language yet; these checks read the Japanese text.
  (await import("../src/i18n")).setKueLocale("ja");
  mocks.native.stop.mockResolvedValue(undefined); mocks.native.cancel.mockResolvedValue(undefined); mocks.native.preview.mockResolvedValue(undefined);
});
it("loads safely without the native module on Free/Expo Go and never invokes native permission", async () => {
  mocks.available = false;
  const api = await import("../src/recording"); expect(api.nativeRecordingAvailable()).toBe(false);
  await expect(api.recordScreen()).rejects.toThrow("再ビルド");
  await api.cancelRecording(); await api.stopRecording(); expect(mocks.native.record).not.toHaveBeenCalled();
});
it("keeps platform recording results, stop, cancel and preview outside Cloud code", async () => {
  const api = await import("../src/recording"); const result = { uri: "file:///cache/kue-recordings/test.mp4" };
  mocks.native.record.mockResolvedValue(result);
  expect(await api.recordScreen()).toBe(result);
  await api.stopRecording(); await api.cancelRecording(); await api.previewRecording(result.uri);
  expect(mocks.native.stop).toHaveBeenCalledOnce(); expect(mocks.native.cancel).toHaveBeenCalledOnce();
  expect(mocks.native.preview).toHaveBeenCalledWith(result.uri);
});
it("only releases recorder-owned files, never unrelated images or encoded traversal", async () => {
  const api = await import("../src/recording");
  for (const uri of ["file:///documents/user.mp4", "https://example.test/kue-recordings/test.mp4", "file:///cache/kue-recordings/%2e%2e%2fdata.mp4"]) api.releaseRecording(uri);
  expect(mocks.remove).not.toHaveBeenCalled();
  api.releaseRecording("file:///cache/kue-recordings/test.mp4"); expect(mocks.remove).toHaveBeenCalledOnce();
});
