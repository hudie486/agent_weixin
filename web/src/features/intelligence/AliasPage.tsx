import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Tag, Plus, Trash2, ArrowRight, Globe } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, inputClass, Badge, ErrorState } from "@/components/ui/atoms";
import { useStickyState } from "@/lib/sticky";
import { cn } from "@/lib/cn";

type AliasEntry = { key: string; slash: string; createdAt: number };
type AliasResp = { user: AliasEntry[]; global: AliasEntry[] };

export function AliasPage() {
  const qc = useQueryClient();
  const [userId, setUserId] = useStickyState("wac.userId");
  const [key, setKey] = useState("");
  const [slash, setSlash] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["alias", userId],
    queryFn: () => api.get<AliasResp>(`/intelligence/alias?userId=${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["alias", userId] });

  const add = async () => {
    if (!userId.trim()) return toast.error("请先填写目标 userId");
    setBusy(true);
    try {
      await api.post("/intelligence/alias", { userId, key, slash });
      toast.success("别名已保存");
      setKey("");
      setSlash("");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k: string) => {
    try {
      await api.del("/intelligence/alias", { userId, key: k });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">别名</h1>
        <p className="text-xs text-muted">教机器人把整句精确说法当某斜杠命令（用户级，零 token 命中）</p>
      </div>

      <GlassCard className="flex items-center gap-3 p-3">
        <span className="text-[13px] text-muted">目标 userId</span>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="微信原始 ID 或 qq:c2c:<openid>"
          className={cn(inputClass, "flex-1 font-mono")}
        />
      </GlassCard>

      {!userId ? (
        <MotionGlassCard className="p-3">
          <EmptyState icon={<Tag className="size-8" />} title="先填写一个 userId" hint="别名按用户隔离，全局别名只读展示" />
        </MotionGlassCard>
      ) : (
        <>
          <MotionGlassCard className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">新增别名</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1 space-y-1">
                <div className="text-[11px] text-muted">说法（整句）</div>
                <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="比如 测一下" className={inputClass} />
              </div>
              <div className="min-w-[180px] flex-1 space-y-1">
                <div className="text-[11px] text-muted">目标命令（/ 开头）</div>
                <input value={slash} onChange={(e) => setSlash(e.target.value)} placeholder="/测试" className={cn(inputClass, "font-mono")} />
              </div>
              <Button variant="primary" loading={busy} onClick={add} disabled={!key || !slash}>
                <Plus className="size-4" /> 添加
              </Button>
            </div>
          </MotionGlassCard>

          {isError ? (
            <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
          ) : isLoading || !data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <MotionGlassCard className="p-4">
                <h2 className="mb-2 text-sm font-semibold">用户别名（{data.user.length}）</h2>
                {data.user.length === 0 ? (
                  <EmptyState title="该用户暂无别名" />
                ) : (
                  <div className="space-y-1.5">
                    {data.user.map((a) => (
                      <div key={a.key} className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-white/4 px-3 py-2">
                        <span className="text-[13px]">{a.key}</span>
                        <ArrowRight className="size-3.5 text-muted" />
                        <span className="font-mono text-[13px] text-[var(--accent)]">{a.slash}</span>
                        <button onClick={() => remove(a.key)} className="ml-auto text-muted hover:text-[var(--danger)]">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </MotionGlassCard>

              {data.global.length > 0 && (
                <GlassCard className="p-4">
                  <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <Globe className="size-3.5 text-muted" /> 全局别名 <Badge>只读</Badge>
                  </h2>
                  <div className="space-y-1.5">
                    {data.global.map((a) => (
                      <div key={a.key} className="flex items-center gap-2 px-1 text-[13px] text-muted">
                        <span>{a.key}</span>
                        <ArrowRight className="size-3.5" />
                        <span className="font-mono text-[var(--accent)]">{a.slash}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
