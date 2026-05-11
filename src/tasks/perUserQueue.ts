/** Serialize async work per key (e.g. userId) */

export function createPerKeyQueue(): {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
} {
  const tails = new Map<string, Promise<unknown>>();

  const run = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    let resolveNext!: () => void;
    const next = new Promise<void>((r) => {
      resolveNext = r;
    });
    const p = prev.then(async () => {
      try {
        return await fn();
      } finally {
        resolveNext();
      }
    });
    tails.set(key, next.then(() => p));
    return p as Promise<T>;
  };

  return { run };
}
