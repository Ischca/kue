import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { main, sdkVersion } from "../src/init.mjs";
import { installedApp, fakeManager, snapshot } from "./fixtures.mjs";

function features(t) {
  return t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://kue.test/v1/project/features");
    return Response.json({ schemaVersion: 1, recording: { entitled: false, available: true } });
  });
}
test("manual integration preserves custom JSX and is a byte/mtime no-op on repeat", async t => {
  features(t);
  const cwd = await installedApp({ sdk: sdkVersion });
  const calls = await fakeManager(t, cwd);
  const source = 'import { Kue } from "@kue-qa/react-native";\nexport const Custom = () => <Kue enabled />;\n';
  await writeFile(path.join(cwd, "App.tsx"), source);
  const original = (await snapshot(cwd))["App.tsx"];
  await main(["init", "--skip-integration", "--config", "project.json"], cwd);
  const first = await snapshot(cwd);
  assert.deepEqual(first["App.tsx"], original);
  assert.equal(Object.keys(first).some(name => name.includes("backup-")), false);
  assert.equal(JSON.parse(first[".kue/setup.json"].text).recording.nativeEnabled, false);
  await main(["init", "--skip-integration"], cwd);
  assert.deepEqual(await snapshot(cwd), first);
  assert.equal((await calls()).length, 0);
});
test("manual integration does not require a detectable root, but still installs dependencies", async t => {
  features(t);
  const cwd = await installedApp({ native: false });
  await rm(path.join(cwd, "App.tsx"));
  const calls = await fakeManager(t, cwd);
  await main(["init", "--skip-integration", "--config", "project.json"], cwd);
  assert.equal((await calls()).length, 2);
  assert.ok((await readFile(path.join(cwd, ".kue/config.js"), "utf8")).includes("pk_fixture_public"));
});
test("manual dry-run is read-only and contradictory root flags fail before side effects", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No network expected"));
  const cwd = await installedApp({ sdk: sdkVersion });
  const before = await snapshot(cwd);
  await main(["init", "--skip-integration", "--dry-run"], cwd);
  assert.deepEqual(await snapshot(cwd), before);
  await assert.rejects(main(["init", "--skip-integration", "--root", "App.tsx"], cwd), /cannot be combined/);
  assert.deepEqual(await snapshot(cwd), before);
});
test("manual integration keeps config validation and fails closed on plan lookup failure", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "unauthorized" } }, { status: 401 }));
  const cwd = await installedApp({ sdk: sdkVersion });
  const before = await snapshot(cwd);
  await assert.rejects(main(["init", "--skip-integration", "--config", "project.json"], cwd), /rejected the project key/);
  assert.deepEqual(await snapshot(cwd), before);
});
