import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAppDirectory } from "../src/app-directory.mjs";
import { main } from "../src/init.mjs";
import { packageFixture, fakeManager } from "./fixtures.mjs";

async function fixture(manifest = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kue-workspace-test-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  return realpath(root);
}
async function app(root, relative, manifest = { dependencies: { expo: "~57.0.0" } }) {
  const directory = path.join(root, relative);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(directory, "App.tsx"), "export default () => <View />;");
  return directory;
}
const config = { projectKey: "pk_workspace_test", apiBaseUrl: "https://kue.test" };

test("keeps the current Expo package even when it also declares workspaces", async () => {
  const root = await fixture({ devDependencies: { expo: "~57.0.0" }, workspaces: ["apps/*"] });
  await app(root, "apps/other");
  assert.equal((await resolveAppDirectory(root)).directory, root);
});

test("detects one pnpm app and honors exclusions instead of searching undeclared examples", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n  - "!apps/demo"\n# Other settings are not package patterns.\nnodeLinker: hoisted\n');
  const mobile = await app(root, "apps/mobile");
  await app(root, "apps/demo");
  await app(root, "examples/preview");
  await app(root, "apps/web", { dependencies: { react: "19" } });
  assert.equal((await resolveAppDirectory(root)).directory, mobile);
});

for (const workspaces of [["apps/*"], { packages: ["apps/*"] }]) {
  test(`supports package.json workspaces ${Array.isArray(workspaces) ? "array" : "object"}`, async () => {
    const root = await fixture({ workspaces });
    const mobile = await app(root, "apps/mobile");
    assert.equal((await resolveAppDirectory(root)).directory, mobile);
  });
}

test("supports brace, globstar and inline YAML patterns with pnpm precedence", async () => {
  const root = await fixture({ workspaces: ["examples/*"] });
  await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages: ["./{apps,packages}/**/", "!apps/demo/**"]\n');
  const mobile = await app(root, "packages/nested/mobile");
  await app(root, "apps/demo/mobile");
  await app(root, "examples/preview");
  assert.equal((await resolveAppDirectory(root)).directory, mobile);
});

test("ignores hidden, dependency, native/build directories and directory links", async () => {
  const root = await fixture({ workspaces: ["**"] });
  const mobile = await app(root, "apps/mobile");
  for (const name of ["node_modules", ".cache", "dist", "build", "coverage", "vendor", "ios", "android"]) await app(root, `${name}/preview`);
  const outside = await fixture({ dependencies: { expo: "57" } });
  await symlink(outside, path.join(root, "outside"));
  await symlink(mobile, path.join(root, "alias"));
  assert.equal((await resolveAppDirectory(root)).directory, mobile);
});

test("multiple apps list deterministic choices and do not mutate or authorize", async (t) => {
  const root = await fixture({ workspaces: ["apps/*"] });
  await app(root, "apps/second");
  await app(root, "apps/first");
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  await assert.rejects(main(["init"], root), /Multiple Expo apps found:\n  "apps\/first"\n  "apps\/second"[\s\S]*--app/u);
  assert.equal(request.mock.callCount(), 0);
  for (const directory of [root, path.join(root, "apps/first"), path.join(root, "apps/second")]) assert.ok(!(await readdir(directory)).includes(".kue"));
});

test("explicit app selects one and keeps config paths relative to invocation, root paths relative to app", async (t) => {
  const root = await fixture({ workspaces: ["apps/*"], packageManager: "pnpm@10.33.0" });
  const selected = await app(root, "apps/selected");
  const other = await app(root, "apps/other");
  await mkdir(path.join(selected, "src"));
  await writeFile(path.join(selected, "src/Entry.tsx"), "export default () => <View />;");
  await writeFile(path.join(root, "project.json"), JSON.stringify(config));
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  await main(["init", "--app", "apps/selected", "--root", "src/Entry.tsx", "--config", "project.json", "--skip-install"], root);
  assert.ok((await readFile(path.join(selected, "src/Entry.tsx"), "utf8")).includes('from "../.kue/config.js"'));
  assert.ok((await readFile(path.join(selected, ".kue/config.js"), "utf8")).includes(config.projectKey));
  assert.equal(await readFile(path.join(selected, "App.tsx"), "utf8"), "export default () => <View />;");
  assert.equal(await readFile(path.join(other, "App.tsx"), "utf8"), "export default () => <View />;");
  assert.ok(!(await readdir(root)).includes(".kue"));
  assert.ok(!(await readdir(other)).includes(".kue"));
});

