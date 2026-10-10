import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KueLocalReport, KueProps } from "../src/types";

// Small hook host, as in KueTrigger.test: Kue's own hooks run for real, and child
// screens are driven through the props Kue passes to them.
const host = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], dirty: false }));
const mocks = vi.hoisted(() => ({ captures: 0, open: undefined as undefined | (() => Promise<void>), submitKueReport: undefined as any, submitKueReportGroup: undefined as any, features: undefined as any,
  platform: "ios", languages: undefined as unknown }));
vi.mock("react", () => {
  const same = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const i = host.cursor++, old = host.slots[i];
    if (!old || !same(old.deps, deps)) host.slots[i] = { deps, value: fn() };
    return host.slots[i].value;
  };
  return {
    useState: (initial: unknown) => {
      const i = host.cursor++;
      host.slots[i] ??= { value: initial };
      return [host.slots[i].value, (next: any) => {
        const value = typeof next === "function" ? next(host.slots[i].value) : next;
        if (!Object.is(value, host.slots[i].value)) { host.slots[i].value = value; host.dirty = true; }
      }];
    },
    useRef: (initial: unknown) => { const i = host.cursor++; return host.slots[i] ??= { current: initial }; },
    useMemo: memo, useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps), useContext: () => null,
    useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => {
      const i = host.cursor++, old = host.slots[i];
      if (!old || !same(old.deps, deps)) {
        host.slots[i] = { deps, cleanup: old?.cleanup };
        host.effects.push(() => { host.slots[i].cleanup?.(); host.slots[i].cleanup = fn(); });
      }
    },
  };
});
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() }, Linking: { openURL: async () => undefined }, Platform: { get OS() { return mocks.platform; } },
  Settings: { get: (key: string) => (key === "AppleLanguages" ? mocks.languages : undefined) },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (v: unknown) => v, absoluteFill: {} }, View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal",
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaInsetsContext: {}, SafeAreaProvider: "SafeAreaProvider" }));
vi.mock("../src/capture", () => ({
  captureCurrentScreen: async () => ({ uri: `file:///capture-${++mocks.captures}.png`, width: 10, height: 10, mimeType: "image/png", capturedAt: "2026-10-10T00:00:00.000Z" }),
  releaseTemporaryImage: () => undefined, waitForFrames: async () => undefined,
}));
vi.mock("../src/cloud", () => ({
  getKueProjectFeatures: async () => mocks.features,
  normalizeKueCloudConfig: (cloud: { apiBaseUrl: string }) => ({ endpoint: `${cloud.apiBaseUrl}/v1/reports` }),
  submitKueReport: (...args: unknown[]) => mocks.submitKueReport(...args), submitKueReportGroup: (...args: unknown[]) => mocks.submitKueReportGroup(...args),
}));
vi.mock("../src/groupDraftStorage", async () => {
  const { GroupDraft } = await import("../src/groupDraft");
  return { createGroupDraft: () => new GroupDraft({ copy: report => ({ report, bytes: 1 }), release: () => undefined }), removeOrphanedGroupDrafts: () => undefined };
});
vi.mock("../src/context", () => ({ createReportContext: () => ({}) }));
vi.mock("../src/controller", () => ({ registerKueHost: (open: () => Promise<void>) => { mocks.open = open; return () => undefined; } }));
vi.mock("../src/recording", () => ({ nativeRecordingAvailable: () => true }));
vi.mock("../src/outbox", () => ({ retryPendingKueReports: async () => undefined, submitWithOutbox: async () => undefined }));
vi.mock("../src/triggerSubscriptions", () => ({ subscribeTriggers: () => () => undefined }));
vi.mock("../src/KueTrigger", () => ({ KueTrigger: "KueTrigger" }));
vi.mock("../src/Reporter", () => ({ Reporter: "Reporter" }));
vi.mock("../src/GroupReview", () => ({ GroupReview: "GroupReview" }));
vi.mock("../src/RecordingFlow", () => ({ RecordingFlow: "RecordingFlow" }));
vi.mock("../src/OutboxView", () => ({ OutboxView: "OutboxView" }));

import { Kue } from "../src/Kue";

const cloud = { apiBaseUrl: "https://kue.example.test", projectKey: "pk_test_example" };
const elements = (node: any): any[] => !node || typeof node !== "object" ? []
  : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];

