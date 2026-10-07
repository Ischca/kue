import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { main, sdkVersion } from "../src/init.mjs";
import { nativeRequirements, dependencyPlan } from "../src/dependencies.mjs";
import { installedApp, packageFixture, fakeManager, snapshot, fixtureConfig } from "./fixtures.mjs";

const noNetwork = t => t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network/browser authorization"); });
async function initialize(t, options = { sdk: sdkVersion }) {
  const cwd = await installedApp(options), calls = await fakeManager(t, cwd);
  await main(["init", "--config", "project.json"], cwd);
  return { cwd, calls };
}

test("fresh install then repeated default/explicit-config init is a byte-and-mtime no-op", async t => {
  const network = noNetwork(t);
  const { cwd, calls } = await initialize(t, { native: false });
  assert.equal((await calls()).length, 2);
  const before = await snapshot(cwd);
  for (const args of [["init"], ["init", "--config", "project.json"], ["init", "--server", fixtureConfig.apiBaseUrl], ["init", "--dry-run"]]) {
    await main(args, cwd);
    assert.deepEqual(await snapshot(cwd), before);
  }
  assert.equal((await calls()).length, 2);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(Object.keys(before).filter(name => name.includes("backup-")).length, 1);
});

test("existing 0.3.3 configuration needs no new metadata, origin or consent", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const before = await snapshot(cwd);
  assert.equal(before[".kue/setup.json"], undefined);
  const log = t.mock.method(console, "log", () => {});
  await main(["init"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 0);
  assert.match(log.mock.calls.map(call => call.arguments.join(" ")).join("\n"), /already configured.*No files or dependencies changed/u);
});

test("a CLI version upgrade installs only the SDK and preserves config and compatible native peers", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const filename = path.join(cwd, "package.json"), manifest = JSON.parse(await readFile(filename, "utf8"));
  manifest.dependencies["@kue-qa/react-native"] = "0.3.2";
  await writeFile(filename, JSON.stringify(manifest));
  await packageFixture(cwd, "@kue-qa/react-native", "0.3.2");
  const before = await snapshot(cwd);
  await main(["init"], cwd);
  assert.deepEqual((await calls()).map(call => call.args), [["add", `@kue-qa/react-native@${sdkVersion}`]]);
  const after = await snapshot(cwd);
  for (const file of Object.keys(before).filter(file => file === "App.tsx" || file.startsWith(".kue/"))) assert.deepEqual(after[file], before[file]);
  const updated = JSON.parse(await readFile(filename, "utf8"));
  for (const name of Object.keys(nativeRequirements)) assert.equal(updated.dependencies[name], manifest.dependencies[name]);
  await main(["init"], cwd);
  assert.deepEqual(await snapshot(cwd), after);
  assert.equal((await calls()).length, 1);
});

test("only a missing native dependency is installed; existing ones are untouched", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const filename = path.join(cwd, "package.json"), manifest = JSON.parse(await readFile(filename, "utf8"));
  delete manifest.dependencies["expo-device"];
  await writeFile(filename, JSON.stringify(manifest));
  await main(["init"], cwd);
  assert.deepEqual((await calls()).map(call => call.args), [["exec", "expo", "install", "expo-device@~57.0.2"]]);
  const after = await snapshot(cwd);
  await main(["init"], cwd);
  assert.deepEqual(await snapshot(cwd), after);
  assert.equal((await calls()).length, 1);
});

test("explicit JSON replacement changes only config; identical replacement is a no-op", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  await writeFile(path.join(cwd, "project.json"), JSON.stringify({ ...fixtureConfig, projectKey: "pk_replaced_public" }));
  const before = await snapshot(cwd);
  await main(["init", "--config", "project.json"], cwd);
  const after = await snapshot(cwd);
  assert.deepEqual(Object.keys(after).filter(file => after[file].mtime !== before[file]?.mtime), [".kue/config.js"]);
  await main(["init", "--config", "project.json"], cwd);
  assert.deepEqual(await snapshot(cwd), after);
  assert.equal((await calls()).length, 0);
});

