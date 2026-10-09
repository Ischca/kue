import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { recordingMode, recordingManifest, recordingNativePackage, resolveRecording, formatManifest, checkRecordingSelection } from "../src/recording.mjs";
import { check } from "../src/check.mjs";
import { addKue, addRecordingMode, marker } from "../src/codemod.mjs";
import { main, sdkVersion } from "../src/init.mjs";
import { installedApp, fakeManager, fixtureConfig, snapshot } from "./fixtures.mjs";

const response = (entitled, available = false) => Response.json({ schemaVersion: 1, recording: { entitled, available } });
test("recording defaults to auto, validates off/overrides, and rejects ambiguous configuration", () => {
  assert.equal(recordingMode({}), "auto");
  assert.equal(recordingMode({ kue: { recording: "off" } }), "off");
  assert.equal(recordingMode({ kue: { recording: "off" } }, "auto"), "auto");
  for (const manifest of [{ kue: false }, { kue: [] }, { kue: { recording: true } }, { kue: { recording: null } }, { kue: { recording: "on" } }]) assert.throws(() => recordingMode(manifest));
});
test("auto uses server entitlement, not availability; off never contacts Cloud", async () => {
  for (const entitled of [true, false]) {
    const result = await resolveRecording(fixtureConfig, "auto", { request: async (url, options) => {
      assert.equal(url, "https://kue.test/v1/project/features");
      assert.equal(options.headers.Authorization, "Bearer pk_fixture_public");
      assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store");
      return response(entitled);
    } });
    assert.equal(result.nativeEnabled, entitled);
    assert.match(result.configHash, /^[a-f0-9]{64}$/u);
    assert.ok(!JSON.stringify(result).includes("pk_"));
  }
  assert.equal((await resolveRecording(fixtureConfig, "off", { request: () => { throw Error("unexpected"); } })).nativeEnabled, false);
});
test("verification failure is never interpreted as Free and does not echo server bodies or secrets", async () => {
  for (const request of [
    async () => { throw Error(fixtureConfig.projectKey); },
    async () => Response.json({ error: { message: fixtureConfig.projectKey } }, { status: 401 }),
    async () => Response.json({}, { status: 404 }),
    async () => Response.json({}, { status: 503 }),
    async () => Response.json({ schemaVersion: 1, recording: { entitled: "false", available: true } }),
    async () => Response.json({ schemaVersion: 2, recording: { entitled: true, available: true } }),
    async () => new Response("<html>error</html>"),
    async () => Response.json({ text: "x".repeat(5000) }),
  ]) await assert.rejects(resolveRecording(fixtureConfig, "auto", { request }), error => !error.message.includes(fixtureConfig.projectKey));
});
test("timeouts cover fetch and body reads, even when an adapter ignores AbortSignal", async () => {
  for (const request of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(resolveRecording(fixtureConfig, "auto", { request, timeoutMs: 5 }), /timed out/u);
  }
});
test("native exclusion applies to global and platform overrides without altering other modules", () => {
  const manifest = { kue: { other: 1 }, expo: { autolinking: { searchPaths: ["../../node_modules"], exclude: ["other"],
    ios: { exclude: ["ios-only"] }, apple: { flags: {} }, android: { exclude: [] } } } };
  const before = structuredClone(manifest);
  const free = recordingManifest(manifest, { nativeEnabled: false });
  for (const target of [free.expo.autolinking, free.expo.autolinking.ios, free.expo.autolinking.apple, free.expo.autolinking.android]) {
    assert.ok((target.exclude ?? free.expo.autolinking.exclude).includes(recordingNativePackage));
  }
  assert.deepEqual(manifest, before);
  assert.deepEqual(recordingManifest(free, { nativeEnabled: false }), free);
  const paid = recordingManifest(free, { nativeEnabled: true });
  assert.deepEqual(paid.expo.autolinking.exclude, ["other"]);
  assert.deepEqual(paid.expo.autolinking.ios.exclude, ["ios-only"]);
  assert.deepEqual(paid.expo.autolinking.apple, { flags: {} });
  assert.deepEqual(paid.expo.autolinking.searchPaths, ["../../node_modules"]);
  assert.deepEqual(paid.kue, { other: 1 });
  assert.deepEqual(recordingManifest(paid, { nativeEnabled: true }), paid);
});
test("invalid autolinking settings are not silently replaced", () => {
  for (const expo of [null, [], { autolinking: "custom" }, { autolinking: { exclude: "all" } }, { autolinking: { ios: false } }, { autolinking: { android: { exclude: [false] } } }]) {
    assert.throws(() => recordingManifest({ expo }, { nativeEnabled: false }));
  }
});
test("manifest formatting is retained exactly when unchanged and style is retained on edits", () => {
  const source = '{\r\n\t"name": "app"\r\n}\r\n';
  assert.equal(formatManifest(source, { name: "app" }), source);
  assert.equal(formatManifest(source, { name: "app", kue: { recording: "off" } }), '{\r\n\t"name": "app",\r\n\t"kue": {\r\n\t\t"recording": "off"\r\n\t}\r\n}\r\n');
});
test("recording root binding is idempotent, preserves directives/null returns, and binds every JSX return", () => {
  const root = addKue('"use client";\nexport default function App(){ if(!ready) return null; if(a) return <View/>; return <Text/>; }', "./.kue/config.js");
  const result = addRecordingMode(root, "./.kue/recording.js");
  assert.ok(result.startsWith('"use client";'));
  assert.ok(result.includes("return null"));
  assert.equal((result.match(/recording=\{kueRecordingMode\}/gu) ?? []).length, 2);
  assert.equal(addRecordingMode(result, "./.kue/recording.js"), result);
  assert.equal(addKue(result, "./.kue/config.js"), result);
  assert.equal(ts.createSourceFile("app.tsx", result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0);
  assert.throws(() => addRecordingMode(root.replace("cloud={kueCloudConfig}", 'recording="off" cloud={kueCloudConfig}'), "./.kue/recording.js"), /customized/u);
});
test("init automatically resolves Free/Indie, preserves files on repeat/failure, and supports persistent off", async t => {
  const cwd = await installedApp({ sdk: sdkVersion }), calls = await fakeManager(t, cwd);
  let entitled = false, failure = false, reads = 0;
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://kue.test/v1/project/features"); reads++;
    if (failure) throw Error("offline");
    return response(entitled);
  });
  const pkgFile = path.join(cwd, "package.json");
  await main(["init", "--config", "project.json"], cwd);
  const free = await snapshot(cwd);
  assert.ok(JSON.parse(free["package.json"].text).expo.autolinking.exclude.includes(recordingNativePackage));
  assert.equal(JSON.parse(free[".kue/setup.json"].text).recording.nativeEnabled, false);
  await main(["init"], cwd); assert.deepEqual(await snapshot(cwd), free);
  const readCount = reads;
  await main(["init", "--dry-run", "--recording", "off"], cwd);
  assert.equal(reads, readCount); assert.deepEqual(await snapshot(cwd), free);
  failure = true;
  await assert.rejects(main(["init"], cwd), /verify/u);
  assert.deepEqual(await snapshot(cwd), free);
  failure = false; entitled = true;
  await main(["init"], cwd);
  const paid = await snapshot(cwd);
  assert.deepEqual(paid["App.tsx"], free["App.tsx"]);
  assert.deepEqual(paid[".kue/config.js"], free[".kue/config.js"]);
  assert.ok(!JSON.parse(paid["package.json"].text).expo.autolinking.exclude.includes(recordingNativePackage));
  assert.equal(JSON.parse(paid[".kue/setup.json"].text).recording.nativeEnabled, true);
  await main(["init"], cwd); assert.deepEqual(await snapshot(cwd), paid);
  entitled = false;
  await main(["init"], cwd);
  assert.equal(JSON.parse(await readFile(path.join(cwd, ".kue/setup.json"), "utf8")).recording.nativeEnabled, false);
  const beforeOff = reads;
  await main(["init", "--recording", "off"], cwd);
  assert.equal(reads, beforeOff);
  const off = await snapshot(cwd);
  assert.equal(JSON.parse(off["package.json"].text).kue.recording, "off");
  assert.ok(off[".kue/recording.js"].text.includes('"off"'));
  await main(["init"], cwd); assert.deepEqual(await snapshot(cwd), off); assert.equal(reads, beforeOff);
  // Editing the persistent setting is also supported, without a command flag.
  const manifest = JSON.parse(await readFile(pkgFile, "utf8")); manifest.kue.recording = "auto";
  await writeFile(pkgFile, JSON.stringify(manifest));
  entitled = true;
  await main(["init"], cwd);
  assert.equal(reads, beforeOff + 1);
  assert.equal((await calls()).length, 0);
});
test("fresh verification failure happens before dependency installs, source or config writes", async t => {
  const cwd = await installedApp({ native: false }), calls = await fakeManager(t, cwd);
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 503 }));
  const before = await snapshot(cwd);
  await assert.rejects(main(["init", "--config", "project.json"], cwd));
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal((await calls()).length, 0);
});
test("build guard detects changed plan, connection, manual native settings and mode without repairing them", async () => {
  const read = entitled => ({ request: async () => response(entitled) });
  const config = await resolveRecording(fixtureConfig, "auto", read(false));
  const manifest = recordingManifest({}, config);
  await checkRecordingSelection(manifest, config, fixtureConfig, read(false));
  await checkRecordingSelection(manifest, config, { apiBaseUrl: fixtureConfig.apiBaseUrl, projectKey: fixtureConfig.projectKey }, read(false));
  await assert.rejects(checkRecordingSelection(manifest, config, fixtureConfig, read(true)), /out of date/u);
  await assert.rejects(checkRecordingSelection(manifest, config, { ...fixtureConfig, projectKey: "pk_other_public" }, read(false)), /out of date/u);
  await assert.rejects(checkRecordingSelection({ ...manifest, kue: { recording: "off" } }, config, fixtureConfig, read(false)), /out of date/u);
  const changed = structuredClone(manifest); changed.expo.autolinking.exclude = [];
  await assert.rejects(checkRecordingSelection(changed, config, fixtureConfig, read(false)), /native inclusion/u);
  assert.deepEqual(changed.expo.autolinking.exclude, []);
});
test("managed CLI check validates recording selection and remains completely read-only", async t => {
  const cwd = await installedApp({ sdk: sdkVersion });
  t.mock.method(globalThis, "fetch", async () => response(false));
  await main(["init", "--config", "project.json"], cwd);
  const before = await snapshot(cwd);
  const request = entitled => async url => url.endsWith("/features") ? response(entitled) : Response.json({ schemaVersion: 1, status: "ready" });
  await check([], cwd, { request: request(false), log: () => {} });
  await assert.rejects(check([], cwd, { request: request(true), log: () => {} }), /out of date/u);
  assert.deepEqual(await snapshot(cwd), before);
  await writeFile(path.join(cwd, ".kue/recording.js"), "throw new Error('must not execute');");
  await assert.rejects(check([], cwd, { request: request(false), log: () => {} }), /differs/u);
});
test("a published-style managed app gains the recording binding once without reconnecting or remounting KUE", async t => {
  const cwd = await installedApp({ sdk: sdkVersion }), calls = await fakeManager(t, cwd);
  await mkdir(path.join(cwd, ".kue"));
  const legacy = addKue(await readFile(path.join(cwd, "App.tsx"), "utf8"), "./.kue/config.js");
  await writeFile(path.join(cwd, "App.tsx"), legacy);
  const configText = `${marker}\nexport const kueCloudConfig = ${JSON.stringify(fixtureConfig)};\n`;
  await writeFile(path.join(cwd, ".kue/config.js"), configText);
  t.mock.method(globalThis, "fetch", async url => { assert.equal(url, "https://kue.test/v1/project/features"); return response(false); });
  await main(["init"], cwd);
  const after = await snapshot(cwd);
  assert.equal((after["App.tsx"].text.match(/<KueCapture /gu) ?? []).length, 1);
  assert.equal(after[".kue/config.js"].text, configText);
  assert.equal(Object.keys(after).filter(file => file.includes("backup-")).length, 1);
  await main(["init"], cwd);
  assert.deepEqual(await snapshot(cwd), after);
  assert.equal((await calls()).length, 0);
});
test("a user edit during the plan lookup is preserved and stops setup before installation", async t => {
  const cwd = await installedApp({ native: false }), calls = await fakeManager(t, cwd);
  let edited;
  t.mock.method(globalThis, "fetch", async () => {
    await writeFile(path.join(cwd, "App.tsx"), "export default () => <Text>User changes</Text>;\n");
    edited = await snapshot(cwd);
    return response(true);
  });
  await assert.rejects(main(["init", "--config", "project.json"], cwd), /changed during setup/u);
  assert.deepEqual(await snapshot(cwd), edited);
  assert.equal((await calls()).length, 0);
});
test("a linked recording config is rejected before plan requests or any writes", async t => {
  const cwd = await installedApp({ sdk: sdkVersion }), calls = await fakeManager(t, cwd);
  await mkdir(path.join(cwd, ".kue"));
  await symlink(path.join(cwd, "project.json"), path.join(cwd, ".kue/recording.js"));
  const before = await snapshot(cwd);
  const request = t.mock.method(globalThis, "fetch", () => assert.fail("must not request"));
  await assert.rejects(main(["init", "--config", "project.json"], cwd), /symlinks/u);
  assert.deepEqual(await snapshot(cwd), before);
  assert.equal(request.mock.callCount(), 0);
  assert.equal((await calls()).length, 0);
});
