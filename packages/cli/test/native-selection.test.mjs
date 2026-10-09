import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordingManifest } from "../src/recording.mjs";

// Exercise Expo's real autolinker with an isolated fixture native module. This
// verifies inclusion, not compilation or actual screen recording on a device.
const sdkRequire = createRequire(new URL("../../react-native/package.json", import.meta.url));
const expoRequire = createRequire(sdkRequire.resolve("expo/package.json"));
const autolinking = path.join(path.dirname(expoRequire.resolve("expo-modules-autolinking/package.json")), "bin/expo-modules-autolinking.js");
test("Expo resolves the recorder only for enabled builds on Apple and Android", async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-native-selection-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const put = async (file, text) => { await mkdir(path.dirname(path.join(cwd, file)), { recursive: true }); await writeFile(path.join(cwd, file), text); };
  const name = "@kue-qa/react-native";
  for (const name of ["@kue-qa/react-native", "unrelated", "screenshot-peer"]) {
    const module = `node_modules/${name}`;
    await put(`${module}/package.json`, JSON.stringify({ name, version: "1.0.0" }));
    if (name === "@kue-qa/react-native") continue;
    await put(`${module}/expo-module.config.json`, JSON.stringify({ platforms: ["apple", "android"], apple: { modules: ["FixtureModule"] }, android: { modules: ["dev.example.FixtureModule"] } }));
    await put(`${module}/ios/FixtureModule.podspec`, "Pod::Spec.new do |s|\n  s.name = 'FixtureModule'\nend\n");
    await put(`${module}/android/build.gradle`, "// Resolution fixture only.\n");
  }
  // Resolve the actual SDK registration and build descriptors, not invented
  // module names. Keep unrelated peers as small isolation fixtures.
  for (const file of ["expo-module.config.json", "ios/KueRecorder.podspec", "android/build.gradle"]) {
    await put(`node_modules/${name}/${file}`, await readFile(new URL(`../../react-native/${file}`, import.meta.url), "utf8"));
  }
  const base = { name: "native-selection-fixture", dependencies: { [name]: "1.0.0", unrelated: "1.0.0", "screenshot-peer": "1.0.0" },
    expo: { autolinking: { exclude: ["unrelated"], apple: { flags: {} }, android: { exclude: ["unrelated"] } } } };
  for (const nativeEnabled of [false, true, false]) {
    await put("package.json", JSON.stringify(recordingManifest(base, { nativeEnabled })));
    for (const platform of ["apple", "android"]) {
      const result = spawnSync(process.execPath, [autolinking, "resolve", "--platform", platform, "--project-root", cwd, "--json"], { cwd, encoding: "utf8", timeout: 20_000 });
      assert.equal(result.status, 0, result.stderr);
      const modules = JSON.parse(result.stdout).modules;
      assert.equal(modules.some(module => module.packageName === name), nativeEnabled, `${platform}: nativeEnabled=${nativeEnabled}`);
      assert.equal(modules.some(module => module.packageName === "unrelated"), false);
      assert.equal(modules.some(module => module.packageName === "screenshot-peer"), true);
    }
  }
});
