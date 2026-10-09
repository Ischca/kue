import { describe, expect, it } from "vitest";
import {
  beginTriggerGesture, EDGE_PEEK, endTriggerGesture, fitTriggerPosition, initialTriggerPosition,
  moveTriggerGesture, revealTrigger, settleTriggerPosition, TRIGGER_SIZE,
  type TriggerBounds, type TriggerEdge, type TriggerPosition,
} from "../src/triggerPosition";

const bounds: TriggerBounds = { width: 390, height: 740 };
const free: TriggerPosition = { x: 140, y: 250, edge: null };

describe("floating trigger placement", () => {
  it("starts above the bottom-right safe-area edge without docking", () => {
    const initial = initialTriggerPosition(bounds);
    expect(initial).toEqual({ x: 320, y: 674, edge: null });
    expect(settleTriggerPosition(initial, bounds)).toEqual(initial);
  });

  it("keeps an arbitrary interior position instead of snapping to a side", () => {
    expect(settleTriggerPosition(free, bounds)).toEqual(free);
  });

  it.each([
    ["left", { x: 5, y: 250 }, { x: EDGE_PEEK - TRIGGER_SIZE, y: 250 }],
    ["right", { x: 335, y: 250 }, { x: bounds.width - EDGE_PEEK, y: 250 }],
    ["top", { x: 140, y: 2 }, { x: 140, y: EDGE_PEEK - TRIGGER_SIZE }],
    ["bottom", { x: 140, y: 682 }, { x: 140, y: bounds.height - EDGE_PEEK }],
  ] as const)("hides at the %s edge leaving a visible handle", (edge, point, expected) => {
    expect(settleTriggerPosition({ ...point, edge: null }, bounds)).toEqual({ ...expected, edge });
  });

  it.each(["left", "right", "top", "bottom"] as TriggerEdge[])("can reveal and drag from %s", edge => {
    const hidden = fitTriggerPosition({ ...free, edge }, bounds);
    const result = endTriggerGesture(beginTriggerGesture(hidden), 0, 0, bounds);
    expect(result.capture).toBe(false);
    expect(result.position.edge).toBeNull();
    expect(result.position).toEqual(revealTrigger(hidden, bounds));
    expect(settleTriggerPosition(result.position, bounds).edge).toBeNull();
    const gesture = beginTriggerGesture(hidden);
    const dx = 140 - hidden.x;
    const dy = 250 - hidden.y;
    expect(endTriggerGesture(gesture, dx, dy, bounds)).toEqual({ position: free, capture: false });
  });

  it("uses one edge at corners and never loses the handle after rotation", () => {
    const hidden = settleTriggerPosition({ x: -100, y: -100, edge: null }, bounds);
    expect(hidden).toEqual({ x: -36, y: 0, edge: "left" });
    const rotated = fitTriggerPosition({ x: 372, y: 670, edge: "right" }, { width: 740, height: 300 });
    expect(rotated).toEqual({ x: 722, y: 246, edge: "right" });
  });

  it("clamps floating positions after a resize without inventing a docking gesture", () => {
    expect(fitTriggerPosition(free, { width: 140, height: 180 })).toEqual({ x: 86, y: 126, edge: null });
  });

  it("stays finite in a tiny container", () => {
    expect(initialTriggerPosition({ width: 20, height: 20 })).toEqual({ x: 0, y: 0, edge: null });
    expect(revealTrigger({ x: -36, y: 0, edge: "left" }, { width: 20, height: 20 })).toEqual({ x: 0, y: 0, edge: null });
  });
});

describe("trigger gesture intent", () => {
  it.each([
    [-999, 0], [999, 0], [0, -999], [0, 999],
  ])("keeps a recording stop control fully visible after dragging %s/%s", (dx, dy) => {
    const result = endTriggerGesture(beginTriggerGesture(free), dx!, dy!, bounds, false);
    expect(result.capture).toBe(false);
    expect(result.position.edge).toBeNull();
    expect(result.position.x).toBeGreaterThanOrEqual(0);
    expect(result.position.x).toBeLessThanOrEqual(bounds.width - TRIGGER_SIZE);
    expect(result.position.y).toBeGreaterThanOrEqual(0);
    expect(result.position.y).toBeLessThanOrEqual(bounds.height - TRIGGER_SIZE);
    expect(endTriggerGesture(beginTriggerGesture(result.position), 0, 0, bounds, false).capture).toBe(true);
  });

  it("allows a recording stop tap even while revealing an old docked position", () => {
    const hidden = fitTriggerPosition({ ...free, edge: "left" }, bounds);
    expect(endTriggerGesture(beginTriggerGesture(hidden), 0, 0, bounds, false)).toEqual({
      position: revealTrigger(hidden, bounds), capture: true,
    });
  });

  it("preserves a recording button position when returning to screenshot mode", () => {
    const recording = endTriggerGesture(beginTriggerGesture(free), 40, -70, bounds, false);
    expect(recording.position).toEqual({ x: 180, y: 180, edge: null });
    expect(endTriggerGesture(beginTriggerGesture(recording.position), 0, 0, bounds)).toEqual({
      position: recording.position, capture: true,
    });
  });

  it("captures on a tap, ignoring small finger jitter", () => {
    const gesture = beginTriggerGesture(free);
    expect(moveTriggerGesture(gesture, 2, 2, 1, bounds)).toEqual(free);
    expect(endTriggerGesture(gesture, 2, 2, bounds)).toEqual({ position: free, capture: true });
  });

  it("drags freely and never captures on release", () => {
    const gesture = beginTriggerGesture(free);
    expect(moveTriggerGesture(gesture, 30, -80, 1, bounds)).toEqual({ x: 170, y: 170, edge: null });
    expect(endTriggerGesture(gesture, 30, -80, bounds)).toEqual({ position: { x: 170, y: 170, edge: null }, capture: false });
  });

  it("does not turn a drag out-and-back into a tap", () => {
    const gesture = beginTriggerGesture(free);
    moveTriggerGesture(gesture, 60, 0, 1, bounds);
    expect(endTriggerGesture(gesture, 0, 0, bounds)).toEqual({ position: free, capture: false });
  });

  it("docks only at release, even when dragged beyond the surface", () => {
    const gesture = beginTriggerGesture(free);
    expect(moveTriggerGesture(gesture, 999, 0, 1, bounds)).toEqual({ x: 336, y: 250, edge: null });
    expect(endTriggerGesture(gesture, 999, 0, bounds)).toEqual({ position: { x: 372, y: 250, edge: "right" }, capture: false });
  });

  it("cancels multi-touch without capturing or changing the remembered position", () => {
    const gesture = beginTriggerGesture(free);
    moveTriggerGesture(gesture, 50, 50, 2, bounds);
    expect(endTriggerGesture(gesture, 50, 50, bounds)).toEqual({ position: free, capture: false });
  });

  it("a captured position survives hiding/showing the same mounted trigger", () => {
    const { position } = endTriggerGesture(beginTriggerGesture(free), 0, 0, bounds);
    expect(fitTriggerPosition(position, bounds)).toEqual(free);
  });
});
