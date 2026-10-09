import { describe, expect, it } from "vitest";
import { canOpenHeldMenu, layoutRadialMenu, MENU_BUTTON_SIZE, radialSelection } from "../src/radialMenu";
import { beginTriggerGesture, moveTriggerGesture, TRIGGER_SIZE } from "../src/triggerPosition";

describe("safe-area radial menu", () => {
  it.each([[320, 480], [390, 740], [740, 300], [280, 420], [768, 1024]])("fits every button position in %sx%s without overlapping actions", (width, height) => {
    for (const count of [3, 4, 5]) for (let x = TRIGGER_SIZE / 2; x <= width - TRIGGER_SIZE / 2; x += (width - TRIGGER_SIZE) / 8) {
      for (let y = TRIGGER_SIZE / 2; y <= height - TRIGGER_SIZE / 2; y += (height - TRIGGER_SIZE) / 8) {
        const layout = layoutRadialMenu({ x, y }, { width, height }, count);
        expect(layout, `position ${x},${y}; ${count} actions`).not.toBeNull();
        expect(layout!.origin).toEqual({ x, y });
        for (const [index, p] of layout!.items.entries()) {
          expect(p.x - MENU_BUTTON_SIZE / 2).toBeGreaterThanOrEqual(0);
          expect(p.y - MENU_BUTTON_SIZE / 2).toBeGreaterThanOrEqual(0);
          expect(p.x + MENU_BUTTON_SIZE / 2).toBeLessThanOrEqual(width);
          expect(p.y + MENU_BUTTON_SIZE / 2).toBeLessThanOrEqual(height);
          for (const q of layout!.items.slice(index + 1)) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(55.99);
          expect(radialSelection(layout!, p)).toBe(index);
        }
        expect(layout!.label.x).toBeGreaterThanOrEqual(0);
        expect(layout!.label.y).toBeGreaterThanOrEqual(0);
        expect(layout!.label.x + layout!.label.width).toBeLessThanOrEqual(width);
        expect(layout!.label.y + layout!.label.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it("cancels at the origin and outside the fan instead of guessing an action", () => {
    const layout = layoutRadialMenu({ x: 180, y: 240 }, { width: 390, height: 740 }, 5)!;
    expect(radialSelection(layout, layout.origin)).toBeNull();
    expect(radialSelection(layout, { x: -100, y: -100 })).toBeNull();
    expect(radialSelection(layout, { x: 1000, y: 1000 })).toBeNull();
  });

  it("uses the list fallback when the host is too small instead of clipping", () => {
    expect(layoutRadialMenu({ x: 27, y: 27 }, { width: 100, height: 100 }, 5)).toBeNull();
    expect(layoutRadialMenu({ x: 27, y: 27 }, { width: 320, height: 480 }, 0)).toBeNull();
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
