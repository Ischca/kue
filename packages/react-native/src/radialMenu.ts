import { TRIGGER_SIZE, type TriggerBounds } from "./triggerPosition";

export const MENU_HOLD_MS = 500;
export const MENU_BUTTON_SIZE = 44;
export const MENU_LABEL_HEIGHT = 30;
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface RadialLayout {
  origin: Point;
  items: Point[];
  /** Each action's name beside its button, inside the surface and clear of every other target. */
  labels: Rect[];
}
export interface CaptureAction {
  id: string;
  label: string;
  symbol: string;
  disabled?: boolean;
  locked?: boolean;
  onSelect: () => void;
}

const EDGE = 8;
const LABEL_GAP = 8;
const SPACING = 56;
// The first button clears the trigger and its own radius with a small gap.
const FIRST = TRIGGER_SIZE / 2 + 15 + MENU_BUTTON_SIZE / 2;
const RADII = [72, 82, 94, 108];
// Narrower than this, a name is no longer readable after shrinking.
const MIN_LABEL_WIDTH = 120;

/** A conservative one-line width at 14pt; the label shrinks or ellipsizes if a font runs wider. */
export function menuLabelWidth(text: string): number {
  let width = 26;
  for (const character of text) width += /[\u0020-\u024f]/u.test(character) ? 8.6 : 14.6;
  return Math.ceil(width);
}

const around = (p: Point, half: number): Rect => ({ x: p.x - half, y: p.y - half, width: half * 2, height: half * 2 });
const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const inside = (r: Rect, bounds: TriggerBounds) =>
  r.x >= EDGE && r.y >= EDGE && r.x + r.width <= bounds.width - EDGE && r.y + r.height <= bounds.height - EDGE;

type Side = "left" | "right" | "above" | "below";

/** Places every name on a side of its button: a fixed side for a tidy column of names, or the
 * first side that fits. Names narrow to the room they have, but never below a readable width. */
function placeLabels(origin: Point, items: Point[], estimates: number[], bounds: TriggerBounds, sides: (index: number) => Side[]): Rect[] | null {
  // The trigger square also covers its count badge.
  const targets = [around(origin, TRIGGER_SIZE / 2), ...items.map(p => around(p, MENU_BUTTON_SIZE / 2))];
  const labels: Rect[] = [];
  const reach = MENU_BUTTON_SIZE / 2 + LABEL_GAP, height = MENU_LABEL_HEIGHT, cap = Math.floor(bounds.width * 0.6);
  for (const [index, p] of items.entries()) {
    const estimate = estimates[index]!, need = Math.min(estimate, MIN_LABEL_WIDTH);
    const label = sides(index).map((side): Rect | null => {
      const room = side === "left" ? p.x - reach - EDGE : side === "right" ? bounds.width - EDGE - p.x - reach : bounds.width - EDGE * 2;
      const width = Math.min(estimate, cap, Math.floor(room));
      if (width < need) return null;
      if (side === "left") return { x: p.x - reach - width, y: p.y - height / 2, width, height };
      if (side === "right") return { x: p.x + reach, y: p.y - height / 2, width, height };
      const x = Math.max(EDGE, Math.min(p.x - width / 2, bounds.width - EDGE - width));
      return { x, y: side === "above" ? p.y - reach - height : p.y + reach, width, height };
    }).find((rect): rect is Rect => !!rect && inside(rect, bounds) && !targets.some(t => overlaps(rect, t, 2)) && !labels.some(l => overlaps(rect, l, 4)));
    if (!label) return null;
    labels.push(label);
  }
  return labels;
}

/** Coordinates are local to the safe-area surface. Nothing is clipped: when no arrangement fits,
 * the caller shows the accessible list instead. */
export function layoutRadialMenu(origin: Point, bounds: TriggerBounds, names: readonly string[]): RadialLayout | null {
  const count = names.length;
  if (count < 1 || count > 5 || bounds.width < 160 || bounds.height < 160) return null;
  const estimates = names.map(menuLabelWidth);
  const fits = (items: Point[]) => items.every(p => inside(around(p, MENU_BUTTON_SIZE / 2), bounds));
  const roomier: Side = origin.x > bounds.width / 2 ? "left" : "right";
  const other: Side = roomier === "left" ? "right" : "left";
  // 1. A column of buttons above or below the trigger, every name on the roomier side.
  const upFirst = origin.y > bounds.height / 2;
  // A trigger flush with the edge is wider than a button, so the column steps inside the margin.
  const columnX = Math.max(EDGE + MENU_BUTTON_SIZE / 2, Math.min(origin.x, bounds.width - EDGE - MENU_BUTTON_SIZE / 2));
  for (const direction of upFirst ? [-1, 1] : [1, -1]) {
    const items = Array.from({ length: count }, (_, i) => ({ x: columnX, y: origin.y + direction * (FIRST + i * SPACING) }));
    const labels = fits(items) ? placeLabels(origin, items, estimates, bounds, () => [roomier]) : null;
    if (labels) return { origin, items, labels };
  }
  // 2. A fan toward the interior with names pointing outward, then 3. any side that fits.
  const dx = bounds.width / 2 - origin.x, dy = bounds.height / 2 - origin.y;
  const preferred = Math.hypot(dx, dy) < 40 ? -Math.PI / 2 : Math.atan2(dy, dx);
  for (const tidy of [true, false]) for (const radius of RADII) {
    const step = count < 2 ? 0 : 2 * Math.asin(SPACING / 2 / radius);
    for (let turn = 0; turn <= 90; turn++) for (const sign of turn ? [1, -1] : [1]) {
      const heading = preferred + sign * turn * Math.PI / 90;
      const items = Array.from({ length: count }, (_, i) => {
        const angle = heading + step * (i - (count - 1) / 2);
        return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
      });
      if (!fits(items)) continue;
      const outward: Side = Math.cos(heading) < -0.3 ? "left" : Math.cos(heading) > 0.3 ? "right" : roomier;
      const labels = placeLabels(origin, items, estimates, bounds,
        () => tidy ? [outward] : [outward, "above", outward === roomier ? other : roomier, "below"]);
      if (labels) return { origin, items, labels };
    }
  }
  return null;
}

/** Releasing at the trigger cancels. A button's circle wins over a neighbouring label, a label
 * selects its own action, and only then does the nearest button within reach count. */
export function radialSelection(layout: RadialLayout, pointer: Point): number | null {
  if (Math.hypot(pointer.x - layout.origin.x, pointer.y - layout.origin.y) < 38) return null;
  const onButton = layout.items.findIndex(p => Math.hypot(pointer.x - p.x, pointer.y - p.y) <= MENU_BUTTON_SIZE / 2);
  if (onButton >= 0) return onButton;
  const onLabel = layout.labels.findIndex(r => pointer.x >= r.x && pointer.x <= r.x + r.width && pointer.y >= r.y && pointer.y <= r.y + r.height);
  if (onLabel >= 0) return onLabel;
  let selected: number | null = null, distance = 30;
  layout.items.forEach((p, index) => {
    const next = Math.hypot(pointer.x - p.x, pointer.y - p.y);
    if (next < distance) { distance = next; selected = index; }
  });
  return selected;
}

/** Shared intent rule for the hold timer and release fallback. Dragging cancels
 * the timer permanently, even when the finger returns to its initial position. */
export function canOpenHeldMenu(state: { dragged: boolean; cancelled: boolean }, recording: boolean, touches: number): boolean {
  return !state.dragged && !state.cancelled && !recording && touches === 1;
}
