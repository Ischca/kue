import type { KueFinding } from "./types";

/** "issue" creates an Issue now; "add" keeps the finding in the on-device draft without sending. */
export type FindingAction = "issue" | "add";

/** One draft holds every collected finding, so Create Issue includes them all and confirms the title first. */
export function planFindingAction(action: FindingAction, collected: number): "submit" | "collect" | "collect-and-review" {
  if (action === "add") return "collect";
  return collected > 0 ? "collect-and-review" : "submit";
}

/** KUE Cloud always creates an Issue. */
export const CLOUD_ACTION_LABEL = "Issueを作る";
/** Only for untyped callers: the types require `submitLabel` with a custom handler. */
export const FALLBACK_ACTION_LABEL = "送信";

/** Labels follow where each submission goes: a lone finding and a confirmed group can differ. */
export function actionLabels({ cloud, onSubmit, onSubmitGroup, submitLabel }: {
  cloud?: unknown; onSubmit?: unknown; onSubmitGroup?: unknown; submitLabel?: string;
}): { singleLabel: string; groupLabel: string; groupToCloud: boolean; missingLabel: boolean } {
  const custom = submitLabel?.trim() || FALLBACK_ACTION_LABEL;
  const groupToCloud = !!cloud && !onSubmit && !onSubmitGroup;
  return {
    singleLabel: cloud && !onSubmit ? CLOUD_ACTION_LABEL : custom,
    groupLabel: groupToCloud ? CLOUD_ACTION_LABEL : custom,
    groupToCloud,
    missingLabel: !!(onSubmit || onSubmitGroup) && !submitLabel?.trim(),
  };
}

/** The finding screen's main action; with collected findings it covers them all. */
export function findingActionLabel(singleLabel: string, groupLabel: string, collected: number): string {
  return collected > 0 ? `${groupLabel}（${collected + 1}件）` : singleLabel;
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
export function closedDraftNotice(draft: DraftState): string | undefined {
  if (draft?.locked) return "保存した指摘の送信結果が確定していないため、この指摘は単独で送ります。保存した指摘を開いて再送しても、この指摘は消えません。";
  if (draft?.full) return "指摘がすでに10件保存されているため、この指摘は単独で送ります。保存した指摘を開いても、この指摘は消えません。";
  return undefined;
}

/** The first finding's first memo line, within the 200-character group title limit. */
export function defaultIssueTitle(findings: readonly Pick<KueFinding, "memo">[]): string {
  const line = findings[0]?.memo.split(/\r?\n/u).map(part => part.trim()).find(Boolean) ?? "";
  return Array.from(line).slice(0, 200).join("");
}
