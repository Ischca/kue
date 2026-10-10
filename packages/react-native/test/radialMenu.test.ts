import { describe, expect, it } from "vitest";
import { canOpenHeldMenu, layoutRadialMenu, MENU_BUTTON_SIZE, menuLabelWidth, radialSelection, type Point, type RadialLayout, type Rect } from "../src/radialMenu";
import { beginTriggerGesture, moveTriggerGesture, TRIGGER_SIZE } from "../src/triggerPosition";

// The longest names the SDK shows today in each language; an app's submitLabel may be longer still.
const names = ["Issueを作る（10件）", "画面録画 · Indieで解放", "送信待ち"];
const englishNames = ["Create Issue (10)", "Screen recording · Indie", "Pending reports"];
const EDGE = 8;
const middle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const square = (p: Point, size: number): Rect => ({ x: p.x - size / 2, y: p.y - size / 2, width: size, height: size });
const apart = (a: Rect, b: Rect) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
function grid(width: number, height: number): Point[] {
  const points: Point[] = [];
  for (let x = TRIGGER_SIZE / 2; x <= width - TRIGGER_SIZE / 2 + 0.01; x += (width - TRIGGER_SIZE) / 8) {
    for (let y = TRIGGER_SIZE / 2; y <= height - TRIGGER_SIZE / 2 + 0.01; y += (height - TRIGGER_SIZE) / 8) points.push({ x, y });
  }
  return points;
}

/** Nothing clipped or covered, and every button and name selects its own action. */
function expectUsable(layout: RadialLayout, width: number, height: number, where: string) {
  const buttons = layout.items.map(p => square(p, MENU_BUTTON_SIZE));
  for (const rect of [...buttons, ...layout.labels]) {
    expect(rect.x, where).toBeGreaterThanOrEqual(EDGE);
    expect(rect.y, where).toBeGreaterThanOrEqual(EDGE);
    expect(rect.x + rect.width, where).toBeLessThanOrEqual(width - EDGE);
    expect(rect.y + rect.height, where).toBeLessThanOrEqual(height - EDGE);
  }
  // Names never touch a button's box or the trigger square, which also covers its count badge.
  const shapes = [square(layout.origin, TRIGGER_SIZE), ...layout.labels];
  for (const label of layout.labels) {
    for (const other of [...shapes.filter(shape => shape !== label), ...buttons]) expect(apart(label, other), where).toBe(true);
  }
  // Round buttons stay one spacing apart and clear of the trigger square.
  layout.items.forEach((p, index) => {
    expect(apart(buttons[index]!, shapes[0]!), where).toBe(true);
    layout.items.slice(index + 1).forEach(q => expect(Math.hypot(p.x - q.x, p.y - q.y), where).toBeGreaterThanOrEqual(55.99));
  });
  layout.items.forEach((p, index) => {
    expect(radialSelection(layout, p), where).toBe(index);
    expect(radialSelection(layout, middle(layout.labels[index]!)), where).toBe(index);
  });
  expect(radialSelection(layout, layout.origin), where).toBeNull();
}

