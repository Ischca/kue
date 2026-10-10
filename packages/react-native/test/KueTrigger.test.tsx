import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Small hook host: drive the real PanResponder wiring and timers without a
// native renderer. Geometry tests separately cover the complete safe-area grid.
const host = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], dirty: false,
  handlers: {} as any, back: undefined as undefined | (() => boolean) }));
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
    useMemo: memo, useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
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
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: (_name: string, fn: () => boolean) => { host.back = fn; return { remove() { host.back = undefined; } }; } },
  Animated: { View: "AnimatedView", ValueXY: class {
    value = { x: 0, y: 0 };
    stopAnimation(fn?: (value: { x: number; y: number }) => void) { fn?.(this.value); }
    setValue(value: { x: number; y: number }) { this.value = value; }
    getTranslateTransform() { return [{ translateX: this.value.x }, { translateY: this.value.y }]; }
  }, timing: (point: any, options: any) => ({ start() { point.setValue(options.toValue); } }) },
  PanResponder: { create: (handlers: any) => { host.handlers = handlers; return { panHandlers: handlers }; } },
  Image: "Image", Text: "Text", View: "View", StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));

import { KueTrigger } from "../src/KueTrigger";
import { kueText } from "../src/i18n";
import { layoutRadialMenu, MENU_HOLD_MS, menuLabelWidth, type CaptureAction } from "../src/radialMenu";

function find(node: any, testID: string): any {
  if (!node || typeof node !== "object") return undefined;
  if (node.props?.testID === testID) return node;
  return [node.props?.children].flat(Infinity).map(child => find(child, testID)).find(Boolean);
}
function texts(node: any): string[] {
  if (typeof node === "string") return [node];
  if (!node || typeof node !== "object") return [];
  return [node.props?.children].flat(Infinity).flatMap(texts);
}
const pink = (node: any) => [node?.props.style].flat(Infinity).some((style: any) => style?.backgroundColor === "#DB2777");
function mount(overrides: Partial<Parameters<typeof KueTrigger>[0]> = {}) {
  const actions: CaptureAction[] = ["capture", "collect", "record"].map(id => ({ id, label: id, symbol: "+", onSelect: vi.fn() }));
  let props = { visible: true, onPress: vi.fn(), onLongPress: vi.fn(), onMenuVisibilityChange: vi.fn(), actions, text: kueText("ja"), ...overrides };
  let tree: any;
  const render = () => {
    let runs = 0;
    do {
      if (++runs > 15) throw new Error("Unstable hook render");
      host.dirty = false; host.cursor = 0; tree = KueTrigger(props);
      host.effects.splice(0).forEach(effect => effect());
    } while (host.dirty);
    return tree;
  };
  render();
  const resize = (width = 390, height = 740) => { tree.props.onLayout({ nativeEvent: { layout: { width, height } } }); render(); };
  resize();
  const start = () => { host.handlers.onPanResponderGrant({ nativeEvent: { locationX: 27, locationY: 27 } }); render(); };
  const hold = () => { vi.advanceTimersByTime(MENU_HOLD_MS); render(); };
  const move = (dx: number, dy: number, touches = 1) => { host.handlers.onPanResponderMove({}, { dx, dy, numberActiveTouches: touches }); render(); };
  const end = (dx = 0, dy = 0) => { host.handlers.onPanResponderRelease({}, { dx, dy }); render(); };
  return { actions, props, start, hold, move, end, resize, render, node: (id: string) => find(tree, id),
    update: (next: Partial<typeof props>) => { props = { ...props, ...next }; render(); } };
}

beforeEach(() => { vi.useFakeTimers(); host.slots = []; host.effects = []; host.cursor = 0; host.back = undefined; });
afterEach(() => { host.slots.forEach(slot => slot?.cleanup?.()); vi.useRealTimers(); });

