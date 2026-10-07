import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const nativeVersions = {
  "expo-application": "57.0.3", "expo-constants": "57.0.20", "expo-device": "57.0.2",
  "expo-file-system": "57.0.7", "expo-image-manipulator": "57.0.20",
  "react-native-view-shot": "5.1.0", "react-native-safe-area-context": "5.7.0",
};
export const fixtureConfig = { projectKey: "pk_fixture_public", apiBaseUrl: "https://kue.test" };

export async function packageFixture(cwd, name, version) {
  const directory = path.join(cwd, "node_modules", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version }));
  if (name === "expo") await writeFile(path.join(directory, "bundledNativeModules.json"), JSON.stringify(Object.fromEntries(Object.entries(nativeVersions).map(([name, version]) => [name, `~${version}`]))));
}

export async function installedApp({ sdk, native = true } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "kue-idempotent-"));
  const dependencies = { expo: "~57.0.21", ...(sdk ? { "@kue-qa/react-native": sdk } : {}), ...(native ? nativeVersions : {}) };
  await writeFile(path.join(cwd, "package.json"), JSON.stringify({ dependencies, packageManager: "pnpm@10.33.0" }, null, 2));
  await packageFixture(cwd, "expo", "57.0.21");
  if (sdk) await packageFixture(cwd, "@kue-qa/react-native", sdk);
  if (native) for (const [name, version] of Object.entries(nativeVersions)) await packageFixture(cwd, name, version);
  await writeFile(path.join(cwd, "App.tsx"), "export default () => <View />;\n");
  await writeFile(path.join(cwd, "project.json"), JSON.stringify(fixtureConfig));
  await writeFile(path.join(cwd, "pnpm-lock.yaml"), "fixture-lock\n");
  return cwd;
}

// This fixture package manager changes only fixture manifests/node_modules and
// records calls. No registry access, install scripts, or browser is invoked.
export async function fakeManager(t, base) {
  const bin = path.join(base, "bin");
  await mkdir(bin, { recursive: true });
  const log = path.join(base, "calls.jsonl");
  const shim = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), cwd = process.cwd();
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({cwd,args})+'\\n');
const manifest = JSON.parse(fs.readFileSync('package.json','utf8'));
manifest.dependencies ||= {};
const specs = args[0] === 'add' || args[0] === 'install' ? args.slice(1) : args.slice(args.indexOf('install')+1);
for (const spec of specs) {
  let name, version, declared;
  if (spec.endsWith('.tgz')) { name='@kue-qa/react-native'; version=JSON.parse(fs.readFileSync(spec,'utf8')).version; declared='file:'+path.relative(cwd,spec); }
  else { const split=spec.lastIndexOf('@'); name=spec.slice(0,split); declared=spec.slice(split+1); version=declared.replace(/^[~^]/,''); }
  manifest.dependencies[name]=declared;
  const dir=path.join(cwd,'node_modules',name); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version}));
}
fs.writeFileSync('package.json',JSON.stringify(manifest,null,2));
fs.appendFileSync('pnpm-lock.yaml','fixture-install\\n');
`;
  for (const name of ["pnpm", "npm", "yarn", "bun"]) {
    await writeFile(path.join(bin, name), shim);
    await chmod(path.join(bin, name), 0o755);
  }
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  t.after(() => { process.env.PATH = previous; });
  return async () => (await readFile(log, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; })).trim().split("\n").filter(Boolean).map(JSON.parse);
}

export async function snapshot(cwd) {
  const files = {};
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (["node_modules", "bin", "calls.jsonl"].includes(name)) continue;
      const file = path.join(directory, name), info = await stat(file, { bigint: true });
      if (info.isDirectory()) await walk(file);
      else files[path.relative(cwd, file)] = { text: await readFile(file, "utf8"), mtime: info.mtimeNs };
    }
  }
  await walk(cwd);
  return files;
}