test("skip-install can be repeated without writes and does not mark dependencies installed", async t => {
  noNetwork(t);
  const cwd = await installedApp({ native: false }), calls = await fakeManager(t, cwd);
  await main(["init", "--config", "project.json", "--skip-install"], cwd);
  const before = await snapshot(cwd);
  await main(["init", "--skip-install"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 0);
  await main(["init"], cwd);
  assert.equal((await calls()).length, 2);
});

test("changing server or an unknown repository requires explicit reconnection before any side effects", async t => {
  const network = noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const before = await snapshot(cwd);
  for (const args of [["--server", "https://other.test"], ["--repository", "owner/other"]]) {
    await assert.rejects(main(["init", ...args], cwd), /--reconnect/u);
    assert.deepEqual(await snapshot(cwd), before);
  }
  for (const args of [["--reconnect"], ["--repository", "owner/app"], ["--server", fixtureConfig.apiBaseUrl]]) {
    await assert.rejects(main(["init", "--config", "project.json", ...args], cwd), /cannot be combined/u);
  }
  assert.equal((await calls()).length, 0);
  assert.equal(network.mock.callCount(), 0);
});

test("explicit reconnection records the target; repeating init with that repository never reauthorizes", async t => {
  const { cwd, calls } = await initialize(t);
  const request = t.mock.method(globalThis, "fetch", async url => url.endsWith("/v1/bootstrap")
    ? Response.json({ id: "connect_test", pollToken: "a".repeat(43), connectUrl: "https://kue.test/connect/connect_test" })
    : Response.json({ status: "completed", config: fixtureConfig }));
  const before = await snapshot(cwd);
  await main(["init", "--reconnect", "--repository", "owner/app", "--no-open"], cwd);
  assert.equal(request.mock.callCount(), 2);
  const after = await snapshot(cwd);
  assert.deepEqual(after[".kue/config.js"], before[".kue/config.js"]);
  assert.ok(after[".kue/setup.json"]);
  await main(["init", "--repository", "OWNER/APP"], cwd);
  await main(["init"], cwd);
  assert.equal(request.mock.callCount(), 2);
  assert.equal((await calls()).length, 0);
  assert.deepEqual(await snapshot(cwd), after);
});

test("local tarball hashes avoid repeated installs but detect same-version changed bytes", async t => {
  noNetwork(t);
  const cwd = await installedApp(), calls = await fakeManager(t, cwd);
  await writeFile(path.join(cwd, "sdk.tgz"), JSON.stringify({ version: sdkVersion }));
  await main(["init", "--config", "project.json", "--sdk", "sdk.tgz"], cwd);
  assert.equal((await calls()).length, 1);
  const before = await snapshot(cwd);
  await main(["init", "--sdk", "sdk.tgz"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 1);
  await writeFile(path.join(cwd, "sdk.tgz"), JSON.stringify({ version: sdkVersion, revision: 2 }));
  await main(["init", "--sdk", "sdk.tgz"], cwd);
  assert.equal((await calls()).length, 2);
  const after = await snapshot(cwd);
  await main(["init", "--sdk", "sdk.tgz"], cwd);
  assert.deepEqual(await snapshot(cwd), after);
  assert.equal((await calls()).length, 2);
  await assert.rejects(main(["init"], cwd), /custom dependency/u);
});

for (const scenario of ["newer-sdk", "missing-install", "incompatible-native", "malformed-config", "executable-config", "broken-root", "missing-config", "custom-types", "bad-metadata", "linked-metadata"]) {
  test(`inconsistent ${scenario} fails before network, install or file writes`, async t => {
    const network = noNetwork(t);
    const { cwd, calls } = await initialize(t);
    const pkg = path.join(cwd, "package.json");
    const manifest = JSON.parse(await readFile(pkg, "utf8"));
    if (scenario === "newer-sdk") { manifest.dependencies["@kue-qa/react-native"] = "99.0.0"; await writeFile(pkg, JSON.stringify(manifest)); await packageFixture(cwd, "@kue-qa/react-native", "99.0.0"); }
    if (scenario === "missing-install") await rm(path.join(cwd, "node_modules/expo-device/package.json"));
    if (scenario === "incompatible-native") { manifest.dependencies["expo-device"] = "8.0.0"; await writeFile(pkg, JSON.stringify(manifest)); await packageFixture(cwd, "expo-device", "8.0.0"); }
    if (scenario === "malformed-config") await writeFile(path.join(cwd, ".kue/config.js"), "/* kue-qa:managed */ export const kueCloudConfig = { broken");
    if (scenario === "executable-config") await writeFile(path.join(cwd, ".kue/config.js"), "/* kue-qa:managed */ globalThis.__kueExecuted = true; export const kueCloudConfig = {};");
    if (scenario === "broken-root") await writeFile(path.join(cwd, "App.tsx"), "/* kue-qa:managed */ export default () => <View />;");
    if (scenario === "missing-config") await rm(path.join(cwd, ".kue/config.js"));
    if (scenario === "custom-types") await writeFile(path.join(cwd, ".kue/config.d.ts"), "// user-maintained declarations");
    if (scenario === "bad-metadata") await writeFile(path.join(cwd, ".kue/setup.json"), "null");
    if (scenario === "linked-metadata") await symlink(path.join(cwd, "project.json"), path.join(cwd, ".kue/setup.json"));
    const before = await snapshot(cwd);
    await assert.rejects(main(["init"], cwd));
    assert.deepEqual(await snapshot(cwd), before);
    assert.equal(network.mock.callCount(), 0);
    assert.equal((await calls()).length, 0);
    assert.equal(globalThis.__kueExecuted, undefined);
  });
}

test("CLI native requirements match the SDK's required native peers", async () => {
  const sdk = JSON.parse(await readFile(new URL("../../react-native/package.json", import.meta.url), "utf8"));
  for (const [name, range] of Object.entries(nativeRequirements)) {
    assert.equal(sdk.peerDependencies[name], range);
    assert.notEqual(sdk.peerDependenciesMeta?.[name]?.optional, true);
  }
});

test("compatible installed versions are reused even when declarations are ranges", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const pkg = path.join(cwd, "package.json"), manifest = JSON.parse(await readFile(pkg, "utf8"));
  for (const name of Object.keys(nativeRequirements)) manifest.dependencies[name] = "^" + manifest.dependencies[name];
  manifest.dependencies["@kue-qa/react-native"] = "^" + sdkVersion;
  await writeFile(pkg, JSON.stringify(manifest));
  const before = await snapshot(cwd);
  await main(["init"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 0);
});

test("a requested SDK update does not silently alter incompatible declared dependencies", async () => {
  const cwd = await installedApp({ sdk: "0.3.2" });
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  manifest.dependencies["expo-device"] = "8.0.0";
  await packageFixture(cwd, "expo-device", "8.0.0");
  await assert.rejects(dependencyPlan(cwd, manifest, sdkVersion, null, {}), /incompatible/u);
});

test("managed config formatting is preserved when values are unchanged", async t => {
  noNetwork(t);
  const { cwd, calls } = await initialize(t);
  const file = path.join(cwd, ".kue/config.js");
  await writeFile(file, '/* kue-qa:managed */\n// Keep this comment.\nexport const kueCloudConfig = ' + JSON.stringify({ apiBaseUrl: fixtureConfig.apiBaseUrl, projectKey: fixtureConfig.projectKey }) + ';\n');
  const before = await snapshot(cwd);
  await main(["init", "--config", "project.json"], cwd);
  await main(["init", "--dry-run", "--reconnect", "--repository", "owner/other"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 0);
});

test("user edits made during authorization abort setup before installation or overwrite", async t => {
  const { cwd, calls } = await initialize(t);
  let edited;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.endsWith("/v1/bootstrap")) return Response.json({ id: "connect_test", pollToken: "a".repeat(43), connectUrl: "https://kue.test/connect/connect_test" });
    const filename = path.join(cwd, ".kue/config.js");
    await writeFile(filename, (await readFile(filename, "utf8")) + "// User edit while browser was open.\n");
    edited = await snapshot(cwd);
    return Response.json({ status: "completed", config: { ...fixtureConfig, projectKey: "pk_changed_remote" } });
  });
  await assert.rejects(main(["init", "--reconnect", "--repository", "owner/other", "--no-open"], cwd), /changed during setup/u);
  assert.deepEqual(await snapshot(cwd), edited);
  assert.equal((await calls()).length, 0);
});

for (const manager of ["npm", "yarn", "bun"]) {
  test(`${manager} also installs a missing SDK only once`, async t => {
    noNetwork(t);
    const cwd = await installedApp(), calls = await fakeManager(t, cwd);
    const file = path.join(cwd, "package.json"), manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.packageManager = `${manager}@1.0.0`;
    await writeFile(file, JSON.stringify(manifest));
    await main(["init", "--config", "project.json"], cwd);
    assert.deepEqual((await calls()).map(call => call.args), [[manager === "npm" ? "install" : "add", `@kue-qa/react-native@${sdkVersion}`]]);
    const before = await snapshot(cwd);
    await main(["init"], cwd);
    assert.deepEqual(await snapshot(cwd), before);
    assert.equal((await calls()).length, 1);
  });
}
