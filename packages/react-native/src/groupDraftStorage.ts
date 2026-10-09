import { Directory, File, Paths } from "expo-file-system";
import { createClientReportId } from "./clientReportId";
import { GroupDraft, type GroupDraftStorage } from "./groupDraft";
import { findingLimit, findingMedia, withFindingUri } from "./finding";

/** Each session owns only its own copies. Caller/Reporter images remain theirs. */
export function createGroupDraft(): GroupDraft {
  const directory = new Directory(Paths.cache, `kue-group-${createClientReportId()}`);
  const storage: GroupDraftStorage = {
    copy(report) {
      const media = findingMedia(report);
      const source = new File(media.uri);
      const bytes = source.size;
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > findingLimit(report)) throw new Error("画像は1件10MiB、動画は1件20MiBまでです。");
      directory.create({ intermediates: true, idempotent: true });
      const target = new File(directory, `${createClientReportId()}.${media.mimeType === "video/mp4" ? "mp4" : media.mimeType === "image/png" ? "png" : "jpg"}`);
      try { source.copy(target); }
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
