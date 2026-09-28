import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { addKue } from "../src/codemod.mjs";
import { main, normalizeServer, repositoryFromRemote, validateConfig, sdkVersion } from "../src/init.mjs";

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
});
test("initializes and refreshes a real fixture without yalc; dry-run writes nothing", async () => {
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