function mount(props: Partial<KueProps> = {}) {
  host.slots = []; host.effects = [];
  let tree: any;
  const render = () => {
    let runs = 0;
    do {
      if (++runs > 20) throw new Error("Unstable hook render");
      host.dirty = false; host.cursor = 0;
      tree = Kue({ enabled: true, cloud, locale: "ja", ...props } as KueProps);
      host.effects.splice(0).forEach(effect => effect());
    } while (host.dirty);
  };
  render();
  const screen = (type: string) => elements(tree).find(node => node.type === type || node.type?.name === type);
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); render(); };
  /** Captures through the floating button, or through reportIssue() when the button is hidden. */
  const capture = async () => {
    if (props.floatingButton === false) void mocks.open!().catch(() => undefined);
    else screen("KueTrigger").props.onPress();
    await settle();
  };
  const finish = async (memo: string, action: "add" | "issue") => {
    const reporter = screen("Reporter");
    const report: KueLocalReport = { clientReportId: `report-${memo}`, memo, crop: { x: 0, y: 0, width: 1, height: 1 },
      screenshot: { uri: reporter.props.capture.uri, width: 10, height: 10, mimeType: "image/png" }, sourceSize: { width: 10, height: 10 },
      context: {} as KueLocalReport["context"], capturedAt: "2026-10-10T00:00:00.000Z" };
    await reporter.props.onSubmit(report, action);
    reporter.props.onSubmitted(report);
    await settle();
  };
  const saveFindings = async (count: number) => {
    for (let index = 1; index <= count; index++) { await capture(); await finish(`保存${index}`, "add"); }
  };
  return { screen, render, settle, capture, finish, saveFindings };
}

beforeEach(() => {
  mocks.captures = 0; mocks.open = undefined; mocks.features = { recording: { entitled: true, available: true } };
  mocks.platform = "ios"; mocks.languages = undefined;
  mocks.submitKueReport = vi.fn(async () => ({ reportId: "receipt" }));
  mocks.submitKueReportGroup = vi.fn(async () => ({ reportId: "group" }));
});

describe("tapping KUE while the saved draft cannot take another finding", () => {
  it("still captures and sends the new finding alone, keeping the 10 saved findings in the menu", async () => {
    const view = mount();
    await view.saveFindings(10);
    expect(view.screen("KueTrigger").props).toMatchObject({ visible: true, count: 10 });

    await view.capture();
    const reporter = view.screen("Reporter");
    expect(reporter.props.capture).toMatchObject({ uri: "file:///capture-11.png" });
    expect(reporter.props).toMatchObject({ canCollect: false, collectedCount: 0, singleLabel: "Issueを作る" });
    expect(reporter.props.notice).toMatch(/10件保存.*単独で送ります/u);
    expect(reporter.props.onOpenSaved).toEqual(expect.any(Function));
    expect(view.screen("GroupReview").props.visible).toBe(false);

    await view.finish("単独", "issue");
    expect(mocks.submitKueReport).toHaveBeenCalledOnce();
    expect(mocks.submitKueReport.mock.calls[0][0]).toMatchObject({ memo: "単独" });
    expect(view.screen("Reporter").props.capture).toBeNull();
    expect(view.screen("KueTrigger").props.count).toBe(10);
    expect(view.screen("KueTrigger").props.actions.map((action: { label: string }) => action.label)).toContain("Issueを作る（10件）");
  });

  it("treats a draft whose send result is unknown the same way, and keeps its resend in the menu", async () => {
    const view = mount();
    await view.saveFindings(2);
    view.screen("KueTrigger").props.actions.find((action: { id: string }) => action.id === "issue").onSelect();
    view.render();
    mocks.submitKueReportGroup = vi.fn(async () => { throw new Error("通信が切れました"); });
    await expect(view.screen("GroupReview").props.onSubmit("カートの不具合")).rejects.toThrow("通信が切れました");
    view.screen("GroupReview").props.onClose();
    view.render();

    await view.capture();
    expect(view.screen("Reporter").props).toMatchObject({ canCollect: false, collectedCount: 0 });
    expect(view.screen("Reporter").props.notice).toMatch(/送信結果が確定していない.*再送しても、この指摘は消えません。$/u);
    await view.finish("単独", "issue");
    expect(mocks.submitKueReport).toHaveBeenCalledOnce();
    expect(view.screen("KueTrigger").props.actions.map((action: { label: string }) => action.label)).toContain("Issueを作る（2件）");
  });

  it("collects as usual while the draft has room", async () => {
    const view = mount();
    await view.saveFindings(9);
    await view.capture();
    expect(view.screen("Reporter").props).toMatchObject({ canCollect: true, collectedCount: 9, notice: undefined, onOpenSaved: undefined });
  });

  it("captures through reportIssue() too when the floating button is hidden", async () => {
    const view = mount({ floatingButton: false });
    await view.saveFindings(10);
    await view.capture();
    expect(view.screen("Reporter").props).toMatchObject({ capture: { uri: "file:///capture-11.png" }, canCollect: false, hidden: false });
    expect(view.screen("Reporter").props.onOpenSaved).toEqual(expect.any(Function));
    expect(view.screen("GroupReview").props.visible).toBe(false);
  });
});

