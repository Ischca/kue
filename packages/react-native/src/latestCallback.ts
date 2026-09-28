export interface LatestCallbackProxy<T extends (...args: never[]) => unknown> {
  readonly callback: T;
  update(callback: T): void;
}

/** @internal Keeps a registered callback identity stable while replacing its implementation. */
export function createLatestCallbackProxy<T extends (...args: never[]) => unknown>(
  initial: T,
): LatestCallbackProxy<T> {
  let current = initial;
  const callback = ((...args: Parameters<T>) => current(...args)) as T;

  return {
    callback,
    update(next: T) {
      current = next;
    },
  };
}
