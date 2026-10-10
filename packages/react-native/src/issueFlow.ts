import type { KueText } from "./i18n";
import type { KueFinding } from "./types";

/** "issue" creates an Issue now; "add" keeps the finding in the on-device draft without sending. */
export type FindingAction = "issue" | "add";

/** One draft holds every collected finding, so Create Issue includes them all and confirms the title first. */
export function planFindingAction(action: FindingAction, collected: number): "submit" | "collect" | "collect-and-review" {
  if (action === "add") return "collect";
  return collected > 0 ? "collect-and-review" : "submit";
}

/** Labels follow where each submission goes: a lone finding and a confirmed group can differ. */
export function actionLabels({ cloud, onSubmit, onSubmitGroup, submitLabel }: {
  cloud?: unknown; onSubmit?: unknown; onSubmitGroup?: unknown; submitLabel?: string;
}, text: KueText): { singleLabel: string; groupLabel: string; groupToCloud: boolean; missingLabel: boolean } {
  const custom = submitLabel?.trim() || text.send;
  const groupToCloud = !!cloud && !onSubmit && !onSubmitGroup;
  return {
    singleLabel: cloud && !onSubmit ? text.createIssue : custom,
    groupLabel: groupToCloud ? text.createIssue : custom,
    groupToCloud,
    missingLabel: !!(onSubmit || onSubmitGroup) && !submitLabel?.trim(),
  };
}

/** The finding screen's main action; with collected findings it covers them all. */
export function findingActionLabel(singleLabel: string, groupLabel: string, collected: number, text: KueText): string {
  return collected > 0 ? text.count(groupLabel, collected + 1) : singleLabel;
}

type DraftState = { locked: boolean; full: boolean; findings: readonly unknown[] } | null | undefined;

/** A full draft, or one whose send result is unknown, cannot take another finding; a new capture is
 * still taken and sent on its own, so tapping KUE always captures. */
export function draftAccepts(draft: DraftState): boolean {
  return !draft || (!draft.locked && !draft.full);
}

/** Saved findings that a new finding joins: none when the draft cannot take it. */
export function joinedFindings(draft: DraftState): number {
  return draft && draftAccepts(draft) ? draft.findings.length : 0;
}

/** Shown above 「保存した指摘を開く」, which keeps this finding while the draft is open. */
export function closedDraftNotice(draft: DraftState, text: KueText): string | undefined {
  if (draft?.locked) return text.finding.lockedNotice;
  if (draft?.full) return text.finding.fullNotice;
  return undefined;
}

/** The first finding's first memo line, within the 200-character group title limit. */
export function defaultIssueTitle(findings: readonly Pick<KueFinding, "memo">[]): string {
  const line = findings[0]?.memo.split(/\r?\n/u).map(part => part.trim()).find(Boolean) ?? "";
  return Array.from(line).slice(0, 200).join("");
}
