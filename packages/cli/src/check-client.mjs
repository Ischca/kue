// Dependency-free build hook client. Keep credentials and provider bodies out of
// errors: build systems often publish their complete stdout/stderr as artifacts.
export class KueCheckError extends Error {
  constructor(code, message) { super(message); this.name = "KueCheckError"; this.code = code; }
}
const invalid = () => new KueCheckError("invalid_config", "Set the same HTTPS apiBaseUrl and public projectKey that will be embedded in the app.");

export function validateCheckConfig(config) {
  if (!config || typeof config.apiBaseUrl !== "string" || typeof config.projectKey !== "string") throw invalid();
  let url;
  try { url = new URL(config.apiBaseUrl.trim()); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !/^pk_[A-Za-z0-9_-]{8,128}$/u.test(config.projectKey.trim())) throw invalid();
  return { apiBaseUrl: url.origin, projectKey: config.projectKey.trim() };
}

// Explicit env mode never loads dotenv or falls back to a managed config. The
// host build must resolve its environment first, using its own Expo/EAS rules.
export function cloudConfigFromEnvironment(env) {
  if (env.EXPO_PUBLIC_KUE_ENABLED === "false") return null;
  if (env.EXPO_PUBLIC_KUE_ENABLED !== undefined && env.EXPO_PUBLIC_KUE_ENABLED !== "true") throw invalid();
  const mode = env.EXPO_PUBLIC_KUE_MODE?.trim();
  if (mode === "local") return null;
  if (mode !== "cloud") throw new KueCheckError("invalid_config", "Set EXPO_PUBLIC_KUE_MODE explicitly to cloud or local; missing configuration cannot pass a build check.");
  return validateCheckConfig({ apiBaseUrl: env.EXPO_PUBLIC_KUE_API_BASE_URL, projectKey: env.EXPO_PUBLIC_KUE_PROJECT_KEY });
}

const remedies = {
  unauthorized: "The project key is invalid or revoked, or belongs to another server. Reconnect in the dashboard and update the app's build configuration.",
  project_plan_paused: "The key is valid, but this project is not the active Free destination. Sign in to the dashboard to check the selected repository, switching restrictions and billing status. Use Indie for multiple repositories; do not rotate the key to switch projects.",
  storage_quota_exceeded: "Image storage is full. Free storage or upgrade the workspace before distributing this build.",
  quota_exceeded: "The monthly report quota is exhausted. Wait for the quota reset or upgrade the workspace.",
  project_not_configured: "The project has no Issue destination. Reconnect it in the dashboard.",
  delivery_disabled: "Cloud Issue delivery is disabled. Contact the Cloud operator.",
  configuration_error: "Cloud delivery configuration is incomplete. Contact the Cloud operator.",
  rate_limited: "The check was rate limited. Wait before retrying; this build is not verified.",
};

async function boundedJson(response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) return null;
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function checkCloudConfig(config, { request = fetch, timeoutMs = 10_000 } = {}) {
  const normalized = validateCheckConfig(config);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw invalid();
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new KueCheckError("unverified", "Cloud verification timed out. Retry when the server is reachable; this build is not verified."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let response;
      try {
        response = await request(`${normalized.apiBaseUrl}/v1/project/check`, {
          method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${normalized.projectKey}`, Accept: "application/json" },
        });
      } catch { throw new KueCheckError("unverified", "Cloud verification failed. Check network access and server availability; this build is not verified."); }
      const body = await boundedJson(response);
      if (response.status === 200 && body?.schemaVersion === 1 && body.status === "ready") return { status: "ready" };
      const code = body?.error?.code;
      if (response.status !== 200 && typeof code === "string" && Object.hasOwn(remedies, code)) throw new KueCheckError(code, remedies[code]);
      if (response.status === 401) throw new KueCheckError("unauthorized", remedies.unauthorized);
      if (response.status === 404 || response.status === 405) throw new KueCheckError("unsupported_server", "This server does not support build verification. Check the server URL or update Cloud; this build is not verified.");
      throw new KueCheckError("unverified", "Cloud did not confirm readiness. Check service availability and retry; this build is not verified.");
    })()]);
  } finally { clearTimeout(timer); }
}
