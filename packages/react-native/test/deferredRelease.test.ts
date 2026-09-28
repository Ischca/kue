import { describe, expect, it, vi } from "vitest";

import { DeferredImageRelease } from "../src/deferredRelease";

describe("DeferredImageRelease", () => {
  it("keeps files alive until an in-flight submit finishes", () => {
    const deferred = new DeferredImageRelease();
    const release = vi.fn();

    deferred.setSubmitting(true, release);
    deferred.release("file:///prepared.jpg", release);

    expect(release).not.toHaveBeenCalled();

    deferred.setSubmitting(false, release);
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith("file:///prepared.jpg");
  });

  it("deduplicates cleanup requested by both Reporter and Kue", () => {
    const deferred = new DeferredImageRelease();
    const release = vi.fn();

    deferred.setSubmitting(true, release);
    deferred.release("file:///prepared.jpg", release);
    deferred.release("file:///prepared.jpg", release);
    deferred.setSubmitting(false, release);

    expect(release).toHaveBeenCalledOnce();
  });

  it("does not flush an older submission while a newer generation is still active", () => {
    const deferred = new DeferredImageRelease();
    const release = vi.fn();

    deferred.setSubmitting(true, release);
    deferred.setSubmitting(true, release);
    deferred.release("file:///new-generation.jpg", release);
    deferred.setSubmitting(false, release);

    expect(release).not.toHaveBeenCalled();

    deferred.setSubmitting(false, release);
    expect(release).toHaveBeenCalledWith("file:///new-generation.jpg");
  });
});
