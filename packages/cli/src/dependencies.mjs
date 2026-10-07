import { readFile, stat, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import semver from "semver";
import { readOptional } from "./setup-state.mjs";

// Required native peers only. Optional triggers remain application-managed.
export const nativeRequirements = {
  "expo-application": ">=7 <58", "expo-constants": ">=18 <58", "expo-device": ">=8 <58",
  "expo-file-system": ">=19 <58", "expo-image-manipulator": ">=14 <58",
  "react-native-view-shot": ">=4", "react-native-safe-area-context": ">=4",
};

export async function installedPackage(cwd, name) {
  // Resolve package metadata without importing any host-app code. Walking Node's
  // search paths also handles hoisted workspaces and package.json export fences.
  const require = createRequire(path.join(cwd, "package.json"));
  for (const directory of require.resolve.paths(name) ?? []) {
    const filename = path.join(directory, name, "package.json");
    const text = await readOptional(filename);
    if (text !== null) {
      const manifest = JSON.parse(text);
      if (manifest.name !== name || !semver.valid(manifest.version)) throw new Error(`Invalid installed package: ${name}. Restore dependencies from your lockfile.`);
      return { manifest, directory: path.dirname(filename) };
    }
  }
  return null;
}

export async function tarballIdentity(filename) {
  if (!(await stat(filename)).isFile() || !filename.endsWith(".tgz")) throw new Error("--sdk must point to a local .tgz file.");
  return createHash("sha256").update(await readFile(filename)).digest("hex");
}

export async function dependencyPlan(cwd, manifest, version, tarball, state) {
  const declaration = name => manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  const installed = async name => {
    const result = await installedPackage(cwd, name);
    if (declaration(name) && !result) throw new Error(`${name} is declared but not installed. Restore dependencies from your lockfile, then rerun init (or use --skip-install).`);
    if (result && semver.validRange(declaration(name)) && !semver.satisfies(result.manifest.version, declaration(name))) {
      throw new Error(`${name} does not match package.json. Restore dependencies from your lockfile before running init.`);
    }
    return result;
  };
  const expo = await installed("expo");
  if (!expo || !semver.satisfies(expo.manifest.version, ">=54 <58")) throw new Error("Install the app's Expo SDK 54–57 dependencies from its lockfile before running init (or use --skip-install).");
  const bundled = JSON.parse(await readFile(path.join(expo.directory, "bundledNativeModules.json"), "utf8"));
  const sdk = await installed("@kue-qa/react-native");
  const declaredSdk = declaration("@kue-qa/react-native");
  let installSdk;
  if (tarball) {
    const localSpec = typeof declaredSdk === "string" && (declaredSdk.startsWith("file:") ? declaredSdk.slice(5)
      : declaredSdk.startsWith(".") || path.isAbsolute(declaredSdk) ? declaredSdk : null);
    const declaredPath = localSpec ? await realpath(path.resolve(cwd, localSpec)).catch(error => { if (error.code === "ENOENT") return null; throw error; }) : null;
    installSdk = !sdk || declaredPath !== await realpath(tarball.filename) || state.sdkTarball?.sha256 !== tarball.sha256 || state.sdkTarball?.version !== sdk.manifest.version;
  } else {
    if (declaredSdk && !semver.validRange(declaredSdk)) throw new Error("The SDK uses a custom dependency specifier. Supply --sdk for a local tarball, or manage this dependency yourself with --skip-install.");
    if (sdk && semver.gt(sdk.manifest.version, version)) throw new Error(`Installed KUE SDK ${sdk.manifest.version} is newer than CLI ${version}. Use the matching CLI; init will not downgrade it.`);
    installSdk = !declaredSdk || !sdk || sdk.manifest.version !== version;
  }
  const native = [];
  for (const [name, required] of Object.entries(nativeRequirements)) {
    const range = bundled[name];
    if (!semver.validRange(range)) throw new Error(`Expo has no supported version for ${name}. Install it explicitly and use --skip-install.`);
    const found = await installed(name);
    if (!declaration(name)) native.push(`${name}@${range}`);
    else if (!semver.satisfies(found.manifest.version, range) || !semver.satisfies(found.manifest.version, required)) {
      throw new Error(`${name}@${found.manifest.version} is incompatible with this Expo/KUE setup. Review an explicit Expo dependency update, or use --skip-install; init will not overwrite it.`);
    }
  }
  return { installSdk, native };
}
