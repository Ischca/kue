import { readFile, writeFile, mkdir, rename, access, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { addKue, marker } from "./codemod.mjs";

// SDK and CLI are released together. Resolve from this installed CLI, never the consumer.
export const sdkVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
export const defaultServer = "https://kue.ischca.dev";
const help = `KUE setup (Node 22+, Expo SDK 54–57)

  npx kue-qa init
  npx kue-qa init --config /path/to/project.json

Options:
  --server URL             Override KUE Cloud (default: ${defaultServer})
  --repository owner/repo   Override GitHub origin detection
  --root app/_layout.tsx    Override Expo Router / App.tsx detection
  --dry-run                Inspect the planned edit; no network or writes
  --skip-install           Leave dependency installation to you
  --no-open                Print the consent URL without opening a browser
  --sdk /path/to/sdk.tgz    Use a local package tarball before npm publication

Run inside the target Expo package. KUE is enabled only in development by default.
Review the diff before running the app. No GitHub issue is created by init.`;

async function exists(file) { try { await access(file); return true; } catch { return false; } }
export function normalizeServer(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("--server must be an absolute HTTPS origin."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("--server must be an HTTPS origin without credentials, a path, query, or hash (HTTP loopback is allowed for development).");
  }
  return url.origin;
}
export function repositoryFromRemote(remote) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/u.exec(remote.trim())?.[1];
}
export function validateConfig(value) {
  if (!value || typeof value !== "object" || !/^pk_[A-Za-z0-9_-]{8,128}$/u.test(value.projectKey ?? "")) throw new Error("Configuration must contain a valid public projectKey.");
  return { projectKey: value.projectKey, apiBaseUrl: normalizeServer(value.apiBaseUrl) };
}
async function api(url, init = {}) {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Setup request failed (${response.status}, ${body.error?.code ?? "unknown"}). Run init again after resolving the problem.`);
  }
  return response.json();
}
async function authorize(server, repository, noOpen) {
  const session = await api(`${server}/v1/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository }) });
  const link = new URL(session.connectUrl);
  if (link.origin !== server || !/^connect_[\w-]+$/u.test(session.id) || !/^[\w-]{43}$/u.test(session.pollToken)) throw new Error("Server returned invalid setup credentials.");
  console.log(`Authorize this project in your browser:\n${link}\nOnly approve a setup you just started. This link expires in 15 minutes.`);
  if (!noOpen) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const child = spawn(command, [link.toString()], { stdio: "ignore", detached: true });
    child.on("error", () => console.log("Open the URL above manually."));
    child.unref();
  }
  const end = Date.now() + 900_000;
  while (Date.now() < end) {
    await delay(5000);
    const result = await api(`${server}/v1/bootstrap/${session.id}`, { headers: { Authorization: `Bearer ${session.pollToken}` } });
    if (result.status === "completed") {
      const config = validateConfig(result.config);
      if (config.apiBaseUrl !== server) throw new Error("Setup returned a different server origin.");
      return config;
    }
    if (result.status !== "pending") throw new Error("Setup was not approved. Run init again.");
  }
  throw new Error("Setup expired. Run init again.");
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Resolve the dependency error and rerun init; your app root has not been changed.`);
}
async function manager(cwd, manifest) {
  const declared = manifest.packageManager?.split("@")[0];
  if (["pnpm", "npm", "yarn", "bun"].includes(declared)) return declared;
  let directory = cwd;
  while (true) {
    const found = [];
    for (const [lock, pm] of [["pnpm-lock.yaml", "pnpm"], ["package-lock.json", "npm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"]]) {
      if (await exists(path.join(directory, lock))) found.push(pm);
    }
    if (new Set(found).size > 1) throw new Error("Multiple package-manager lockfiles found. Set packageManager in package.json first.");
    if (found.length) return found[0];
    const parent = path.dirname(directory);
    if (parent === directory) return "npm";
    directory = parent;
  }
}
async function install(cwd, pm, sdk) {
  run(pm, [pm === "npm" ? "install" : "add", sdk], cwd);
  const args = pm === "npm" ? ["exec", "--", "expo"] : pm === "bun" ? ["x", "--no-install", "expo"] : ["exec", "expo"];
  run(pm, [...args, "install", "expo-application", "expo-constants", "expo-device", "expo-file-system", "expo-image-manipulator", "react-native-view-shot", "react-native-safe-area-context"], cwd);
}
export async function main(argv, cwd = process.cwd()) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, server: { type: "string" }, config: { type: "string" }, repository: { type: "string" }, root: { type: "string" }, sdk: { type: "string" },
    "dry-run": { type: "boolean" }, "skip-install": { type: "boolean" }, "no-open": { type: "boolean" },
  } });
  if (values.help || !positionals.length) { console.log(help); return; }
  if (positionals.length !== 1 || positionals[0] !== "init") throw new Error("Unknown command. Run kue-qa --help.");
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  if (!manifest.dependencies?.expo && !manifest.devDependencies?.expo) throw new Error("Run init in the Expo app package (not the monorepo root).");
  const candidates = values.root ? [values.root] : ["app/_layout.tsx", "src/app/_layout.tsx", "App.tsx", "App.jsx", "App.js", "src/App.tsx"];
  const roots = [];
  for (const candidate of candidates) if (await exists(path.resolve(cwd, candidate))) roots.push(candidate);
  if (roots.length !== 1) throw new Error("Could not choose one app root. Specify --root path/to/root.tsx.");
  const root = path.resolve(cwd, roots[0]);
  if (path.relative(cwd, root).startsWith("..") || !/\.[jt]sx?$/u.test(root)) throw new Error("The app root must be a JS/TS file inside the Expo package.");
  const actualCwd = await realpath(cwd);
  if ((await lstat(root)).isSymbolicLink() || path.relative(actualCwd, await realpath(root)).startsWith("..")) throw new Error("The app root cannot be a symlink or point outside the Expo package.");
  const source = await readFile(root, "utf8");
  const configFile = path.join(cwd, ".kue", "config.js");
  for (const target of [path.dirname(configFile), configFile, configFile.slice(0, -3) + ".d.ts", path.join(cwd, ".kue", ".gitignore")]) {
    const stat = await lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error("KUE configuration must not use symlinks; no source was changed.");
  }
  let configImport = path.relative(path.dirname(root), configFile).split(path.sep).join("/");
  if (!configImport.startsWith("./") && !configImport.startsWith("../")) configImport = `./${configImport}`;
  const next = addKue(source, configImport);
  const pm = await manager(cwd, manifest);
  console.log(`App root: ${roots[0]}\nPackage manager: ${pm}\n${next === source ? "KUE integration already present; configuration will be refreshed." : "Will add Kue beside the default component's JSX returns; null/loading returns are preserved."}`);
  if (values["dry-run"]) { console.log("Dry run: no files, dependencies, or remote state were changed."); return; }
  let config;
  if (values.config) config = validateConfig(JSON.parse(await readFile(path.resolve(cwd, values.config), "utf8")));
  else {
    const server = normalizeServer(values.server ?? defaultServer);
    const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
    const repository = values.repository ?? repositoryFromRemote(remote.stdout ?? "");
    if (!repository || !/^[\w-]+\/[\w.-]+$/u.test(repository)) throw new Error("No GitHub origin found. Specify --repository owner/repo.");
    config = await authorize(server, repository, values["no-open"]);
  }
  // Avoid silently overwriting user-maintained configuration.
  if (await exists(configFile)) {
    const existing = await readFile(configFile, "utf8");
    if (!existing.startsWith(marker)) throw new Error(".kue/config.js is not managed by KUE; move it or configure Kue manually.");
  }
  const sdk = values.sdk ? path.resolve(cwd, values.sdk) : `@kue-qa/react-native@${sdkVersion}`;
  if (!values["skip-install"]) await install(cwd, pm, sdk);
  if (await readFile(root, "utf8") !== source) throw new Error("The app root changed during setup. Rerun init; your changes were preserved.");
  await mkdir(path.dirname(configFile), { recursive: true });
  if (next !== source) {
    const backup = path.join(cwd, ".kue", `backup-${Date.now()}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}.txt`);
    await writeFile(backup, source, { flag: "wx", mode: 0o600 });
    console.log(`Original root saved to ${path.relative(cwd, backup)} (keep local; do not commit backups).`);
  }
  const configText = `${marker}\n// Public create-only key. Never put GitHub or Stripe secrets here.\nexport const kueCloudConfig = ${JSON.stringify(config, null, 2)};\n`;
  await writeFile(configFile, configText);
  await writeFile(`${configFile.slice(0, -3)}.d.ts`, `${marker}\nexport declare const kueCloudConfig: { projectKey: string; apiBaseUrl: string };\n`);
  const localIgnore = path.join(cwd, ".kue", ".gitignore");
  if (!await exists(localIgnore)) await writeFile(localIgnore, "backup-*.txt\n", { flag: "wx" });
  if (next !== source) {
    const temporary = `${root}.kue-${process.pid}.tmp`;
    await writeFile(temporary, next, { flag: "wx" });
    await rename(temporary, root);
  }
  console.log(`KUE configured. Review your diff, then run ${pm === "npm" ? "npx" : `${pm} exec`} expo start.\nCommit the app changes and .kue/config.js + .d.ts (public create-only key). Never commit backups.\n${values["skip-install"] ? `Dependencies were NOT installed. Install ${sdk} and its Expo native peers first.\n` : ""}View submitted reports and GitHub Issues in the KUE dashboard.`);
}
