import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Trash2,
  Tag,
  ShieldCheck,
  MessageCircle,
  Bot,
  Variable,
  RefreshCw,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Switch, Badge, inputClass, CopyText, ErrorState } from "@/components/ui/atoms";
import { Sheet } from "@/components/ui/Overlay";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/cn";

type User = {
  userId: string;
  shortName: string | null;
  enabled: boolean;
  platform: "wechat" | "qq";
  isAdminSession: boolean;
  allowed: boolean;
  createdAt: number;
  updatedAt: number;
};
type UsersResp = {
  users: User[];
  adminPasswordSet: boolean;
  allowedUserIds: string[];
  whitelistActive: boolean;
};

export function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<UsersResp>("/users"),
    refetchInterval: 10000,
  });
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [envUser, setEnvUser] = useState<User | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const register = async () => {
    if (!newId.trim()) return;
    try {
      await api.post("/users/register", { userId: newId.trim(), shortName: newName.trim() || undefined });
      toast.success("已登记");
      setNewId("");
      setNewName("");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "登记失败");
    }
  };

  const update = async (userId: string, body: Record<string, unknown>) => {
    try {
      await api.post("/users/update", { userId, ...body });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  const setShort = (u: User) => {
    const name = prompt(`设置「${u.userId}」的简称（2~24 字，留空清除）`, u.shortName ?? "");
    if (name === null) return;
    void update(u.userId, { shortName: name.trim() || null });
  };

  const remove = async (u: User) => {
    if (!confirm(`删除用户「${u.shortName ?? u.userId}」并级联清理其环境注入 / 代码登记 / 以其为通知对象的周期任务 / 会话？此操作不可撤销。`)) return;
    try {
      await api.post("/users/delete", { userId: u.userId, confirm: true });
      toast.success("已删除并清理关联数据");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  };

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
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">用户</h1>
          <p className="text-xs text-muted">完整 userId 可点击复制（聊天里会被截断）</p>
        </div>
        <Button size="sm" onClick={refresh}>
          <RefreshCw className="size-3.5" /> 刷新
        </Button>
      </div>

      {data.whitelistActive && (
        <GlassCard className="flex items-center gap-2 p-3 text-[12px] text-muted">
          <ShieldCheck className="size-4 text-[var(--warn)]" />
          白名单已生效（ALLOWED_USER_IDS）：仅 {data.allowedUserIds.length} 个 userId 可用。不在名单内的用户标「未授权」。
        </GlassCard>
      )}

      <MotionGlassCard className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">登记新用户</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 space-y-1">
            <div className="text-[11px] text-muted">userId（微信原始 ID 或 qq:c2c:&lt;openid&gt;）</div>
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="o9cq80x... 或 qq:c2c:..." className={cn(inputClass, "font-mono")} />
          </div>
          <div className="w-32 space-y-1">
            <div className="text-[11px] text-muted">简称（可选）</div>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如 宝宝" className={inputClass} />
          </div>
          <Button variant="primary" onClick={register} disabled={!newId.trim()}>
            <Plus className="size-4" /> 登记
          </Button>
        </div>
        <p className="text-[11px] text-muted/70">
          提示：用户在微信/QQ 给机器人发消息即会自动登记；这里用于手动补登或预先授权已知 userId。
        </p>
      </MotionGlassCard>

      {data.users.length === 0 ? (
        <MotionGlassCard className="p-3">
          <EmptyState icon={<Users className="size-8" />} title="还没有登记用户" hint="让对方给机器人发条消息，或在上面手动登记" />
        </MotionGlassCard>
      ) : (
        <div className="space-y-2.5">
          {data.users.map((u) => (
            <MotionGlassCard key={u.userId} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6 text-[var(--accent)]">
                  {u.platform === "qq" ? <Bot className="size-5" /> : <MessageCircle className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{u.shortName ?? "未设简称"}</span>
                    <Badge>{u.platform === "qq" ? "QQ" : "微信"}</Badge>
                    {u.isAdminSession && <Badge className="text-[var(--ok)]">管理员(会话)</Badge>}
                    {data.whitelistActive && !u.allowed && <Badge className="text-[var(--danger)]">未授权</Badge>}
                    {!u.enabled && <Badge className="text-[var(--danger)]">已禁用</Badge>}
                  </div>
                  <div className="mt-1.5">
                    <CopyText text={u.userId} className="max-w-full" />
                  </div>
                  <div className="mt-1 text-[10px] text-muted/60">登记于 {formatClock(u.createdAt)}</div>
                </div>
                <Switch checked={u.enabled} onChange={(v) => update(u.userId, { enabled: v })} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => setShort(u)}>
                  <Tag className="size-3.5" /> {u.shortName ? "改简称" : "设简称"}
                </Button>
                <Button size="sm" onClick={() => setEnvUser(u)}>
                  <Variable className="size-3.5" /> 环境注入
                </Button>
                <Button size="sm" variant="subtle" className="text-[var(--danger)]" onClick={() => remove(u)}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              </div>
            </MotionGlassCard>
          ))}
        </div>
      )}

      <Sheet open={!!envUser} onClose={() => setEnvUser(null)} title={`环境注入 · ${envUser?.shortName ?? envUser?.userId.slice(0, 14) ?? ""}`} width={560}>
        {envUser && <EnvInjectionEditor userId={envUser.userId} />}
      </Sheet>
    </div>
  );
}

function EnvInjectionEditor({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["userEnv", userId],
    queryFn: () => api.get<{ env: Record<string, string> }>(`/users/env?userId=${encodeURIComponent(userId)}`),
  });
  const [rows, setRows] = useState<{ k: string; v: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const current = rows ?? (data ? Object.entries(data.env).map(([k, v]) => ({ k, v })) : []);

  if (isLoading || !data) return <Skeleton className="h-64" />;

  const setRow = (i: number, patch: Partial<{ k: string; v: string }>) => {
    const next = [...current];
    next[i] = { ...next[i]!, ...patch };
    setRows(next);
  };
  const addRow = () => setRows([...current, { k: "", v: "" }]);
  const delRow = (i: number) => setRows(current.filter((_, j) => j !== i));

  const save = async () => {
    const env: Record<string, string> = {};
    for (const r of current) {
      if (r.k.trim()) env[r.k.trim()] = r.v;
    }
    setBusy(true);
    try {
      await api.put("/users/env", { userId, env });
      toast.success("已保存环境注入（周期脚本运行时按 userId 注入）");
      await qc.invalidateQueries({ queryKey: ["userEnv", userId] });
      setRows(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        按 userId 隔离的环境变量；该用户的周期脚本运行时会自动注入这些值（适合放各自的 API Key 等）。
      </p>
      <div className="space-y-2">
        {current.length === 0 && <div className="py-6 text-center text-[12px] text-muted">暂无注入变量</div>}
        {current.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={r.k} onChange={(e) => setRow(i, { k: e.target.value })} placeholder="KEY" className={cn(inputClass, "w-40 font-mono")} />
            <span className="text-muted">=</span>
            <input value={r.v} onChange={(e) => setRow(i, { v: e.target.value })} placeholder="value" className={cn(inputClass, "flex-1 font-mono")} />
            <button onClick={() => delRow(i)} className="text-muted hover:text-[var(--danger)]">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button size="sm" variant="ghost" onClick={addRow}>
          <Plus className="size-3.5" /> 加一行
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );
}
