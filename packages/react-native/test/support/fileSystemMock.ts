import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** "current" is expo-file-system 56+ (copy()/move() settle later, copySync()/moveSync() exist); "legacy" is 19–55. */
export type FileSystemApi = "current" | "legacy";

/** Real file bytes/renames under `root`, with only the native filesystem bridge replaced. */
export function fileSystemMock(state: { api: FileSystemApi; root: string }) {
  const relocate = (operation: () => void): Promise<void> | void => state.api === "legacy" ? operation()
    : new Promise((resolve, reject) => setImmediate(() => { try { operation(); resolve(); } catch (error) { reject(error); } }));
  class Item {
    filePath: string;
    constructor(...parts: Array<string | Item>) {
      this.filePath = path.join(...parts.map((part) => typeof part === "string" ? part.startsWith("file:") ? fileURLToPath(part) : part : part.filePath));
    }
    get uri() { return pathToFileURL(this.filePath).href; }
    get name() { return path.basename(this.filePath); }
    get exists() { return fs.existsSync(this.filePath); }
    delete() { fs.rmSync(this.filePath, { recursive: true }); }
  }
  class Directory extends Item {
    create() { fs.mkdirSync(this.filePath, { recursive: true }); }
    list() { return fs.readdirSync(this.filePath).map((name) => fs.statSync(path.join(this.filePath, name)).isDirectory() ? new Directory(this, name) : new File(this, name)); }
  }
  class File extends Item {
    get size() { return fs.statSync(this.filePath).size; }
    textSync() { return fs.readFileSync(this.filePath, "utf8"); }
    write(text: string) { fs.writeFileSync(this.filePath, text); }
    copy(to: File) { return relocate(() => this.copyNow(to)); }
    move(to: File) { return relocate(() => this.moveNow(to)); }
    get copySync() { return state.api === "current" ? (to: File) => this.copyNow(to) : undefined; }
    get moveSync() { return state.api === "current" ? (to: File) => this.moveNow(to) : undefined; }
    private copyNow(to: File) { fs.copyFileSync(this.filePath, to.filePath, fs.constants.COPYFILE_EXCL); }
    private moveNow(to: File) { if (to.exists) throw new Error("destination exists"); fs.renameSync(this.filePath, to.filePath); this.filePath = to.filePath; }
  }
  return { Directory, File, Paths: { get document() { return state.root; }, get cache() { return state.root; } } };
}
