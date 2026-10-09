export const TRIGGER_SIZE = 54;
export const EDGE_PEEK = 18;
export const EDGE_THRESHOLD = 8;
export const DRAG_THRESHOLD = 6;

export type TriggerEdge = "left" | "right" | "top" | "bottom";
export interface TriggerBounds { width: number; height: number }
export interface TriggerPosition { x: number; y: number; edge: TriggerEdge | null }
export interface TriggerGesture {
  start: TriggerPosition;
  dragged: boolean;
  cancelled: boolean;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
const limits = ({ width, height }: TriggerBounds) => ({
  x: Math.max(0, width - TRIGGER_SIZE), y: Math.max(0, height - TRIGGER_SIZE),
});

export function initialTriggerPosition(bounds: TriggerBounds): TriggerPosition {
  const max = limits(bounds);
  return { x: Math.max(0, max.x - 16), y: Math.max(0, max.y - 12), edge: null };
}

/** Reflow within the safe-area surface, preserving the selected hiding edge. */
export function fitTriggerPosition(position: TriggerPosition, bounds: TriggerBounds): TriggerPosition {
  const max = limits(bounds);
  const point = { ...position, x: clamp(position.x, max.x), y: clamp(position.y, max.y) };
  if (position.edge === "left") point.x = EDGE_PEEK - TRIGGER_SIZE;
  if (position.edge === "right") point.x = Math.max(0, bounds.width - EDGE_PEEK);
  if (position.edge === "top") point.y = EDGE_PEEK - TRIGGER_SIZE;
  if (position.edge === "bottom") point.y = Math.max(0, bounds.height - EDGE_PEEK);
  return point;
}

export function settleTriggerPosition(position: TriggerPosition, bounds: TriggerBounds): TriggerPosition {
  const max = limits(bounds);
  const point = fitTriggerPosition({ ...position, edge: null }, bounds);
  const distances: Array<[TriggerEdge, number]> = [
    ["left", point.x], ["right", max.x - point.x], ["top", point.y], ["bottom", max.y - point.y],
  ];
  const nearest = distances.sort((a, b) => a[1] - b[1])[0]!;
  return fitTriggerPosition({ ...point, edge: nearest[1] <= EDGE_THRESHOLD ? nearest[0] : null }, bounds);
}

export function revealTrigger(position: TriggerPosition, bounds: TriggerBounds): TriggerPosition {
  const max = limits(bounds);
  const point = fitTriggerPosition({ ...position, edge: null }, bounds);
  if (position.edge === "left") point.x = Math.min(12, max.x);
  if (position.edge === "right") point.x = Math.max(0, max.x - 12);
  if (position.edge === "top") point.y = Math.min(12, max.y);
  if (position.edge === "bottom") point.y = Math.max(0, max.y - 12);
  return point;
}

export function beginTriggerGesture(start: TriggerPosition): TriggerGesture {
  return { start, dragged: false, cancelled: false };
}

export function moveTriggerGesture(gesture: TriggerGesture, dx: number, dy: number, touches: number, bounds: TriggerBounds): TriggerPosition {
  gesture.cancelled ||= touches > 1;
  gesture.dragged ||= Math.hypot(dx, dy) > DRAG_THRESHOLD;
  if (!gesture.dragged || gesture.cancelled) return gesture.start;
  return fitTriggerPosition({ x: gesture.start.x + dx, y: gesture.start.y + dy, edge: null }, bounds);
}

export function endTriggerGesture(gesture: TriggerGesture, dx: number, dy: number, bounds: TriggerBounds, canHide = true): { position: TriggerPosition; capture: boolean } {
  const point = moveTriggerGesture(gesture, dx, dy, 0, bounds);
  if (gesture.cancelled) return { position: canHide ? fitTriggerPosition(gesture.start, bounds) : revealTrigger(gesture.start, bounds), capture: false };
  if (gesture.dragged) return { position: canHide ? settleTriggerPosition(point, bounds) : revealTrigger(point, bounds), capture: false };
  return { position: revealTrigger(gesture.start, bounds), capture: gesture.start.edge === null || !canHide };
}
