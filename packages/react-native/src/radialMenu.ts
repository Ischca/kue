import type { TriggerBounds } from "./triggerPosition";

export const MENU_HOLD_MS = 500;
export const MENU_BUTTON_SIZE = 44;
export interface Point { x: number; y: number }
export interface RadialLayout {
  origin: Point;
  items: Point[];
  label: Point & { width: number; height: number };
}
export interface CaptureAction {
  id: string;
  label: string;
  symbol: string;
  disabled?: boolean;
  locked?: boolean;
  onSelect: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Coordinates are local to the safe-area surface. Never clip or independently
 * clamp items: that would change the fan or overlap different selection targets. */
export function layoutRadialMenu(origin: Point, bounds: TriggerBounds, count: number): RadialLayout | null {
  if (count < 1 || count > 5 || bounds.width < 160 || bounds.height < 160) return null;
  const margin = MENU_BUTTON_SIZE / 2 + 4;
  const dx = bounds.width / 2 - origin.x, dy = bounds.height / 2 - origin.y;
  const preferred = Math.hypot(dx, dy) < 40 ? -Math.PI / 2 : Math.atan2(dy, dx);
  for (const degrees of [180, 160, 140, 120, 100, 90, 80]) {
    const arc = degrees * Math.PI / 180;
    const radius = Math.max(90, count < 2 ? 0 : 56 / (2 * Math.sin(arc / (count - 1) / 2)));
    // Prefer an inward fan, then search nearby orientations at two-degree steps.
    for (let step = 0; step <= 90; step++) for (const sign of step ? [1, -1] : [1]) {
      const heading = preferred + sign * step * Math.PI / 90;
      const items = Array.from({ length: count }, (_, i) => {
        const angle = heading + (count === 1 ? 0 : arc * (i / (count - 1) - 0.5));
        return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
      });
      if (!items.every(p => p.x >= margin && p.x <= bounds.width - margin && p.y >= margin && p.y <= bounds.height - margin)) continue;
      return { origin, items, label: labelPosition(origin, items, bounds) };
    }
  }
  // An exceptionally small host surface uses the accessible list, not clipped targets.
  return null;
}

function labelPosition(origin: Point, items: Point[], bounds: TriggerBounds): RadialLayout["label"] {
  const width = Math.min(240, bounds.width - 16), height = Math.min(104, bounds.height - 16);
  const candidates: RadialLayout["label"][] = [];
  for (const y of [origin.y - height - 44, origin.y + 44, 8, bounds.height - height - 8, (bounds.height - height) / 2]) {
    for (const x of [origin.x - width / 2, 8, bounds.width - width - 8]) {
      candidates.push({ x: clamp(x, 8, bounds.width - width - 8), y: clamp(y, 8, bounds.height - height - 8), width, height });
    }
  }
  const overlap = (rect: RadialLayout["label"]) => [...items, origin].reduce((total, p) => {
    const r = 30;
    return total + Math.max(0, Math.min(rect.x + width, p.x + r) - Math.max(rect.x, p.x - r)) *
      Math.max(0, Math.min(rect.y + height, p.y + r) - Math.max(rect.y, p.y - r));
  }, 0);
  return candidates.sort((a, b) => overlap(a) - overlap(b))[0]!;
}

/** No angular-only selection: releasing at the origin, between targets or far
 * outside the fan cancels instead of accidentally selecting a distant action. */
export function radialSelection(layout: RadialLayout, pointer: Point): number | null {
  if (Math.hypot(pointer.x - layout.origin.x, pointer.y - layout.origin.y) < 38) return null;
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
