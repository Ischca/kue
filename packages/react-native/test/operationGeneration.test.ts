import { describe, expect, it } from "vitest";

import { OperationGeneration } from "../src/operationGeneration";

describe("OperationGeneration", () => {
  it("makes async continuations stale after cleanup and after a newer view activates", () => {
    const activity = new OperationGeneration();
    const first = activity.activate();

    expect(activity.isActive(first)).toBe(true);
    activity.invalidate(first);
    expect(activity.isActive(first)).toBe(false);

    const second = activity.activate();
    expect(activity.isActive(first)).toBe(false);
    expect(activity.isActive(second)).toBe(true);
  });

  it("does not let stale cleanup invalidate the current generation", () => {
    const activity = new OperationGeneration();
    const first = activity.activate();
    const second = activity.activate();

    activity.invalidate(first);

    expect(activity.isActive(second)).toBe(true);
  });
});
