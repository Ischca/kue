import { describe, expect, it, vi } from "vitest";
import { captureActionList } from "../src/captureActionList";
import { actionLabels, closedDraftNotice, defaultIssueTitle, draftAccepts, findingActionLabel, joinedFindings, planFindingAction } from "../src/issueFlow";

describe("finding actions", () => {
  it("sends a lone finding at once and routes collected findings through the confirmation", () => {
    expect(planFindingAction("issue", 0)).toBe("submit");
    expect(planFindingAction("issue", 2)).toBe("collect-and-review");
    expect(planFindingAction("add", 0)).toBe("collect");
    expect(planFindingAction("add", 9)).toBe("collect");
  });
  it("labels the main action with the total including the current finding", () => {
    expect(findingActionLabel("Issueを作る", "Issueを作る", 0)).toBe("Issueを作る");
    expect(findingActionLabel("Issueを作る", "Issueを作る", 2)).toBe("Issueを作る（3件）");
    expect(findingActionLabel("Issueを作る", "Slackに送る", 1)).toBe("Slackに送る（2件）");
  });
});

describe("action labels", () => {
  const cloud = { apiBaseUrl: "https://kue.example.test", projectKey: "pk_test_example" };
  const handler = () => undefined;
  it("keeps Create Issue only where KUE Cloud receives the submission", () => {
    expect(actionLabels({ cloud })).toEqual({ singleLabel: "Issueを作る", groupLabel: "Issueを作る", groupToCloud: true, missingLabel: false });
    expect(actionLabels({ cloud, onSubmitGroup: handler, submitLabel: "Slackに送る" }))
      .toEqual({ singleLabel: "Issueを作る", groupLabel: "Slackに送る", groupToCloud: false, missingLabel: false });
  });
  it("uses the app's label wherever its handler receives the submission", () => {
    expect(actionLabels({ onSubmit: handler, submitLabel: " 保存 " }))
      .toEqual({ singleLabel: "保存", groupLabel: "保存", groupToCloud: false, missingLabel: false });
    expect(actionLabels({ cloud, onSubmit: handler, onSubmitGroup: handler, submitLabel: "保存" }))
      .toMatchObject({ singleLabel: "保存", groupLabel: "保存", groupToCloud: false });
  });
  it("falls back to a neutral label for untyped callers and reports the missing label", () => {
    expect(actionLabels({ onSubmit: handler })).toEqual({ singleLabel: "送信", groupLabel: "送信", groupToCloud: false, missingLabel: true });
    expect(actionLabels({ cloud, onSubmitGroup: handler, submitLabel: "  " })).toMatchObject({ groupLabel: "送信", missingLabel: true });
    expect(actionLabels({})).toEqual({ singleLabel: "送信", groupLabel: "送信", groupToCloud: false, missingLabel: false });
  });
});

describe("findings while the saved draft cannot take them", () => {
  const draft = (count: number, locked = false) => ({ locked, full: count >= 10, findings: Array.from({ length: count }) });
  it("joins an open draft, and sends the new finding alone when the draft is full or unconfirmed", () => {
    expect(joinedFindings(null)).toBe(0);
    expect(joinedFindings(draft(3))).toBe(3);
    expect(planFindingAction("issue", joinedFindings(draft(3)))).toBe("collect-and-review");
    expect([joinedFindings(draft(10)), joinedFindings(draft(2, true))]).toEqual([0, 0]);
    expect(planFindingAction("issue", joinedFindings(draft(10)))).toBe("submit");
    expect([draftAccepts(draft(9)), draftAccepts(draft(10)), draftAccepts(draft(2, true))]).toEqual([true, false, false]);
  });
  it("tells why the finding goes alone and that opening the saved findings keeps it", () => {
    expect(closedDraftNotice(draft(9))).toBeUndefined();
    expect(closedDraftNotice(draft(10))).toMatch(/10件保存.*単独で送ります。保存した指摘を開いても、この指摘は消えません。$/u);
    expect(closedDraftNotice(draft(10, true))).toMatch(/送信結果が確定していない.*単独で送ります。保存した指摘を開いて再送しても、この指摘は消えません。$/u);
  });
});

describe("default Issue title", () => {
  it("uses the first non-empty line of the first finding", () => {
    expect(defaultIssueTitle([{ memo: "\n  カートのボタンが狭い  \n詳細" }, { memo: "二件目" }])).toBe("カートのボタンが狭い");
    expect(defaultIssueTitle([])).toBe("");
  });
  it("stays within the 200-character group title limit without splitting characters", () => {
    const title = defaultIssueTitle([{ memo: "😀".repeat(250) }]);
    expect(Array.from(title)).toHaveLength(200);
    expect(title).toBe("😀".repeat(200));
  });
});

describe("long-press menu", () => {
  const options = () => ({ groupLabel: "Issueを作る", onCreateIssue: vi.fn(), onRecord: vi.fn(), onOutbox: vi.fn() });
  it("holds only what a tap cannot do: saved findings, recording and pending reports", () => {
    expect(captureActionList({ groupCount: 0, recording: "auto", availability: "ready", outbox: false, ...options() }).map(a => a.id))
      .toEqual(["recording"]);
    const actions = captureActionList({ groupCount: 3, recording: "auto", availability: "ready", outbox: true, ...options() });
    expect(actions.map(a => a.id)).toEqual(["issue", "recording", "outbox"]);
    expect(actions.find(a => a.id === "issue")?.label).toBe("Issueを作る（3件）");
    expect(captureActionList({ groupCount: 2, recording: "auto", availability: "ready", outbox: false, ...options(), groupLabel: "Slackに送る" })
      .find(a => a.id === "issue")?.label).toBe("Slackに送る（2件）");
  });
  it("submits collected findings without capturing a new one", () => {
    const h = options();
    captureActionList({ groupCount: 2, recording: "auto", availability: "ready", outbox: false, ...h }).find(a => a.id === "issue")?.onSelect();
    expect(h.onCreateIssue).toHaveBeenCalledOnce();
    expect(h.onRecord).not.toHaveBeenCalled();
  });
  it("hides recording an app turned off, but keeps the Indie lock that shows Free users the feature", () => {
    expect(captureActionList({ groupCount: 0, recording: "off", availability: "off", outbox: false, ...options() })).toEqual([]);
    expect(captureActionList({ groupCount: 1, recording: "off", availability: "off", outbox: true, ...options() }).map(a => a.id)).toEqual(["issue", "outbox"]);
    const locked = captureActionList({ groupCount: 0, recording: "auto", availability: "upgrade", outbox: false, ...options() });
    expect(locked).toMatchObject([{ id: "recording", label: "画面録画 · Indieで解放", locked: true }]);
  });
});
