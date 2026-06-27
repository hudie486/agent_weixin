import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plug,
  Clock,
  Send,
  AlertTriangle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { StatusDot, Skeleton, EmptyState, Badge } from "@/components/ui/atoms";
import { Button } from "@/components/ui/Button";
import { formatClock, formatRelative, formatUptime } from "@/lib/format";
import type { StatusResponse } from "@/lib/types";

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <GlassCard className="flex items-center gap-4 p-4">
      <div
        className="grid size-11 place-items-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${tone ?? "var(--accent)"} 18%, transparent)`, color: tone ?? "var(--accent)" }}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted">{label}</div>
        <div className="text-xl font-semibold tabular leading-tight">{value}</div>
        {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
      </div>
    </GlassCard>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<StatusResponse>("/status"),
    refetchInterval: 8000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data) return null;

  const onlinePlatforms = data.platforms.filter((p) => p.online).length;
  const enabledPlatforms = data.platforms.filter((p) => p.enabled).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">总览</h1>
          <p className="text-xs text-muted">
            v{data.health.version} · Node {data.health.node} · 运行 {formatUptime(data.health.uptimeMs)}
          </p>
        </div>
        <Button size="sm" onClick={() => refetch()}>
          <RefreshCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Plug}
          label="在线平台"
          value={`${onlinePlatforms}/${enabledPlatforms}`}
          sub="已启用平台连接"
          tone="var(--ok)"
        />
        <StatTile
          icon={Clock}
          label="周期任务"
          value={`${data.periodic.enabled}`}
          sub={`共 ${data.periodic.total} 个`}
          tone="var(--accent)"
        />
        <StatTile
          icon={Send}
          label="待补发"
          value={`${data.outbound.pending}`}
          sub="出站重试队列"
          tone={data.outbound.pending > 0 ? "var(--warn)" : "var(--ok)"}
        />
        <StatTile
          icon={AlertTriangle}
          label="最近错误"
          value={`${data.recentErrors.length}`}
          sub="周期任务失败"
          tone={data.recentErrors.length > 0 ? "var(--danger)" : "var(--ok)"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <MotionGlassCard className="p-5">
          <h2 className="mb-3 text-sm font-semibold">平台状态</h2>
          <div className="space-y-2">
            {data.platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/platforms/${p.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-white/4 px-3.5 py-3 text-left hover:bg-white/8"
              >
                <StatusDot state={p.online ? "online" : p.enabled ? "warn" : "offline"} />
                <span className="text-sm font-medium">{p.label}</span>
                <span className="ml-auto text-[11px] text-muted">
                  {p.detail ?? (p.online ? "在线" : p.enabled ? "未连接" : "已禁用")}
                </span>
              </button>
            ))}
          </div>
        </MotionGlassCard>

        <MotionGlassCard className="p-5">
          <h2 className="mb-3 text-sm font-semibold">下次周期触发</h2>
          {data.periodic.nextRuns.length === 0 ? (
            <EmptyState title="暂无启用的定时任务" hint="在「自动化 · 周期任务」中创建" />
          ) : (
            <div className="space-y-2">
              {data.periodic.nextRuns.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-white/4 px-3.5 py-2.5"
                >
                  <Clock className="size-4 text-[var(--accent)]" />
                  <span className="text-sm">{r.shortName ?? r.id.slice(0, 8)}</span>
                  {r.cron && <Badge className="font-mono">{r.cron}</Badge>}
                  <span className="ml-auto text-[11px] text-muted tabular">
                    {formatClock(r.nextRunAt)} · {formatRelative(r.nextRunAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </MotionGlassCard>
      </div>

      <MotionGlassCard className="p-5">
        <h2 className="mb-3 text-sm font-semibold">最近错误</h2>
        {data.recentErrors.length === 0 ? (
          <EmptyState title="一切正常" hint="近期没有周期任务失败记录" />
        ) : (
          <div className="space-y-2">
            {data.recentErrors.map((e) => (
              <div
                key={e.id}
                className="flex items-start gap-3 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-3.5 py-2.5"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
                <div className="min-w-0">
                  <div className="text-sm">{e.shortName ?? e.id.slice(0, 8)}</div>
                  <div className="truncate text-[11px] text-muted">{e.summary}</div>
                </div>
                <span className="ml-auto shrink-0 text-[11px] text-muted">{formatRelative(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </MotionGlassCard>
    </div>
  );
}
