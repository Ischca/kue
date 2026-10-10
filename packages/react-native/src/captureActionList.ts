import type { CaptureAction } from "./radialMenu";
import type { RecordingAvailability } from "./recordingAvailability";
import type { KueRecordingMode } from "./types";

/** A tap already captures, and collecting happens on the finding screen; the menu holds only what a tap cannot do. */
export function captureActionList({ groupCount, groupLabel, recording, availability, outbox, onCreateIssue, onRecord, onOutbox }: {
  groupCount: number; groupLabel: string; recording: KueRecordingMode; availability: RecordingAvailability; outbox: boolean;
  onCreateIssue: () => void; onRecord: () => void; onOutbox: () => void;
}): CaptureAction[] {
  return [
    ...(groupCount > 0 ? [{ id: "issue", label: `${groupLabel}（${groupCount}件）`, symbol: "✓", onSelect: onCreateIssue }] : []),
    // An app that set recording off chose not to offer it; Free still sees the locked upgrade path.
    ...(recording === "off" ? [] : [{ id: "recording", label: availability === "upgrade" ? "画面録画 · Indieで解放" : "画面録画",
      symbol: "●", onSelect: onRecord, locked: availability === "upgrade" }]),
    ...(outbox ? [{ id: "outbox", label: "送信待ち", symbol: "↑", onSelect: onOutbox }] : []),
  ];
}
