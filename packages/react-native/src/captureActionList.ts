import type { KueText } from "./i18n";
import type { CaptureAction } from "./radialMenu";
import type { RecordingAvailability } from "./recordingAvailability";
import type { KueRecordingMode } from "./types";

/** A tap already captures, and collecting happens on the finding screen; the menu holds only what a tap cannot do. */
export function captureActionList({ groupCount, groupLabel, recording, availability, outbox, onCreateIssue, onRecord, onOutbox, text }: {
  groupCount: number; groupLabel: string; recording: KueRecordingMode; availability: RecordingAvailability; outbox: boolean;
  onCreateIssue: () => void; onRecord: () => void; onOutbox: () => void; text: KueText;
}): CaptureAction[] {
  return [
    ...(groupCount > 0 ? [{ id: "issue", label: text.count(groupLabel, groupCount), symbol: "✓", onSelect: onCreateIssue }] : []),
    // An app that set recording off chose not to offer it; Free still sees the locked upgrade path.
    ...(recording === "off" ? [] : [{ id: "recording", label: availability === "upgrade" ? text.menu.recordingLocked : text.menu.recording,
      symbol: "●", onSelect: onRecord, locked: availability === "upgrade" }]),
    ...(outbox ? [{ id: "outbox", label: text.menu.outbox, symbol: "↑", onSelect: onOutbox }] : []),
  ];
}
