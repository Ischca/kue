import type { KueTriggerSource } from "./types";

/** Handles unmount/foreground races even when native subscription setup is async. */
export function subscribeTriggers(sources: readonly KueTriggerSource[], open: () => void, onError: (error: unknown) => void): () => void {
  let stopped = false;
  const removers: Array<() => void> = [];
  for (const source of sources) {
    void Promise.resolve().then(() => stopped ? undefined : source(() => { if (!stopped) open(); }))
      .then((remove) => { if (remove) { if (stopped) remove(); else removers.push(remove); } })
      .catch((error: unknown) => { if (!stopped) onError(error); });
  }
  return () => {
    stopped = true;
    for (const remove of removers.splice(0)) { try { remove(); } catch { /* Remove remaining listeners too. */ } }
  };
}
