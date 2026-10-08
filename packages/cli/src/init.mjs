import { readFile, writeFile, mkdir, rename, access, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { addKue, marker } from "./codemod.mjs";
import { resolveAppDirectory } from "./app-directory.mjs";
import { readOptional, parseManagedConfig, parseSetupState, configFingerprint } from "./setup-state.mjs";
import { dependencyPlan, tarballIdentity, installedPackage } from "./dependencies.mjs";

// SDK and CLI are released together. Resolve from this installed CLI, never the consumer.
export const sdkVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
export const defaultServer = "https://kue.ischca.dev";
const help = `KUE setup (Node 22+, Expo SDK 54–57)

  npx kue-qa init
  npx kue-qa init --config /path/to/project.json
  npx kue-qa check          Verify Cloud admission before building/distributing

Options:
  --app DIRECTORY          Select an Expo package inside the current directory
  --server URL             Override KUE Cloud (default: ${defaultServer})
  --repository owner/repo   Override GitHub origin detection
  --reconnect             Explicitly reauthorize or change the Cloud connection
  --root app/_layout.tsx    Override Expo Router / App.tsx detection
  --dry-run                Inspect the planned edit; no network or writes
  --skip-install           Leave dependency installation to you
  --no-open                Print the consent URL without opening a browser
  --sdk /path/to/sdk.tgz    Use a local package tarball before npm publication

Run inside an Expo package or a workspace root with one Expo app.
Multiple apps require --app. --root is relative to the selected app;
--config and --sdk are relative to the directory where you run this command.
KUE is enabled only in development by default.
An unchanged managed setup is a no-op. Use --reconnect for fresh consent.
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
    if (directory !== cwd) {
      const ancestor = await readFile(path.join(directory, "package.json"), "utf8").catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const inherited = ancestor && JSON.parse(ancestor).packageManager?.split("@")[0];
      if (["pnpm", "npm", "yarn", "bun"].includes(inherited)) return inherited;
    }
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
async function install(cwd, pm, sdk, plan) {
  if (plan.installSdk) run(pm, [pm === "npm" ? "install" : "add", sdk], cwd);
  const args = pm === "npm" ? ["exec", "--", "expo"] : pm === "bun" ? ["x", "--no-install", "expo"] : ["exec", "expo"];
  if (plan.native.length) run(pm, [...args, "install", ...plan.native], cwd);
}
export async function main(argv, cwd = process.cwd()) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, server: { type: "string" }, config: { type: "string" }, repository: { type: "string" }, root: { type: "string" }, sdk: { type: "string" }, app: { type: "string" },
    "dry-run": { type: "boolean" }, "skip-install": { type: "boolean" }, "no-open": { type: "boolean" }, reconnect: { type: "boolean" },
  } });
  if (values.help || !positionals.length) { console.log(help); return; }
  if (positionals.length !== 1 || positionals[0] !== "init") throw new Error("Unknown command. Run kue-qa --help.");
  if (values.config && (values.reconnect || values.repository !== undefined || values.server !== undefined)) throw new Error("--config cannot be combined with --reconnect, --repository, or --server.");
  if (values.server !== undefined) normalizeServer(values.server);
  if (values.repository !== undefined && !/^[\w-]+\/[\w.-]+$/u.test(values.repository)) throw new Error("--repository must be owner/repo.");
  const invocationCwd = path.resolve(cwd);
  const selected = await resolveAppDirectory(invocationCwd, values.app);
  cwd = selected.directory;
  const manifest = selected.manifest;
  console.log(`Expo app: ${JSON.stringify(path.relative(await realpath(invocationCwd), cwd) || ".")}`);
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
  const stateFile = path.join(cwd, ".kue", "setup.json");
  const typesFile = configFile.slice(0, -3) + ".d.ts";
  const localIgnore = path.join(cwd, ".kue", ".gitignore");
  for (const target of [path.dirname(configFile), configFile, typesFile, localIgnore, stateFile]) {
    const stat = await lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) throw new Error("KUE configuration must not use symlinks; no source was changed.");
  }
  let configImport = path.relative(path.dirname(root), configFile).split(path.sep).join("/");
  if (!configImport.startsWith("./") && !configImport.startsWith("../")) configImport = `./${configImport}`;
  const next = addKue(source, configImport);
  const pm = await manager(cwd, manifest);
  console.log(`App root: ${roots[0]}\nPackage manager: ${pm}\n${next === source ? "KUE integration already present; checking for required changes." : "Will add Kue beside the default component's JSX returns; null/loading returns are preserved."}`);
  const before = new Map(await Promise.all([configFile, stateFile, typesFile, localIgnore, path.join(cwd, "package.json")].map(async file => [file, await readOptional(file)])));
  const existing = before.get(configFile) === null ? null : parseManagedConfig(before.get(configFile), validateConfig);
  const state = parseSetupState(before.get(stateFile), existing);
  const typesText = `${marker}\nexport declare const kueCloudConfig: { projectKey: string; apiBaseUrl: string };\n`;
  if (before.get(typesFile) !== null && before.get(typesFile) !== typesText) throw new Error(".kue/config.d.ts was customized. Restore the generated declaration; it will not be overwritten.");
  if (next === source && !existing && !values.config && !values.reconnect) throw new Error("Managed app root has no .kue/config.js. Restore the file, supply --config, or explicitly --reconnect; init will not reset the connection.");
  let config = values.config ? validateConfig(JSON.parse(await readFile(path.resolve(invocationCwd, values.config), "utf8"))) : existing;
  if (existing && !values.reconnect && !values.config) {
    if (values.server !== undefined && normalizeServer(values.server) !== existing.apiBaseUrl) throw new Error("Changing the server requires --reconnect; the existing connection was preserved.");
    if (values.repository !== undefined && values.repository.toLowerCase() !== state.connection?.repository.toLowerCase()) throw new Error("The requested repository differs from the saved connection, or old metadata cannot identify it. Use --reconnect --repository owner/repo explicitly.");
  }
  const needsAuthorization = !values.config && (!existing || values.reconnect);
  const sdk = values.sdk ? path.resolve(invocationCwd, values.sdk) : `@kue-qa/react-native@${sdkVersion}`;
  const tarball = values.sdk ? { filename: sdk, sha256: await tarballIdentity(sdk) } : null;
  let plan = { installSdk: false, native: [] };
  if (!values["skip-install"]) {
    // A dry run is also usable before node_modules is restored; it must never
    // invoke a package manager merely to inspect the application.
    try { plan = await dependencyPlan(cwd, manifest, sdkVersion, tarball, state); }
    catch (error) { if (!values["dry-run"]) throw error; console.log(`Dependency check: ${error.message}`); }
  }
  console.log(`Connection: ${needsAuthorization ? "browser approval required" : "reuse local configuration; no browser approval"}.`);
  if (plan.installSdk) console.log(`SDK: install ${sdk}.`);
  if (plan.native.length) console.log(`Missing native dependencies: ${plan.native.join(", ")}.`);
  if (values["dry-run"]) { console.log("Dry run: no files, dependencies, or remote state were changed."); return; }
  if (needsAuthorization) {
    const server = normalizeServer(values.server ?? existing?.apiBaseUrl ?? defaultServer);
    const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
    const repository = values.repository ?? state.connection?.repository ?? repositoryFromRemote(remote.stdout ?? "");
    if (!repository || !/^[\w-]+\/[\w.-]+$/u.test(repository)) throw new Error("No GitHub origin found. Specify --repository owner/repo.");
    config = await authorize(server, repository, values["no-open"]);
    state.connection = { repository, configHash: configFingerprint(config) };
  } else if (state.connection?.configHash !== configFingerprint(config)) delete state.connection;
  const assertUnchanged = async (includeManifest) => {
    if (await readFile(root, "utf8") !== source) throw new Error("The app root changed during setup. Rerun init; your changes were preserved.");
    for (const [file, text] of before) {
      if (!includeManifest && file === path.join(cwd, "package.json")) continue;
      if (await readOptional(file) !== text) throw new Error(`${path.relative(cwd, file)} changed during setup. Rerun init; your changes were preserved.`);
    }
  };
  await assertUnchanged(true);
  const installing = plan.installSdk || plan.native.length > 0;
  if (installing) {
    await install(cwd, pm, sdk, plan);
    if (tarball && plan.installSdk) {
      const found = await installedPackage(cwd, "@kue-qa/react-native");
      if (!found) throw new Error("The SDK installation did not complete. Restore dependencies before rerunning init.");
      state.sdkTarball = { sha256: tarball.sha256, version: found.manifest.version };
    } else if (!tarball && plan.installSdk) delete state.sdkTarball;
    const remaining = await dependencyPlan(cwd, JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")), sdkVersion, tarball, state);
    if (remaining.installSdk || remaining.native.length) throw new Error("Dependencies are still incomplete after installation. Review the package-manager output; your app root has not been changed.");
  }
  await assertUnchanged(false);
  const configText = existing && configFingerprint(existing) === configFingerprint(config) ? before.get(configFile)
    : `${marker}\n// Public create-only key. Never put GitHub or Stripe secrets here.\nexport const kueCloudConfig = ${JSON.stringify(config, null, 2)};\n`;
  const writes = [[configFile, configText], [typesFile, typesText]];
  if (before.get(localIgnore) === null) writes.push([localIgnore, "backup-*.txt\n"]);
  if (before.get(stateFile) !== null || state.connection || state.sdkTarball) writes.push([stateFile, JSON.stringify(state, null, 2) + "\n"]);
  const changed = writes.filter(([file, text]) => before.get(file) !== text);
  if (!changed.length && next === source && !installing) {
    console.log(`KUE already configured. No files or dependencies changed.${values["skip-install"] ? " Dependency installation was skipped." : ""}`);
    return;
  }
  await mkdir(path.dirname(configFile), { recursive: true });
  if (next !== source) {
    const backup = path.join(cwd, ".kue", `backup-${Date.now()}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}.txt`);
    await writeFile(backup, source, { flag: "wx", mode: 0o600 });
    console.log(`Original root saved to ${path.relative(cwd, backup)} (keep local; do not commit backups).`);
  }
  for (const [file, text] of changed) await writeFile(file, text);
  if (next !== source) {
    const temporary = `${root}.kue-${process.pid}.tmp`;
    await writeFile(temporary, next, { flag: "wx" });
    await rename(temporary, root);
  }
  console.log(`KUE configured. Review your diff, then run ${pm === "npm" ? "npx" : `${pm} exec`} expo start.\nCommit the app changes and .kue/config.js + .d.ts (public create-only key). Never commit backups.\n${values["skip-install"] ? `Dependencies were NOT installed. Install ${sdk} and its Expo native peers first.\n` : ""}View submitted reports and GitHub Issues in the KUE dashboard.`);
}