describe("floating menu gesture wiring", () => {
  it("opens while held, previews the slid-to action, and executes only on release", () => {
    const ui = mount(); ui.start(); ui.hold();
    expect(ui.node("kue-radial-menu")).toBeDefined();
    const layout = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", "record"])!;
    const point = layout.items[1]!;
    // Every action is named beside its button from the start, with no instruction text.
    expect(texts(ui.node("kue-radial-menu"))).toEqual(["capture", "collect", "record"]);
    ui.move(point.x - 347, point.y - 701);
    expect(pink(ui.node("kue-radial-collect"))).toBe(true);
    expect(pink(ui.node("kue-radial-label-collect"))).toBe(true);
    expect(pink(ui.node("kue-radial-capture")) || pink(ui.node("kue-radial-label-capture"))).toBe(false);
    expect(ui.actions[1]!.onSelect).not.toHaveBeenCalled();
    ui.end(point.x - 347, point.y - 701);
    expect(ui.actions[1]!.onSelect).toHaveBeenCalledOnce();
    expect(ui.props.onPress).not.toHaveBeenCalled();
    expect(ui.node("kue-radial-menu")).toBeUndefined();
  });

  it("closes the menu before running the chosen action, which Kue relies on to start recording", () => {
    const order: string[] = [];
    const ui = mount({ onMenuVisibilityChange: vi.fn((open: boolean) => { order.push(open ? "open" : "close"); }) });
    ui.actions[2]!.onSelect = vi.fn(() => { order.push("select"); });
    ui.start(); ui.hold();
    const point = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", "record"])!.items[2]!;
    ui.end(point.x - 347, point.y - 701);
    expect(order).toEqual(["open", "close", "select"]);
  });

  it("selects an action by releasing over its name", () => {
    const ui = mount(); ui.start(); ui.hold();
    const label = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", "record"])!.labels[2]!;
    ui.end(label.x + label.width / 2 - 347, label.y + label.height / 2 - 701);
    expect(ui.actions[2]!.onSelect).toHaveBeenCalledOnce();
    expect(ui.props.onPress).not.toHaveBeenCalled();
  });

  it("places a name again when it changes while the menu is open, keeping the buttons in place", () => {
    const ui = mount(); ui.start(); ui.hold();
    const flat = (node: any) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    const buttons = () => ["capture", "collect", "record"].map(id => flat(ui.node(`kue-radial-${id}`)));
    const before = buttons();
    // The recording name grows once the plan check reports Free.
    const longer = "画面録画 · Indieで解放";
    ui.update({ actions: ui.actions.map(action => action.id === "record" ? { ...action, label: longer } : action) });
    expect(texts(ui.node("kue-radial-label-record"))).toEqual([longer]);
    expect(flat(ui.node("kue-radial-label-record")).maxWidth).toBe(menuLabelWidth(longer));
    expect(buttons()).toEqual(before);
    const label = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", longer])!.labels[2]!;
    ui.end(label.x + 4 - 347, label.y + label.height / 2 - 701);
    expect(ui.actions[2]!.onSelect).toHaveBeenCalledOnce();
  });

  it("cancels the menu when its actions change and no longer fit", () => {
    const ui = mount(); ui.start(); ui.hold();
    ui.update({ actions: Array.from({ length: 6 }, (_, index) => ({ id: `extra-${index}`, label: "extra", symbol: "+", onSelect: vi.fn() })) });
    expect(ui.node("kue-radial-menu")).toBeUndefined();
    ui.end();
    expect(ui.props.onPress).not.toHaveBeenCalled();
  });

  it("retains short tap capture and cancels a hold released at the center", () => {
    const ui = mount(); ui.start(); ui.end(); expect(ui.props.onPress).toHaveBeenCalledOnce();
    ui.start(); ui.hold(); ui.end();
    expect(ui.props.onPress).toHaveBeenCalledOnce();
    expect(ui.actions.every(action => (action.onSelect as any).mock.calls.length === 0)).toBe(true);
  });

  it("keeps early movement as a drag, even when returning before release", () => {
    const ui = mount(); ui.start(); ui.move(15, 0); ui.move(0, 0); ui.hold(); ui.end();
    expect(ui.node("kue-radial-menu")).toBeUndefined(); expect(ui.props.onPress).not.toHaveBeenCalled();
  });

  it("can slide back to cancel and never captures when the hold timer is delayed", () => {
    const ui = mount(); ui.start(); ui.hold();
    const p = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", "record"])!.items[1]!;
    ui.move(p.x - 347, p.y - 701); ui.move(0, 0); ui.end();
    expect(ui.actions[1]!.onSelect).not.toHaveBeenCalled();
    ui.start(); vi.setSystemTime(Date.now() + MENU_HOLD_MS + 100); ui.end();
    expect(ui.props.onPress).not.toHaveBeenCalled();
  });

  it.each(["multitouch", "back", "hidden", "rotation", "terminate"])("cancels safely on %s", reason => {
    const ui = mount(); ui.start(); ui.hold();
    if (reason === "multitouch") ui.move(0, 0, 2);
    if (reason === "back") { expect(host.back?.()).toBe(true); ui.render(); }
    if (reason === "hidden") ui.update({ visible: false });
    if (reason === "rotation") ui.resize(740, 300);
    if (reason === "terminate") { host.handlers.onPanResponderTerminate(); ui.render(); }
    ui.end();
    expect(ui.node("kue-radial-menu")).toBeUndefined(); expect(ui.props.onPress).not.toHaveBeenCalled();
  });

  it("does not select disabled actions but allows a locked action to explain an upgrade", () => {
    const ui = mount();
    ui.actions[1]!.disabled = true; ui.actions[2]!.locked = true;
    const layout = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, ["capture", "collect", "record"])!;
    for (const index of [1, 2]) { ui.start(); ui.hold(); const p = layout.items[index]!; ui.end(p.x - 347, p.y - 701); }
    expect(ui.actions[1]!.onSelect).not.toHaveBeenCalled(); expect(ui.actions[2]!.onSelect).toHaveBeenCalledOnce();
  });

  it("keeps recording stop independent of the hold menu", () => {
    const ui = mount({ recording: true }); ui.start(); ui.hold(); ui.end();
    expect(ui.node("kue-radial-menu")).toBeUndefined(); expect(ui.props.onPress).toHaveBeenCalledOnce();
  });

  it("cancels a pending timer when hidden and uses an accessible list in tiny windows", () => {
    const ui = mount(); ui.start(); ui.update({ visible: false }); ui.hold();
    expect(ui.node("kue-radial-menu")).toBeUndefined();
    ui.update({ visible: true }); ui.resize(100, 100); ui.start(); ui.hold(); ui.end();
    expect(ui.props.onLongPress).toHaveBeenCalledOnce(); expect(ui.props.onPress).not.toHaveBeenCalled();
  });
});
