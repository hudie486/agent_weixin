import { useEffect, useRef } from "react";

/**
 * 订阅后端 SSE（同源，cookie 自动带上）。
 * 仅处理默认 message 事件（后端 `data:` 行）；ping 心跳走具名事件，自动忽略。
 */
export function useSSE<T>(
  path: string | null,
  onMessage: (data: T) => void,
  opts?: { enabled?: boolean; onError?: () => void },
): void {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;
  const errRef = useRef(opts?.onError);
  errRef.current = opts?.onError;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!path || !enabled) return;
    const es = new EventSource(`/api${path}`, { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        cbRef.current(JSON.parse(ev.data) as T);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      errRef.current?.();
    };
    return () => es.close();
  }, [path, enabled]);
}
