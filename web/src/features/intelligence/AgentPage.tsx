import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sparkles, Play, SlidersHorizontal, Square } from "lucide-react";
import { api } from "@/lib/api";
import { MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, inputClass, Badge, ErrorState } from "@/components/ui/atoms";
import { cn } from "@/lib/cn";

type AgentStatus = { backend: string; cmd: string; model: string | null; hasApiKey: boolean; timeoutMs: number | null };
type AgentEvent = { type: "chunk" | "result" | "error"; text?: string; message?: string };

function AgentStream({ prompt, runId, onEnd }: { prompt: string; runId: number; onEnd: () => void }) {
  const [out, setOut] = useState("");
  const [final, setFinal] = useState<{ kind: "result" | "error"; message: string } | null>(null);
  const [running, setRunning] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setOut("");
    setFinal(null);
    setRunning(true);
    const es = new EventSource(`/api/sse/agent-run?q=${encodeURIComponent(prompt)}`, { withCredentials: true });
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as AgentEvent;
        if (e.type === "chunk") setOut((o) => o + (e.text ?? ""));
        else setFinal({ kind: e.type === "error" ? "error" : "result", message: e.message ?? "" });
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("done", () => {
      setRunning(false);
      es.close();
      onEnd();
    });
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [out, final]);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-black/30">
      <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-3 py-2 text-[11px] text-muted">
        <span className={cn("size-2 rounded-full", running ? "animate-pulse bg-[var(--warn)]" : "bg-[var(--ok)]")} />
        {running ? "Agent 运行中…" : "已结束"}
        {running && (
          <button onClick={() => esRef.current?.close()} className="ml-auto inline-flex items-center gap-1 hover:text-fg">
            <Square className="size-3" /> 停止
          </button>
        )}
      </div>
      <div ref={boxRef} className="max-h-[46vh] min-h-[140px] overflow-y-auto p-3 text-[13px] leading-relaxed">
        {out ? <div className="whitespace-pre-wrap">{out}</div> : <div className="text-muted">等待输出…</div>}
        {final && (
          <div className={cn("mt-3 border-t border-[var(--glass-border)] pt-2 text-[12px]", final.kind === "error" ? "text-[var(--danger)]" : "text-muted")}>
            {final.kind === "error" ? `✗ ${final.message}` : "✓ 完成"}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent", "status"],
    queryFn: () => api.get<AgentStatus>("/intelligence/agent/status"),
  });
  const [prompt, setPrompt] = useState("");
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(false);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const start = () => {
    if (!prompt.trim()) return;
    setActive(true);
    setRunId(Date.now());
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Agent 后端</h1>
        <Button size="sm" onClick={() => navigate("/system/env")}>
          <SlidersHorizontal className="size-3.5" /> 配置
        </Button>
      </div>

      <MotionGlassCard className="flex flex-wrap items-center gap-4 p-5">
        <div className="grid size-12 place-items-center rounded-xl bg-[var(--accent)]/18 text-[var(--accent)]">
          <Sparkles className="size-6" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{data.backend === "sdk" ? "SDK (本进程内)" : "CLI (子进程)"}</Badge>
          <Badge className="font-mono">{data.cmd}</Badge>
          {data.model && <Badge className="font-mono">{data.model}</Badge>}
          {data.backend === "sdk" && <Badge className={data.hasApiKey ? "text-[var(--ok)]" : "text-[var(--danger)]"}>{data.hasApiKey ? "API Key ✓" : "缺 CURSOR_API_KEY"}</Badge>}
        </div>
      </MotionGlassCard>

      <MotionGlassCard className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">试跑</h2>
        <p className="text-[11px] text-muted">直接调用 Agent 流式回复，便于验证后端/模型是否通。会真实消耗模型额度。</p>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="例如：用一句话自我介绍"
            className={cn(inputClass, "flex-1")}
          />
          <Button variant="primary" onClick={start} disabled={!prompt.trim()}>
            <Play className="size-4" /> 运行
          </Button>
        </div>
        {active && <AgentStream prompt={prompt} runId={runId} onEnd={() => {}} />}
      </MotionGlassCard>
    </div>
  );
}