describe("opening the saved findings from the finding screen", () => {
  async function openFromFullDraft() {
    const view = mount({ floatingButton: false });
    await view.saveFindings(10);
    await view.capture();
    view.screen("Reporter").props.onOpenSaved();
    view.render();
    return view;
  }

  it("keeps the finding behind the confirmation, and lets it join once the draft has room", async () => {
    const view = await openFromFullDraft();
    expect(view.screen("Reporter").props).toMatchObject({ hidden: true, capture: { uri: "file:///capture-11.png" } });
    const review = view.screen("GroupReview").props;
    expect(review.visible).toBe(true);
    review.draft.remove(review.draft.findings[0].clientReportId);
    review.onChanged();
    review.onClose();
    view.render();
    expect(view.screen("GroupReview").props.visible).toBe(false);
    expect(view.screen("Reporter").props).toMatchObject({ hidden: false, capture: { uri: "file:///capture-11.png" },
      canCollect: true, collectedCount: 9, notice: undefined, onOpenSaved: undefined });
    await view.finish("11件目", "add");
    expect(view.screen("KueTrigger").props.count).toBe(10);
  });

  it("returns to the finding without a draft once the saved findings are sent", async () => {
    const view = await openFromFullDraft();
    await view.screen("GroupReview").props.onSubmit("まとめた指摘");
    view.render();
    expect(mocks.submitKueReportGroup).toHaveBeenCalledOnce();
    expect(view.screen("Reporter").props).toMatchObject({ hidden: false, capture: { uri: "file:///capture-11.png" },
      canCollect: true, collectedCount: 0, notice: undefined });
    await view.finish("新しい指摘", "issue");
    expect(mocks.submitKueReport).toHaveBeenCalledOnce();
  });
});

describe("long-press menu names", () => {
  it("keeps the known plan while the menu opens again, so the recording name stays the same", async () => {
    mocks.features = { recording: { entitled: false, available: true } };
    const view = mount();
    const trigger = () => view.screen("KueTrigger").props;
    const recordingName = () => trigger().actions.find((action: { id: string }) => action.id === "recording")?.label;
    trigger().onMenuVisibilityChange(true); view.render();
    expect(recordingName()).toBe("画面録画");
    await view.settle();
    expect(recordingName()).toBe("画面録画 · Indieで解放");
    trigger().onMenuVisibilityChange(false); view.render();
    trigger().onMenuVisibilityChange(true); view.render();
    expect(recordingName()).toBe("画面録画 · Indieで解放");
  });
});

describe("screen recording in the long-press menu", () => {
  const menu = (props: Record<string, unknown>) => mount(props as Partial<KueProps>).screen("KueTrigger").props;
  it("is offered only where a recording can be sent: Cloud, with onSubmitGroup next to a custom onSubmit", () => {
    const ids = (props: Record<string, unknown>) => menu(props).actions.map((action: { id: string }) => action.id);
    const handler = vi.fn();
    expect(ids({})).toEqual(["recording"]);
    expect(ids({ onSubmit: handler, onSubmitGroup: handler, submitLabel: "保存" })).toEqual(["recording"]);
    expect(ids({ cloud: undefined, onSubmit: handler, submitLabel: "保存" })).toEqual([]);
    expect(ids({ cloud: undefined, onSubmit: handler, onSubmitGroup: handler, submitLabel: "保存" })).toEqual([]);
    expect(ids({ onSubmit: handler, submitLabel: "保存" })).toEqual([]);
  });
  it("leaves a hold to capture like a tap when nothing else is in the menu", () => {
    expect(menu({ cloud: undefined, onSubmit: vi.fn(), submitLabel: "保存" }).onLongPress).toBeUndefined();
    expect(menu({}).onLongPress).toEqual(expect.any(Function));
  });
});

