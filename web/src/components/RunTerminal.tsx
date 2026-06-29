import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Chunk = { stream: "stdout" | "stderr" | "system"; text: string };

/** 连接 SSE 执行通道（连接即运行），实时渲染 stdout/stderr，收到 done 即结束。 */
export function RunTerminal({ path, onDone }: { path: string; onDone?: () => void }) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [running, setRunning] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChunks([]);
    setRunning(true);
    const es = new EventSource(`/api${path}`, { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        setChunks((c) => [...c, JSON.parse(ev.data) as Chunk]);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("done", () => {
      setRunning(false);
      es.close();
      onDone?.();
    });
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [chunks]);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-black/35">
      <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2 text-[11px] text-muted">
        <span className={cn("size-2 rounded-full", running ? "animate-pulse bg-[var(--warn)]" : "bg-[var(--ok)]")} />
        {running ? "运行中…" : "已结束"}
      </div>
      <div ref={boxRef} className="max-h-[52vh] min-h-[160px] overflow-y-auto p-3 font-mono text-[12px] leading-relaxed">
        {chunks.length === 0 && <div className="text-muted">等待输出…</div>}
        {chunks.map((c, i) => (
          <pre
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              c.stream === "stderr" && "text-[var(--danger)]",
              c.stream === "system" && "text-[var(--accent)]",
            )}
          >
            {c.text}
          </pre>
        ))}
      </div>
    </div>
  );
}
