import { createHash } from "node:crypto";
import { boundedJson } from "./check-client.mjs";

// The SDK's native module is reserved for recording. Excluding it must not
// exclude the separate Expo peers used by screenshots and grouped findings.
export const recordingNativePackage = "@kue-qa/react-native";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export function recordingMode(manifest, override) {
  if (manifest.kue !== undefined && !object(manifest.kue)) throw new Error("package.json kue must be an object.");
  const mode = override !== undefined ? override : manifest.kue?.recording !== undefined ? manifest.kue.recording : "auto";
  if (mode !== "auto" && mode !== "off") throw new Error("Recording must be auto or off. Use --recording auto|off or package.json kue.recording.");
  return mode;
}

// This snapshot is build configuration, never an entitlement or a credential.
export const recordingConfigHash = config => createHash("sha256").update(JSON.stringify({ apiBaseUrl: config.apiBaseUrl, projectKey: config.projectKey })).digest("hex");

export async function resolveRecording(config, mode, { request = fetch, timeoutMs = 10_000 } = {}) {
  if (mode !== "auto" && mode !== "off") throw new Error("Invalid recording mode.");
  if (mode === "off") return { mode, nativeEnabled: false, configHash: recordingConfigHash(config) };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid recording timeout.");
  // The caller has validated/normalized the exact same Cloud connection used
  // by the SDK. Do not follow redirects carrying a project key.
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Recording plan verification timed out. No recording settings were changed.")); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let response;
      try {
        response = await request(`${config.apiBaseUrl}/v1/project/features`, {
          method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${config.projectKey}`, Accept: "application/json" },
        });
      } catch { throw new Error("Could not verify the recording plan. Retry when Cloud is reachable; existing settings were preserved."); }
      const body = await boundedJson(response);
      if (response.status === 200 && body?.schemaVersion === 1 && typeof body.recording?.entitled === "boolean" &&
          typeof body.recording.available === "boolean") {
        return { mode, nativeEnabled: body.recording.entitled, configHash: recordingConfigHash(config) };
      }
      if (response.status === 401) throw new Error("Recording plan verification rejected the project key. Check the Cloud connection; existing settings were preserved.");
      if (response.status === 404 || response.status === 405) throw new Error("Cloud does not support recording setup. Update Cloud, or explicitly use --recording off; existing settings were preserved.");
      throw new Error("Cloud did not confirm the recording plan. Retry after resolving the connection; existing settings were preserved.");
    })()]);
  } finally { clearTimeout(timer); }
}

/** Pure and deterministic: leave unrelated config/order intact, including platform overrides. */
export function recordingManifest(manifest, resolution, override) {
  const next = structuredClone(manifest);
  recordingMode(next, override);
  if (override !== undefined) { next.kue ??= {}; next.kue.recording = override; }
  const ensureObject = (parent, key) => {
    if (parent[key] !== undefined && !object(parent[key])) throw new Error(`Invalid package.json Expo autolinking configuration (${key}). No source was changed.`);
    return parent[key] ??= {};
  };
  const linking = ensureObject(ensureObject(next, "expo"), "autolinking");
  const update = config => {
    if (config.exclude !== undefined && (!Array.isArray(config.exclude) || config.exclude.some(name => typeof name !== "string"))) {
      throw new Error("expo.autolinking.exclude must be an array of package names. No source was changed.");
    }
    if (resolution.nativeEnabled) {
      if (config.exclude?.includes(recordingNativePackage)) config.exclude = config.exclude.filter(name => name !== recordingNativePackage);
    } else if (!config.exclude?.includes(recordingNativePackage)) config.exclude = [...(config.exclude ?? []), recordingNativePackage];
  };
  update(linking);
  // Platform options can override rather than merge the root exclude list.
  for (const platform of ["ios", "apple", "android"]) {
    if (linking[platform] !== undefined) {
      const config = ensureObject(linking, platform);
      // An absent list inherits the root. Creating a platform-only list here
      // could accidentally stop excluding unrelated modules on older Expo SDKs.
      if (config.exclude !== undefined) update(config);
    }
  }
  return next;
}

export function formatManifest(before, next) {
  if (JSON.stringify(JSON.parse(before)) === JSON.stringify(next)) return before;
  const indent = /\n([\t ]+)"/u.exec(before)?.[1] ?? "  ";
  const newline = before.includes("\r\n") ? "\r\n" : "\n";
  return JSON.stringify(next, null, indent).replace(/\n/gu, newline) + newline;
}

/** A read-only pre-build guard. CLI init is the only place that changes selection. */
export async function checkRecordingSelection(manifest, snapshot, config, options) {
  if (!snapshot) return; // Older setups have no recording configuration to verify.
  const mode = recordingMode(manifest);
  const expected = await resolveRecording(config, mode, options);
  if (expected.mode !== snapshot.mode || expected.nativeEnabled !== snapshot.nativeEnabled || expected.configHash !== snapshot.configHash) {
    throw new Error("Recording build settings are out of date. Run kue-qa init, review the changes, and rebuild the app. No files were changed.");
  }
  if (JSON.stringify(recordingManifest(manifest, expected)) !== JSON.stringify(manifest)) {
    throw new Error("Recording native inclusion does not match the saved configuration. Run kue-qa init and rebuild; no files were changed.");
  }
}