describe("screen recording from the long-press menu", () => {
  const recordAction = (view: ReturnType<typeof mount>) =>
    view.screen("KueTrigger").props.actions.find((action: { id: string }) => action.id === "recording");
  /** Opens the radial menu; the returned release closes it before running the action, as KueTrigger does. */
  async function openRadialMenu(view: ReturnType<typeof mount>) {
    view.screen("KueTrigger").props.onMenuVisibilityChange(true);
    view.render();
    await view.settle();
    const action = recordAction(view), trigger = view.screen("KueTrigger").props;
    return () => { trigger.onMenuVisibilityChange(false); action.onSelect(); };
  }

  it("starts recording chosen from the radial menu", async () => {
    const view = mount();
    (await openRadialMenu(view))();
    await view.settle();
    expect(view.screen("RecordingFlow")).toBeDefined();
  });

  it("does not start recording when a capture began during the plan check", async () => {
    const view = mount();
    const release = await openRadialMenu(view);
    release();
    view.screen("KueTrigger").props.onPress();
    await view.settle();
    expect(view.screen("RecordingFlow")).toBeUndefined();
    expect(view.screen("Reporter").props.capture).toMatchObject({ uri: "file:///capture-1.png" });
  });

  it("starts recording chosen from the list, unless the list was closed during the plan check", async () => {
    const view = mount();
    view.screen("KueTrigger").props.onLongPress();
    view.render();
    await view.settle();
    recordAction(view).onSelect();
    await view.settle();
    expect(view.screen("RecordingFlow")).toBeDefined();

    const closed = mount();
    closed.screen("KueTrigger").props.onLongPress();
    closed.render();
    await closed.settle();
    recordAction(closed).onSelect();
    closed.screen("CaptureActions").props.onClose();
    await closed.settle();
    expect(closed.screen("RecordingFlow")).toBeUndefined();
  });
});

describe("display language", () => {
  const actionLabels = (view: ReturnType<typeof mount>) => view.screen("KueTrigger").props.actions.map((action: { label: string }) => action.label);

  it("shows the English screens, menu and errors when locale is en", async () => {
    const view = mount({ locale: "en" });
    expect(view.screen("Reporter").props).toMatchObject({ singleLabel: "Create Issue", groupLabel: "Create Issue" });
    expect(view.screen("Reporter").props.text.finding.add).toBe("Add finding");
    expect(view.screen("GroupReview").props.text.review.back).toBe("Back");
    await view.saveFindings(10);
    expect(actionLabels(view)).toEqual(["Create Issue (10)", "Screen recording"]);
    await view.capture();
    expect(view.screen("Reporter").props.notice).toBe("10 findings are already saved, so this finding is sent on its own. Opening the saved findings keeps this finding.");
    // Errors raised by the draft follow the screens.
    const { currentKueText } = await import("../src/i18n");
    expect(currentKueText().errors.draftFull).toBe("Up to 10 findings can be sent at once.");
  });

  it("follows the device's preferred languages when locale is not set", () => {
    mocks.languages = ["ja-JP", "en-JP"];
    expect(mount({ locale: undefined }).screen("Reporter").props.singleLabel).toBe("Issueを作る");
    mocks.languages = ["en-US"];
    expect(mount({ locale: undefined }).screen("Reporter").props.singleLabel).toBe("Create Issue");
    mocks.languages = ["en-US"];
    expect(mount({ locale: "ja" }).screen("Reporter").props.singleLabel).toBe("Issueを作る");
  });

  it("keeps an app's submitLabel as written in either language", () => {
    const handler = vi.fn();
    const view = mount({ locale: "en", cloud: undefined, onSubmit: handler, submitLabel: "保存" } as Partial<KueProps>);
    expect(view.screen("Reporter").props).toMatchObject({ singleLabel: "保存", groupLabel: "保存" });
  });
});
