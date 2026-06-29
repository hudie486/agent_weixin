import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Trash2, ScrollText } from "lucide-react";
import { MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/atoms";
import { cn } from "@/lib/cn";

type Line = { t: number; level: "info" | "warn" | "error"; text: string };

export function LogsPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<"all" | "info" | "warn" | "error">("all");
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource("/api/sse/logs", { withCredentials: true });
    es.onmessage = (ev) => {
      if (pausedRef.current) return;
      try {
        const l = JSON.parse(ev.data) as Line;
        setLines((prev) => {
          const next = prev.length > 1500 ? prev.slice(prev.length - 1200) : prev;
          return [...next, l];
        });
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter(
      (l) => (level === "all" || l.level === level) && (!needle || l.text.toLowerCase().includes(needle)),
    );
  }, [lines, level, q]);

  useEffect(() => {
    if (!paused) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [filtered, paused]);

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const l of lines) {
      if (l.level === "warn") warn++;
      else if (l.level === "error") error++;
    }
    return { warn, error };
  }, [lines]);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2">
          <ScrollText className="size-5 text-[var(--accent)]" />
          <h1 className="text-xl font-semibold">日志</h1>
          <span className="text-[11px] text-muted">
            {lines.length} 行 · <span className="text-[var(--warn)]">{counts.warn} warn</span> ·{" "}
            <span className="text-[var(--danger)]">{counts.error} error</span>
          </span>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索…"
          className={cn(inputClass, "w-44")}
        />
        <div className="flex rounded-lg border border-[var(--glass-border)] p-0.5">
          {(["all", "info", "warn", "error"] as const).map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px]",
                level === lv ? "bg-[var(--accent)]/20 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {lv}
            </button>
          ))}
        </div>
        <Button size="sm" variant={paused ? "primary" : "ghost"} onClick={() => setPaused((v) => !v)}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "继续" : "暂停"}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => setLines([])}>
          <Trash2 className="size-3.5" /> 清屏
        </Button>
      </div>

      <MotionGlassCard className="min-h-0 flex-1 overflow-hidden p-0">
        <div ref={boxRef} className="h-full overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-muted">{paused ? "已暂停" : "等待日志…（后端有输出即会显示）"}</div>
          ) : (
            filtered.map((l, i) => (
              <div
                key={i}
                className={cn(
                  "whitespace-pre-wrap break-words border-l-2 pl-2",
                  l.level === "error"
                    ? "border-[var(--danger)] text-[var(--danger)]"
                    : l.level === "warn"
                      ? "border-[var(--warn)] text-[var(--warn)]"
                      : "border-transparent text-fg/85",
                )}
              >
                {l.text}
              </div>
            ))
          )}
        </div>
      </MotionGlassCard>
    </div>
  );
}
