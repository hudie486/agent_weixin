import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Trash2, RefreshCw, Inbox } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Badge } from "@/components/ui/atoms";
import { formatRelative } from "@/lib/format";

type QueueUser = {
  userId: string;
  count: number;
  oldest: number;
  attempts: number;
  lastError?: string;
  platform: string;
};
type QueueResp = { total: number; users: QueueUser[] };

export function OutboundPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["outbound"],
    queryFn: () => api.get<QueueResp>("/platforms/outbound/queue"),
    refetchInterval: 6000,
  });
  const [busy, setBusy] = useState<string>("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["outbound"] });
    void qc.invalidateQueries({ queryKey: ["status"] });
  };

  const drain = async (userId?: string) => {
    setBusy(userId ?? "all-drain");
    try {
      const r = await api.post<{ sent: number; failed: number }>("/platforms/outbound/drain", userId ? { userId } : {});
      toast.success(`补发完成：成功 ${r.sent}，失败 ${r.failed}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "补发失败");
    } finally {
      setBusy("");
    }
  };

  const clear = async (userId?: string) => {
    if (!confirm(userId ? `清空用户 ${userId} 的待补发队列？` : "清空全部待补发队列？")) return;
    setBusy(userId ?? "all-clear");
    try {
      const r = await api.del<{ removed: number }>("/platforms/outbound/queue", { userId, confirm: true });
      toast.success(`已清除 ${r.removed} 条`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "清空失败");
    } finally {
      setBusy("");
    }
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">出站与重试</h1>
          <p className="text-xs text-muted">微信/QQ 共用的失败落盘队列 · 共 {data.total} 条待补发</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          {data.total > 0 && (
            <>
              <Button size="sm" variant="primary" loading={busy === "all-drain"} onClick={() => drain()}>
                <Send className="size-3.5" /> 全部补发
              </Button>
              <Button size="sm" variant="danger" loading={busy === "all-clear"} onClick={() => clear()}>
                <Trash2 className="size-3.5" /> 全部清空
              </Button>
            </>
          )}
        </div>
      </div>

      <MotionGlassCard className="p-3">
        {data.users.length === 0 ? (
          <EmptyState icon={<Inbox className="size-8" />} title="队列为空" hint="没有待补发的消息，一切已送达" />
        ) : (
          <div className="space-y-1.5">
            {data.users.map((u) => (
              <div
                key={u.userId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-white/4 px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px]">{u.userId}</span>
                    <Badge>{u.platform}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    <span>待补发 {u.count}</span>
                    <span>最早 {formatRelative(u.oldest)}</span>
                    <span>尝试 {u.attempts} 次</span>
                    {u.lastError && <span className="text-[var(--danger)]">· {u.lastError.slice(0, 60)}</span>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" loading={busy === u.userId} onClick={() => drain(u.userId)}>
                    <Send className="size-3.5" /> 补发
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => clear(u.userId)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </MotionGlassCard>
    </div>
  );
}
