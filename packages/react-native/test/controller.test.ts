import { describe, expect, it, vi } from "vitest";

import { KueUnavailableError, registerKueHost, reportIssue } from "../src/controller";
import { createLatestCallbackProxy } from "../src/latestCallback";

describe("reportIssue", () => {
  it("fails clearly when no host is mounted", async () => {
    await expect(reportIssue()).rejects.toBeInstanceOf(KueUnavailableError);
  });

  it("forwards options to the mounted host", async () => {
    const open = vi.fn(async () => undefined);
    const unregister = registerKueHost(open);

    await reportIssue({ memo: "profile padding", context: { route: "/profile" } });

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({
      memo: "profile padding",
      context: { route: "/profile" },
    });
    unregister();
  });

  it("does not let an older host cleanup unregister the current host", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerKueHost(first);
    const unregisterSecond = registerKueHost(second);

    unregisterFirst();
    await reportIssue();

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();

    unregisterSecond();
    warning.mockRestore();
  });

  it("falls back to an older mounted host when the newest host unmounts", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerKueHost(first);
    const unregisterSecond = registerKueHost(second);

    unregisterSecond();
    await reportIssue();

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();

    unregisterFirst();
    warning.mockRestore();
  });

  it("updates an older host callback without changing mount-order priority", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const initialFirst = vi.fn(async () => undefined);
    const updatedFirst = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const firstProxy = createLatestCallbackProxy(initialFirst);
    const unregisterFirst = registerKueHost(firstProxy.callback);
    const unregisterSecond = registerKueHost(second);

    firstProxy.update(updatedFirst);
    await reportIssue({ memo: "newest stays first" });

    expect(second).toHaveBeenCalledOnce();
    expect(initialFirst).not.toHaveBeenCalled();
    expect(updatedFirst).not.toHaveBeenCalled();

    unregisterSecond();
    await reportIssue({ memo: "latest implementation" });

    expect(updatedFirst).toHaveBeenCalledWith({ memo: "latest implementation" });
    expect(initialFirst).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();

    unregisterFirst();
    warning.mockRestore();
  });
});
