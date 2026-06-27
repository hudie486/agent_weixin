import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Info, RotateCcw, Cpu, Check, X, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, ErrorState, Badge } from "@/components/ui/atoms";
import { formatUptime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { SystemHealth } from "@/lib/types";

type Feature = { id: string; label: string; on: boolean; env: string };

function StatRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--glass-border)] py-2 last:border-0">
      <span className="text-[12px] text-muted">{k}</span>
      <span className="font-mono text-[12px]">{v}</span>
    </div>
  );
}

export function AboutPage() {
  const navigate = useNavigate();
  const { data: health, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<SystemHealth>("/system/health"),
    refetchInterval: 5000,
  });
  const { data: feat } = useQuery({
    queryKey: ["features"],
    queryFn: () => api.get<{ features: Feature[] }>("/system/features"),
  });
  const [restarting, setRestarting] = useState(false);

  const restart = async () => {
    if (!confirm("优雅重启后端进程？依赖外部守护（PM2 / npm run dev / 系统服务）自动拉起；无守护时需手动 npm start。")) return;
    setRestarting(true);
    try {
      await api.post("/system/restart", { confirm: true });
      toast.info("已请求重启，等待进程拉起…");
      // 轮询 /api/ping 直到后端回来
      const t0 = Date.now();
      const poll = async () => {
        if (Date.now() - t0 > 60000) {
          setRestarting(false);
          toast.error("60 秒内未恢复——可能没有外部守护，请手动重启后端");
          return;
        }
        try {
          const res = await fetch("/api/ping");
          if (res.ok) {
            const j = (await res.json()) as { startedAt?: number };
            if (j.startedAt && health && j.startedAt > health.startedAt) {
              setRestarting(false);
              toast.success("后端已重启");
              refetch();
              return;
            }
          }
        } catch {
          /* still down */
        }
        setTimeout(poll, 1500);
      };
      setTimeout(poll, 2000);
    } catch (e) {
      setRestarting(false);
      toast.error(e instanceof ApiError ? e.message : "重启失败");
    }
  };

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !health) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">关于 / 重启</h1>

      <MotionGlassCard className="p-5">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--accent)]/18 text-[var(--accent)]">
            <Info className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">wechat-agent-bot · v{health.version}</div>
            <div className="text-[11px] text-muted">运行 {formatUptime(health.uptimeMs)} · {health.env === "dev" ? "开发模式" : "生产模式"}</div>
          </div>
          <Button size="sm" variant="danger" className="ml-auto" loading={restarting} onClick={restart}>
            <RotateCcw className="size-3.5" /> 保存并重启
          </Button>
        </div>
        <StatRow k="Node" v={health.node} />
        <StatRow k="平台" v={health.platform} />
        <StatRow k="PID" v={String(health.pid)} />
        <StatRow k="启动于" v={new Date(health.startedAt).toLocaleString("zh-CN")} />
      </MotionGlassCard>

      <MotionGlassCard className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="size-4 text-muted" />
          <h2 className="text-sm font-semibold">能力开关</h2>
          <Button size="sm" className="ml-auto" onClick={() => navigate("/system/env")}>
            <SlidersHorizontal className="size-3.5" /> 去配置
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(feat?.features ?? []).map((f) => (
            <div
              key={f.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
                f.on
                  ? "border-[var(--ok)]/30 bg-[var(--ok)]/10"
                  : "border-[var(--glass-border)] bg-white/4 text-muted",
              )}
              title={f.env}
            >
              {f.on ? <Check className="size-3.5 text-[var(--ok)]" /> : <X className="size-3.5 text-muted" />}
              <span className="truncate">{f.label}</span>
            </div>
          ))}
        </div>
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        重启会触发优雅关闭（保存会话、停 SearXNG 等）再退出，靠外部守护拉起。版本自检：浏览器打开
        <span className="font-mono"> /api/ping </span>可看后端已挂载的接口清单与 <Badge>startedAt</Badge>。
      </GlassCard>
    </div>
  );
}
