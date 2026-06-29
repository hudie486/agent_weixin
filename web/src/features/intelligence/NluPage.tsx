import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Brain, Play, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { StatusDot, Skeleton, inputClass, Badge, ErrorState } from "@/components/ui/atoms";
import { cn } from "@/lib/cn";

type NluStatus = { enabled: boolean; model: string | null; baseUrl: string | null; hasKey: boolean };

export function NluPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["nlu", "status"],
    queryFn: () => api.get<NluStatus>("/intelligence/nlu/status"),
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.post<{ ok?: boolean; result?: unknown; error?: string }>("/intelligence/nlu/test", { text });
      setResult(r.error ? { error: r.error } : r.result);
    } catch (e) {
      setResult({ error: e instanceof ApiError ? e.message : "请求失败" });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">NLU 抽槽</h1>
        <Button size="sm" onClick={() => navigate("/system/env")}>
          <SlidersHorizontal className="size-3.5" /> 配置
        </Button>
      </div>

      <MotionGlassCard className="flex items-center gap-4 p-5">
        <div
          className="grid size-12 place-items-center rounded-xl"
          style={{
            background: data.enabled ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "rgba(255,255,255,.06)",
            color: data.enabled ? "var(--accent)" : "var(--fg-muted)",
          }}
        >
          <Brain className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={data.enabled && data.hasKey ? "online" : data.enabled ? "warn" : "offline"} />
            <span className="text-sm font-semibold">{data.enabled ? "已启用" : "未启用 (NLU_ENABLE=0)"}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-muted">
            {data.model && <Badge>{data.model}</Badge>}
            <span>{data.hasKey ? "DeepSeek Key 已配置" : "缺 DEEPSEEK_API_KEY"}</span>
          </div>
        </div>
      </MotionGlassCard>

      <MotionGlassCard className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">试抽槽</h2>
        <p className="text-[11px] text-muted">输入一句自然语言，看 DeepSeek 抽到哪个命令与槽位（消耗少量 token）。</p>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && run()}
            placeholder="例如：每天早上九点给我发天气"
            className={cn(inputClass, "flex-1")}
          />
          <Button variant="primary" loading={busy} onClick={run} disabled={!text.trim() || !data.enabled}>
            <Play className="size-4" /> 抽取
          </Button>
        </div>
        {result != null && (
          <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--glass-border)] bg-black/30 p-3 font-mono text-[12px] leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        阈值（执行/打断置信度）、模型、Base URL、回退策略均在「环境变量 · NLU 抽槽」中配置。注意 deepseek-chat 将于 2026/07/24 下线。
      </GlassCard>
    </div>
  );
}
