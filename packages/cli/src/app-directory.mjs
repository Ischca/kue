import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import { parseDocument } from "yaml";

const ignoredDirectories = new Set(["node_modules", "vendor", "build", "dist", "coverage", "ios", "android"]);
const maxDirectories = 2000;
const isExpo = manifest => !!(manifest?.dependencies?.expo || manifest?.devDependencies?.expo);
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function optionalFile(file) {
  const stat = await lstat(file).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${JSON.stringify(file)}. No files were changed.`);
  return readFile(file, "utf8");
}

async function manifestAt(directory) {
  const source = await optionalFile(path.join(directory, "package.json"));
  if (source === null) return null;
  try {
    const manifest = JSON.parse(source);
    if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") throw new Error();
    return manifest;
  } catch {
    throw new Error(`Invalid package.json in ${JSON.stringify(directory)}. Fix it before running init.`);
  }
}

async function workspacePatterns(root, manifest) {
  const source = await optionalFile(path.join(root, "pnpm-workspace.yaml"));
  let patterns;
  if (source !== null) {
    const document = parseDocument(source);
    if (document.errors.length) throw new Error("Invalid pnpm-workspace.yaml. Fix it or select an Expo package with --app <directory>.");
    try { patterns = document.toJS({ maxAliasCount: 50 })?.packages; }
    catch { throw new Error("Could not read pnpm workspace packages. Select an Expo package with --app <directory>."); }
  } else {
    patterns = Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages;
  }
  if (patterns === undefined) return null;
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== "string" || !pattern.trim())) {
    throw new Error("Workspace packages must be an array of directory patterns. Select an Expo package with --app <directory>.");
  }
  // Patterns are matched against local directory names, never used as crawl roots.
  // Refuse outside patterns instead of silently treating an incomplete scan as unique.
  if (patterns.some(pattern => /[\\\x00-\x1f:]|\.\./u.test(pattern) || pattern.replace(/^!/u, "").startsWith("/"))) {
    throw new Error("Workspace auto-detection supports only directories inside the current directory. Run init inside the Expo package instead.");
  }
  return patterns.map(pattern => pattern.replace(/^(!?)\.\//u, "$1").replace(/\/+$/u, ""));
}

async function explicitApp(root, value) {
  if (!value.trim()) throw new Error("--app must name an Expo package directory.");
  const directory = path.resolve(root, value);
  if (!inside(root, directory)) throw new Error("--app must stay inside the current directory. Run init inside the Expo package instead.");
  let current = root;
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("--app must be a directory without symbolic links.");
  }
  if (!inside(root, await realpath(directory))) throw new Error("--app resolves outside the current directory.");
  const manifest = await manifestAt(directory);
  if (!isExpo(manifest)) throw new Error("The selected --app directory must declare expo in dependencies or devDependencies.");
  return { directory, manifest };
}

export async function resolveAppDirectory(cwd, app) {
  const root = await realpath(cwd);
  if (app !== undefined) return explicitApp(root, app);
  const manifest = await manifestAt(root);
  if (isExpo(manifest)) return { directory: root, manifest };
  const patterns = await workspacePatterns(root, manifest);
  if (!patterns) throw new Error("No Expo app or workspace definition found. Run init inside the Expo package, or use --app <directory>.");
  const positive = patterns.filter(pattern => !pattern.startsWith("!"));
  const negative = patterns.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1));
  const included = positive.length ? picomatch(positive) : () => false;
  const excluded = negative.length ? picomatch(negative) : () => false;
  const bases = positive.map(pattern => picomatch.scan(pattern).base);
  const relevant = relative => bases.some(base => !base || relative === base || relative.startsWith(`${base}/`) || base.startsWith(`${relative}/`));
  const candidates = [];
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    if (++visited > maxDirectories) throw new Error("Workspace search exceeds 2,000 directories. Select an Expo package with --app <directory>; no files were changed.");
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) continue;
      const child = path.join(directory, entry.name);
      const relative = path.relative(root, child).split(path.sep).join("/");
      if (!relevant(relative)) continue;
      // readdir skips links, and realpath rechecks the boundary before reading a manifest.
      if (!inside(root, await realpath(child))) throw new Error("Workspace directory resolves outside the current directory.");
      if (included(relative) && !excluded(relative)) {
        const childManifest = await manifestAt(child);
        if (isExpo(childManifest)) candidates.push({ directory: child, manifest: childManifest });
      }
      pending.push(child);
    }
  }
  candidates.sort((a, b) => a.directory.localeCompare(b.directory));
  if (!candidates.length) throw new Error("No Expo app found in the workspace packages. Run init inside the Expo package, or use --app <directory>.");
  if (candidates.length > 1) {
    const choices = candidates.map(candidate => `  ${JSON.stringify(path.relative(root, candidate.directory).split(path.sep).join("/"))}`).join("\n");
    throw new Error(`Multiple Expo apps found:\n${choices}\nSelect one with --app <directory>. No files or remote state were changed.`);
  }
  return candidates[0];
}
