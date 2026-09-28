import { expect, it, vi } from "vitest";
import { createShakeDetector } from "../src/shakeDetector";
import { subscribeTriggers } from "../src/triggerSubscriptions";

it("requires two separate movements and debounces a shake", () => {
  let time = 0; const detect = createShakeDetector(() => time);
  const high = () => detect({ x: 3, y: 0, z: 1 });
  const low = () => detect({ x: 0, y: 0, z: 1 });
  expect(low()).toBe(false); expect(high()).toBe(false);
  time = 200; expect(high()).toBe(false); low(); expect(high()).toBe(true);
  low(); time = 400; expect(high()).toBe(false);
  time = 4000; low(); expect(high()).toBe(false);
  time = 4200; low(); expect(high()).toBe(true);
});
it("ignores isolated bumps, invalid measurements and slow movements", () => {
  let time = 0; const detect = createShakeDetector(() => time);
  expect(detect({ x: NaN, y: 0, z: 0 })).toBe(false);
  expect(detect({ x: 4, y: 0, z: 0 })).toBe(false);
  time = 3000; detect({ x: 0, y: 0, z: 1 });
  expect(detect({ x: 4, y: 0, z: 0 })).toBe(false);
});
it("cleans up async subscriptions that arrive after unmount and suppresses their events", async () => {
  let finish!: (remove: () => void) => void; let emit!: () => void;
  const open = vi.fn(); const remove = vi.fn();
  const stop = subscribeTriggers([(callback) => { emit = callback; return new Promise((resolve) => { finish = resolve; }); }], open, vi.fn());
  await Promise.resolve(); stop(); emit(); finish(remove);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(remove).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
it("isolates failed sources and only removes its own subscriptions", async () => {
  const error = vi.fn(); const remove = vi.fn(); const open = vi.fn();
  const stop = subscribeTriggers([() => { throw new Error("unavailable"); }, (emit) => { emit(); return remove; }], open, error);
  await new Promise((resolve) => setTimeout(resolve, 0)); stop(); stop();
  expect(error).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce();
});
