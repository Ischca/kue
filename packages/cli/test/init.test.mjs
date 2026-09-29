import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { addKue } from "../src/codemod.mjs";
import { main, normalizeServer, repositoryFromRemote, validateConfig, sdkVersion, defaultServer } from "../src/init.mjs";

async function appFixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-cli-server-test-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { expo: "~57.0.0" }, packageManager: "pnpm@10.33.0" }));
  await writeFile(path.join(cwd, "App.tsx"), "export default () => <View />;");
  return cwd;
}

test("help offers the short command and documents the server override", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  await main(["--help"]);
  const help = log.mock.calls[0].arguments[0];
  assert.match(help, /\n  npx kue-qa init\n/u);
  assert.ok(help.includes(`--server URL             Override KUE Cloud (default: ${defaultServer})`));
});

for (const [name, args, server] of [
  ["production by default", [], "https://kue.ischca.dev"],
  ["an explicit staging server", ["--server", "https://kue-staging.ischca.dev/"], "https://kue-staging.ischca.dev"],
  ["an explicit loopback server", ["--server", "http://127.0.0.1:8787"], "http://127.0.0.1:8787"],
]) {
  test(`authorizes and writes config using ${name}`, async (t) => {
    const cwd = await appFixture();
    const request = t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(init.redirect, "error");
      if (url === `${server}/v1/bootstrap`) {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { repository: "owner/app" });
        return Response.json({ id: "connect_test", pollToken: "a".repeat(43), connectUrl: `${server}/connect/connect_test` });
      }
      assert.equal(url, `${server}/v1/bootstrap/connect_test`);
      assert.equal(init.headers.Authorization, `Bearer ${"a".repeat(43)}`);
      return Response.json({ status: "completed", config: { projectKey: "pk_server_test", apiBaseUrl: server } });
    });
    await main(["init", "--repository", "owner/app", "--no-open", "--skip-install", ...args], cwd);
    assert.equal(request.mock.callCount(), 2);
    const config = await readFile(path.join(cwd, ".kue", "config.js"), "utf8");
    assert.ok(config.includes(`"apiBaseUrl": "${server}"`));
    assert.ok(config.includes("pk_server_test"));
    assert.ok((await readFile(path.join(cwd, "App.tsx"), "utf8")).includes("<KueCapture"));
  });
}

test("rejects invalid explicit servers without falling back to production", async (t) => {
  const cwd = await appFixture();
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  for (const server of ["", "http://example.com", "https://kue.ischca.dev/path"]) {
    await assert.rejects(main(["init", "--server", server, "--repository", "owner/app", "--no-open", "--skip-install"], cwd), /--server must be/u);
  }
  assert.equal(request.mock.callCount(), 0);
  assert.ok(!(await readdir(cwd)).includes(".kue"));
});

test("rejects a cross-origin approval link even with the default server", async (t) => {
  const cwd = await appFixture();
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "connect_test", pollToken: "a".repeat(43), connectUrl: "https://other.test/connect/connect_test" }));
  await assert.rejects(main(["init", "--repository", "owner/app", "--no-open", "--skip-install"], cwd), /invalid setup credentials/u);
  assert.ok(!(await readdir(cwd)).includes(".kue"));
});

test("pins SDK installation to the installed CLI version", async () => {
  const cli = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const sdk = JSON.parse(await readFile(new URL("../../react-native/package.json", import.meta.url), "utf8"));
  assert.equal(sdkVersion, cli.version);
  assert.equal(sdkVersion, sdk.version);
});

