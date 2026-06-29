import { useState, useCallback } from "react";

/** localStorage 持久化的简单状态（如跨页复用的目标 userId）。 */
export function useStickyState(key: string, initial = ""): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: string) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}