test("root invocation dry-run inherits the workspace manager without a lockfile and writes nothing", async (t) => {
  const root = await fixture({ workspaces: ["apps/*"], packageManager: "pnpm@11.2.1" });
  const mobile = await app(root, "apps/mobile");
  const log = t.mock.method(console, "log", () => {});
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  await main(["init", "--dry-run"], root);
  const output = log.mock.calls.map(call => call.arguments[0]).join("\n");
  assert.match(output, /Expo app: "apps\/mobile"/u);
  assert.match(output, /Package manager: pnpm/u);
  assert.match(output, /Dry run/u);
  assert.equal(request.mock.callCount(), 0);
  assert.equal(await readFile(path.join(mobile, "App.tsx"), "utf8"), "export default () => <View />;");
  assert.ok(!(await readdir(mobile)).includes(".kue"));
});

test("installs in the detected app and resolves SDK tarballs from the invocation directory", async (t) => {
  const root = await fixture({ workspaces: ["apps/*"], packageManager: "pnpm@10.33.0" });
  const mobile = await app(root, "apps/mobile");
  await writeFile(path.join(root, "project.json"), JSON.stringify(config));
  await packageFixture(mobile, "expo", "57.0.0");
  await writeFile(path.join(root, "sdk.tgz"), JSON.stringify({ version: "0.3.3" }));
  const readCalls = await fakeManager(t, root);
  await main(["init", "--config", "project.json", "--sdk", "sdk.tgz"], root);
  const calls = await readCalls();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.cwd === mobile));
  assert.deepEqual(calls[0].args, ["add", path.join(root, "sdk.tgz")]);
  assert.deepEqual(calls[1].args.slice(0, 3), ["exec", "expo", "install"]);
  await main(["init", "--app", "apps/mobile", "--sdk", "sdk.tgz"], root);
  assert.equal((await readCalls()).length, 2);
});

test("explicit app works without workspace definitions but rejects paths outside root and links", async () => {
  const root = await fixture();
  const mobile = await app(root, "custom/mobile");
  assert.equal((await resolveAppDirectory(root, "custom/mobile")).directory, mobile);
  const outside = await fixture({ dependencies: { expo: "57" } });
  await symlink(outside, path.join(root, "linked"));
  await assert.rejects(resolveAppDirectory(root, "linked"), /symbolic links/u);
  await assert.rejects(resolveAppDirectory(root, outside), /inside/u);
  await assert.rejects(resolveAppDirectory(root, ".."), /inside/u);
  await assert.rejects(resolveAppDirectory(root, ""), /--app/u);
  await assert.rejects(resolveAppDirectory(root, "."), /declare expo/u);
});

test("rejects unsafe workspace patterns and invalid manifests before choosing a partial result", async () => {
  for (const patterns of [["../*"], ["/tmp/*"], ["C:/apps/*"], [null], "apps/*"]) {
    const root = await fixture({ workspaces: { packages: patterns } });
    await assert.rejects(resolveAppDirectory(root), /Workspace|workspace/u);
  }
  const root = await fixture({ workspaces: ["apps/*"] });
  await app(root, "apps/mobile");
  await app(root, "apps/broken");
  await writeFile(path.join(root, "apps/broken/package.json"), "not JSON");
  await assert.rejects(resolveAppDirectory(root), /Invalid package.json/u);
});

test("rejects linked manifests and malformed workspace YAML", async () => {
  const root = await fixture({ workspaces: ["apps/*"] });
  await mkdir(path.join(root, "apps/mobile"), {recursive:true});
  await symlink(path.join(root, "package.json"), path.join(root, "apps/mobile/package.json"));
  await assert.rejects(resolveAppDirectory(root), /regular file/u);
  await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages: [oops");
  await assert.rejects(resolveAppDirectory(root), /Invalid pnpm-workspace/u);
});

test("no matching apps produces actionable guidance without selecting undeclared packages", async () => {
  const root = await fixture({ workspaces: ["apps/*"] });
  await app(root, "examples/mobile");
  await assert.rejects(resolveAppDirectory(root), /No Expo app found[\s\S]*--app/u);
  await writeFile(path.join(root, "package.json"), "{}");
  await assert.rejects(resolveAppDirectory(root), /No Expo app or workspace definition/u);
});

test("bounded discovery refuses partial results but skips unrelated containers", async () => {
  const root = await fixture({ workspaces: ["**"] });
  await app(root, "apps/mobile");
  const archive = path.join(root, "archive");
  await mkdir(archive);
  for (let i = 0; i < 2000; i++) await mkdir(path.join(archive, `entry-${i}`));
  await assert.rejects(resolveAppDirectory(root), /exceeds 2,000 directories/u);
  await writeFile(path.join(root, "package.json"), JSON.stringify({workspaces:["apps/*"]}));
  assert.equal((await resolveAppDirectory(root)).directory, path.join(root, "apps/mobile"));
});
