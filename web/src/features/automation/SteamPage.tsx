import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Gamepad2, RefreshCw, SlidersHorizontal, Circle } from "lucide-react";
import { api } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/atoms";
import { formatRelative } from "@/lib/format";

type SteamStatus = {
  configured: boolean;
  keySet: boolean;
  steamId: string | null;
  notifyUserId: string | null;
  intervalMs: number;
  proxyUrl: string | null;
  noProxy: boolean;
  lastModified: number | null;
  online: number;
  total: number;
  friends: { steamId: string; name: string; statusText: string; online: boolean }[];
};

export function SteamPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["steam"],
    queryFn: () => api.get<SteamStatus>("/steam/status"),
    refetchInterval: 15000,
  });

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
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Steam 监控</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["steam"] })}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          <Button size="sm" onClick={() => navigate("/system/env")}>
            <SlidersHorizontal className="size-3.5" /> 编辑配置
          </Button>
        </div>
      </div>

      <MotionGlassCard className="flex items-center gap-4 p-5">
        <div
          className="grid size-12 place-items-center rounded-xl"
          style={{
            background: data.configured ? "color-mix(in srgb, var(--ok) 18%, transparent)" : "rgba(255,255,255,.06)",
            color: data.configured ? "var(--ok)" : "var(--fg-muted)",
          }}
        >
          <Gamepad2 className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {data.configured ? "监控已配置" : `未配置（缺 ${[
              !data.keySet && "API Key",
              !data.steamId && "SteamID",
              !data.notifyUserId && "收件人 userId",
            ].filter(Boolean).join("、")}）`}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span className={data.keySet ? "text-[var(--ok)]" : "text-[var(--danger)]"}>Key {data.keySet ? "✓" : "✗"}</span>
            <span className={data.steamId ? "text-[var(--ok)]" : "text-[var(--danger)]"}>SteamID {data.steamId ? "✓" : "✗"}</span>
            <span className={data.notifyUserId ? "text-[var(--ok)]" : "text-[var(--danger)]"}>收件人 {data.notifyUserId ? "✓" : "✗"}</span>
            <span>在线 {data.online}/{data.total}</span>
            <span>间隔 {Math.round(data.intervalMs / 1000)}s</span>
            {data.lastModified && <span>快照 {formatRelative(data.lastModified)}</span>}
          </div>
        </div>
      </MotionGlassCard>

      <MotionGlassCard className="p-3">
        <h2 className="mb-2 px-1 text-sm font-semibold">好友快照</h2>
        {data.friends.length === 0 ? (
          <EmptyState title="暂无快照" hint="监控启用并完成首轮基准后，这里会显示好友在线状态" />
        ) : (
          <div className="space-y-1">
            {data.friends.map((f) => (
              <div key={f.steamId} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/4">
                <Circle className="size-2.5" fill={f.online ? "var(--ok)" : "rgba(255,255,255,.25)"} stroke="none" />
                <span className="text-[13px]">{f.name}</span>
                <span className="ml-auto text-[11px] text-muted">{f.statusText}</span>
              </div>
            ))}
          </div>
        )}
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        配置项（Key / SteamID / 收件人 / 间隔 / 代理）在「环境变量 · Steam 监控」中编辑，保存后需重启生效。去重规则：同一轮上线并进游戏只推游戏、下线优先于退游戏。
      </GlassCard>
    </div>
  );
}