describe("long-press menu layout", () => {
  it.each([[375, 600], [390, 740], [430, 830], [768, 1024]])("names every action in one tidy column of labels on a %sx%s portrait surface", (width, height) => {
    for (const set of [names, englishNames]) for (const count of [1, 2, 3]) for (const origin of grid(width, height)) {
      const where = `${set[0]} ×${count} at ${Math.round(origin.x)},${Math.round(origin.y)}`;
      const layout = layoutRadialMenu(origin, { width, height }, set.slice(0, count));
      expect(layout, where).not.toBeNull();
      expectUsable(layout!, width, height, where);
      const leftOfButton = layout!.labels.map((rect, index) => rect.x + rect.width <= layout!.items[index]!.x);
      expect(new Set(leftOfButton).size, where).toBe(1);
      layout!.labels.forEach((rect, index) => expect(middle(rect).y, where).toBeCloseTo(layout!.items[index]!.y, 5));
    }
  });

  it.each([[740, 300], [844, 350], [320, 480], [280, 420]])("never returns a partial layout on a landscape or small %sx%s surface", (width, height) => {
    for (const count of [1, 2, 3, 4, 5]) for (const origin of grid(width, height)) {
      // The layout accepts up to five actions, more than KUE shows today.
      const layout = layoutRadialMenu(origin, { width, height }, [...names, "保存した指摘", "設定"].slice(0, count));
      if (layout) expectUsable(layout, width, height, `${count} actions at ${Math.round(origin.x)},${Math.round(origin.y)}`);
    }
    // Landscape phones still get the menu for every action KUE shows today, in either language.
    if (width > height) for (const set of [names, englishNames]) for (const origin of grid(width, height)) {
      const layout = layoutRadialMenu(origin, { width, height }, set);
      expect(layout).not.toBeNull();
      expectUsable(layout!, width, height, `${set[0]} at ${Math.round(origin.x)},${Math.round(origin.y)}`);
    }
  });

  it("narrows a long app-provided label instead of falling back to the list", () => {
    const long = "社内の不具合管理システムに登録する（10件）";
    expect(menuLabelWidth(long)).toBeGreaterThan(390 * 0.6);
    for (const origin of [{ x: 363, y: 713 }, { x: 27, y: 713 }, { x: 195, y: 370 }, { x: 363, y: 27 }]) {
      const layout = layoutRadialMenu(origin, { width: 390, height: 740 }, [long, names[1]!, names[2]!]);
      expect(layout).not.toBeNull();
      expectUsable(layout!, 390, 740, `${origin.x},${origin.y}`);
      expect(layout!.labels[0]!.width).toBeLessThanOrEqual(Math.floor(390 * 0.6));
    }
  });

  it("keeps the buttons a short slide from the trigger and next to each other", () => {
    const layout = layoutRadialMenu({ x: 347, y: 701 }, { width: 390, height: 740 }, names.slice(0, 3))!;
    const distances = layout.items.map(p => Math.hypot(p.x - 347, p.y - 701));
    expect(Math.min(...distances)).toBeLessThanOrEqual(64.01);
    layout.items.slice(1).forEach((p, index) => expect(Math.hypot(p.x - layout.items[index]!.x, p.y - layout.items[index]!.y)).toBeCloseTo(56, 5));
  });

  it("lets a button's circle win, then a name, then the nearest button within reach", () => {
    const layout: RadialLayout = { origin: { x: 300, y: 700 }, items: [{ x: 300, y: 600 }, { x: 300, y: 544 }],
      labels: [{ x: 150, y: 585, width: 120, height: 30 }, { x: 326, y: 585, width: 60, height: 30 }] };
    expect(radialSelection(layout, { x: 320, y: 600 })).toBe(0);
    expect(radialSelection(layout, { x: 328, y: 600 })).toBe(1);
    expect(radialSelection(layout, { x: 300, y: 573 })).toBe(0);
    expect(radialSelection(layout, { x: 300, y: 690 })).toBeNull();
    expect(radialSelection(layout, { x: -100, y: -100 })).toBeNull();
  });

  it("uses the list fallback when the host is too small instead of clipping", () => {
    expect(layoutRadialMenu({ x: 27, y: 27 }, { width: 100, height: 100 }, names)).toBeNull();
    expect(layoutRadialMenu({ x: 27, y: 27 }, { width: 320, height: 480 }, [])).toBeNull();
  });

  it("does not open after a drag returns to the starting point", () => {
    const gesture = beginTriggerGesture({ x: 100, y: 100, edge: null });
    expect(canOpenHeldMenu(gesture, false, 1)).toBe(true);
    moveTriggerGesture(gesture, 10, 0, 1, { width: 390, height: 740 });
    moveTriggerGesture(gesture, 0, 0, 1, { width: 390, height: 740 });
    expect(canOpenHeldMenu(gesture, false, 1)).toBe(false);
  });

  it("does not open while recording, multitouch or after cancellation", () => {
    const state = { dragged: false, cancelled: false };
    expect(canOpenHeldMenu(state, true, 1)).toBe(false);
    expect(canOpenHeldMenu(state, false, 2)).toBe(false);
    expect(canOpenHeldMenu({ ...state, cancelled: true }, false, 1)).toBe(false);
  });
});
