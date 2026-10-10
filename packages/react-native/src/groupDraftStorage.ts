import { Directory, File, Paths } from "expo-file-system";
import { createClientReportId } from "./clientReportId";
import { copyFileSync } from "./fileSync";
import { GroupDraft, type GroupDraftStorage } from "./groupDraft";
import { findingLimit, findingMedia, withFindingUri } from "./finding";
import { currentKueText } from "./i18n";

// The native recorder accepts the same draft directory names.
const draftDirectory = /^kue-group-[A-Za-z0-9_-]+$/u;
// Never unregistered: a live draft deletes its directory whenever it becomes empty.
const sessionDirectories = new Set<string>();

/** Each session owns only its own copies. Caller/Reporter images remain theirs. */
export function createGroupDraft(): GroupDraft {
  const name = `kue-group-${createClientReportId()}`;
  sessionDirectories.add(name);
  const directory = new Directory(Paths.cache, name);
  const storage: GroupDraftStorage = {
    copy(report) {
      const media = findingMedia(report);
      const source = new File(media.uri);
      const bytes = source.size;
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > findingLimit(report)) throw new Error(currentKueText().errors.mediaSize);
      directory.create({ intermediates: true, idempotent: true });
      const target = new File(directory, `${createClientReportId()}.${media.mimeType === "video/mp4" ? "mp4" : media.mimeType === "image/png" ? "png" : "jpg"}`);
      try { copyFileSync(source, target); }
      catch (cause) { if (target.exists) target.delete(); throw cause; }
      return { bytes, report: withFindingUri(report, target.uri) };
    },
    release(report) {
      const file = new File(findingMedia(report).uri);
      if (file.exists) file.delete();
      if (directory.exists && directory.list().length === 0) directory.delete();
    },
  };
  return new GroupDraft(storage);
}

/** Drafts are not restored, and a terminated or reloaded JS runtime never disposes them, so
 * delete every draft directory this runtime did not create. Assumes one runtime per cache. */
export function removeOrphanedGroupDrafts(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (!(entry instanceof Directory) || !draftDirectory.test(entry.name) || sessionDirectories.has(entry.name)) continue;
      try { entry.delete(); } catch { /* A later session or OS cache eviction removes it. */ }
    }
  } catch { /* Cleanup never blocks capture. */ }
}