test("supports default functions and arrows, preserves directives, null and nested returns", () => {
  for (const declaration of [
    'export default function App() { if (!ready) return null; const render = () => <Text />; return (<View>{render()}</View>); }',
    'const App = () => <View />; export default App;',
    'export default () => <><View /></>;',
    'function App() { return <View />; } export default App;',
  ]) {
    const source = '"use client";\n' + declaration;
    const result = addKue(source, "./.kue/config.js");
    assert.ok(result.startsWith('"use client";'));
    assert.equal((result.match(/<KueCapture/g) ?? []).length, 1);
    assert.equal(addKue(result, "./.kue/config.js"), result);
    assert.equal(ts.createSourceFile("a.tsx", result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
    if (source.includes("return null")) { assert.ok(result.includes("return null")); assert.ok(result.includes("() => <Text />")); }
  }
});
test("rejects ambiguous components without changing source", () => {
  for (const source of ['export default memo(App);', 'export default class App {}', 'export default function App(){return null}', 'import {Kue} from "@kue-qa/react-native"; export default App;', 'export default async function App(){return <View/>}']) {
    assert.throws(() => addKue(source, "./.kue/config.js"));
  }
});
test("validates server, config and GitHub origins", () => {
  assert.equal(normalizeServer("https://kue.test/"), "https://kue.test");
  assert.equal(normalizeServer("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const value of ["http://example.com", "https://user:pass@kue.test", "https://kue.test/path", "javascript:alert(1)"]) assert.throws(() => normalizeServer(value));
  for (const remote of ["git@github.com:owner/repo.git", "https://github.com/owner/repo.git", "ssh://git@github.com/owner/repo.git"]) assert.equal(repositoryFromRemote(remote), "owner/repo");
  assert.equal(repositoryFromRemote("https://evil.test/owner/repo"), undefined);
  assert.throws(() => validateConfig({ apiBaseUrl: "https://kue.test", projectKey: "sk_secret" }));
  assert.throws(() => validateConfig({ projectKey: "pk_test_12345" }));
});
test("initializes and refreshes from config without network; dry-run writes nothing", async (t) => {
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-cli-test-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { expo: "~57.0.0" }, packageManager: "pnpm@10.33.0" }));
  await mkdir(path.join(cwd, "app"));
  const root = path.join(cwd, "app", "_layout.tsx");
  const source = 'export default function Layout() { return <Stack />; }\n';
  await writeFile(root, source);
  await main(["init", "--dry-run"], cwd);
  assert.equal(await readFile(root, "utf8"), source);
  assert.ok(!(await readdir(cwd)).includes(".kue"));
  const config = path.join(cwd, "project.json");
  await writeFile(config, JSON.stringify({ projectKey: "pk_test_12345", apiBaseUrl: "https://kue.test" }));
  await main(["init", "--config", config, "--skip-install"], cwd);
  const first = await readFile(root, "utf8");
  assert.ok(first.includes('"../.kue/config.js"'));
  assert.equal((await readdir(path.join(cwd, ".kue"))).filter((f) => f.startsWith("backup-")).length, 1);
  await main(["init", "--config", config, "--skip-install"], cwd);
  assert.equal(await readFile(root, "utf8"), first);
  assert.ok((await readFile(path.join(cwd, ".kue", "config.js"), "utf8")).includes("pk_test_12345"));
  assert.ok((await readFile(path.join(cwd, ".kue", "config.js"), "utf8")).includes("https://kue.test"));
  assert.equal(request.mock.callCount(), 0);
});

test("does not rewrite an app root symlink", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-cli-link-test-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { expo: "~57.0.0" } }));
  await writeFile(path.join(cwd, "Original.tsx"), "export default () => <View />;");
  await symlink(path.join(cwd, "Original.tsx"), path.join(cwd, "App.tsx"));
  await assert.rejects(main(["init", "--dry-run"], cwd), /symlink/u);
});

test("uses an explicit relative import for a root-level App.tsx", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-cli-root-test-"));
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { expo: "~57.0.0" }, packageManager: "pnpm@10.33.0" }));
  await writeFile(path.join(cwd, "App.tsx"), "export default () => <View />;");
  await writeFile(path.join(cwd, "project.json"), JSON.stringify({ projectKey: "pk_root_test_12345", apiBaseUrl: "https://kue.test" }));
  await main(["init", "--skip-install", "--config", "project.json"], cwd);
  assert.ok((await readFile(path.join(cwd, "App.tsx"), "utf8")).includes('from "./.kue/config.js"'));
});
