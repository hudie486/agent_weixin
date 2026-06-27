import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Database, Plus, Trash2, Sparkles, SlidersHorizontal, BrainCircuit } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, inputClass, Badge, ErrorState } from "@/components/ui/atoms";
import { useStickyState } from "@/lib/sticky";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

type Curve = {
  halfLifeDays: number;
  forgottenRetention: number;
  alwaysImportance: number;
  pruneRetention: number;
  keepImportance: number;
};
type MemStatus = {
  memoryEnabled: boolean;
  vectorEnabled: boolean;
  autoExtract: boolean;
  consolidateEnabled: boolean;
  recallTopK: number;
  curve: Curve;
};
type Profile = { callName?: string; preferences: string[]; standingFacts: string[]; updatedAt: number };
type Note = { id: string; text: string; createdAt: number; importance: number };

function ForgettingCurve({ curve }: { curve: Curve }) {
  const W = 460;
  const H = 150;
  const days = curve.halfLifeDays * 6;
  const pad = { l: 30, r: 10, t: 10, b: 20 };
  const x = (d: number) => pad.l + (d / days) * (W - pad.l - pad.r);
  const y = (r: number) => pad.t + (1 - r) * (H - pad.t - pad.b);
  const series = [
    { imp: 0, color: "var(--fg-muted)" },
    { imp: 0.5, color: "var(--accent)" },
    { imp: 0.8, color: "var(--ok)" },
  ];
  const path = (imp: number) => {
    const hl = curve.halfLifeDays * (1 + 5 * imp);
    const pts: string[] = [];
    for (let d = 0; d <= days; d += days / 60) {
      pts.push(`${x(d).toFixed(1)},${y(Math.pow(0.5, d / hl)).toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 遗忘阈值线 */}
      <line x1={pad.l} x2={W - pad.r} y1={y(curve.forgottenRetention)} y2={y(curve.forgottenRetention)} stroke="var(--danger)" strokeDasharray="4 3" strokeWidth="1" opacity="0.5" />
      <text x={W - pad.r} y={y(curve.forgottenRetention) - 3} textAnchor="end" className="fill-[var(--danger)]" fontSize="9">
        遗忘阈值 {curve.forgottenRetention}
      </text>
      {/* 轴 */}
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke="var(--glass-border)" />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--glass-border)" />
      <text x={pad.l} y={H - 6} fontSize="9" className="fill-[var(--fg-muted)]">0d</text>
      <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="9" className="fill-[var(--fg-muted)]">{Math.round(days)}d</text>
      {series.map((s) => (
        <path key={s.imp} d={path(s.imp)} fill="none" stroke={s.color} strokeWidth="1.8" />
      ))}
    </svg>
  );
}

export function MemoryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [userId, setUserId] = useStickyState("wac.userId");
  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["memory", "status"],
    queryFn: () => api.get<MemStatus>("/intelligence/memory/status"),
  });
  const { data: profile } = useQuery({
    queryKey: ["memory", "profile", userId],
    queryFn: () => api.get<{ profile: Profile; notesCount: number }>(`/intelligence/memory/profile?userId=${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });
  const { data: notesData } = useQuery({
    queryKey: ["memory", "notes", userId],
    queryFn: () => api.get<{ notes: Note[]; vectorEnabled: boolean }>(`/intelligence/memory/notes?userId=${encodeURIComponent(userId)}`),
    enabled: !!userId,
  });

  const [callName, setCallName] = useState("");
  const [pref, setPref] = useState("");
  const [fact, setFact] = useState("");
  const [noteText, setNoteText] = useState("");

  const refreshProfile = () => qc.invalidateQueries({ queryKey: ["memory", "profile", userId] });
  const refreshNotes = () => qc.invalidateQueries({ queryKey: ["memory", "notes", userId] });

  const patchProfile = async (body: Record<string, unknown>) => {
    try {
      await api.patch("/intelligence/memory/profile", { userId, ...body });
      refreshProfile();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  const addNote = async () => {
    try {
      const r = await api.post<{ added?: boolean; reinforced?: boolean }>("/intelligence/memory/notes", { userId, text: noteText });
      toast.success(r.reinforced ? "与已有笔记相似，已强化" : "笔记已添加");
      setNoteText("");
      refreshNotes();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  };

  const removeNote = async (text: string) => {
    await api.del("/intelligence/memory/notes", { userId, text }).catch(() => {});
    refreshNotes();
  };

  const consolidate = async () => {
    try {
      const r = await api.post<{ scope: string; pruned?: number }>("/intelligence/memory/consolidate", userId ? { userId } : {});
      toast.success(r.scope === "user" ? `已巩固：清除 ${r.pruned ?? 0} 条遗忘笔记` : "已巩固全部用户");
      refreshNotes();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "巩固失败");
    }
  };

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }
  if (isLoading || !status) {
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
        <h1 className="text-xl font-semibold">记忆与向量</h1>
        <Button size="sm" onClick={() => navigate("/system/env")}>
          <SlidersHorizontal className="size-3.5" /> 配置
        </Button>
      </div>

      <MotionGlassCard className="p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge className={status.memoryEnabled ? "text-[var(--ok)]" : ""}>记忆 {status.memoryEnabled ? "开" : "关"}</Badge>
          <Badge className={status.vectorEnabled ? "text-[var(--ok)]" : ""}>向量 {status.vectorEnabled ? "开" : "关"}</Badge>
          <Badge>自动抽取 {status.autoExtract ? "开" : "关"}</Badge>
          <Badge>定时巩固 {status.consolidateEnabled ? "开" : "关"}</Badge>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={consolidate}>
            <BrainCircuit className="size-3.5" /> 立即巩固
          </Button>
        </div>
        <div className="text-[11px] text-muted">遗忘曲线（保留度 = 0.5^(天数/半衰期)，半衰期随重要度变长）：</div>
        <ForgettingCurve curve={status.curve} />
        <div className="flex gap-4 text-[10px] text-muted">
          <span className="text-[var(--fg-muted)]">— importance 0</span>
          <span className="text-[var(--accent)]">— 0.5</span>
          <span className="text-[var(--ok)]">— 0.8</span>
          <span>半衰期基线 {status.curve.halfLifeDays} 天</span>
        </div>
      </MotionGlassCard>

      <GlassCard className="flex items-center gap-3 p-3">
        <span className="text-[13px] text-muted">目标 userId</span>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="userId" className={cn(inputClass, "flex-1 font-mono")} />
      </GlassCard>

      {!userId ? (
        <MotionGlassCard className="p-3">
          <EmptyState icon={<Database className="size-8" />} title="填写 userId 查看其档案与笔记" />
        </MotionGlassCard>
      ) : (
        <>
          <MotionGlassCard className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">结构化档案（每轮注入）</h2>
            <div className="flex items-center gap-2">
              <span className="w-16 text-[12px] text-muted">称呼</span>
              <input
                value={callName}
                onChange={(e) => setCallName(e.target.value)}
                placeholder={profile?.profile.callName ?? "未设置"}
                className={inputClass}
              />
              <Button size="sm" onClick={() => callName.trim() && patchProfile({ callName })} disabled={!callName.trim()}>
                设置
              </Button>
            </div>

            <div>
              <div className="mb-1 text-[12px] text-muted">偏好</div>
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {(profile?.profile.preferences ?? []).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-white/5 px-2 py-0.5 text-[12px]">
                    {p}
                    <button onClick={() => patchProfile({ removeItem: p })} className="text-muted hover:text-[var(--danger)]">
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                ))}
                {(profile?.profile.preferences.length ?? 0) === 0 && <span className="text-[11px] text-muted/60">暂无</span>}
              </div>
              <div className="flex gap-2">
                <input value={pref} onChange={(e) => setPref(e.target.value)} placeholder="新增偏好" className={inputClass} />
                <Button size="sm" onClick={() => pref.trim() && (patchProfile({ addPreference: pref }), setPref(""))} disabled={!pref.trim()}>
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-1 text-[12px] text-muted">长期事实</div>
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {(profile?.profile.standingFacts ?? []).map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-white/5 px-2 py-0.5 text-[12px]">
                    {p}
                    <button onClick={() => patchProfile({ removeItem: p })} className="text-muted hover:text-[var(--danger)]">
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                ))}
                {(profile?.profile.standingFacts.length ?? 0) === 0 && <span className="text-[11px] text-muted/60">暂无</span>}
              </div>
              <div className="flex gap-2">
                <input value={fact} onChange={(e) => setFact(e.target.value)} placeholder="新增长期事实" className={inputClass} />
                <Button size="sm" onClick={() => fact.trim() && (patchProfile({ addFact: fact }), setFact(""))} disabled={!fact.trim()}>
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
          </MotionGlassCard>

          <MotionGlassCard className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">情景笔记（向量）</h2>
              <Badge>{notesData?.notes.length ?? 0} 条</Badge>
            </div>
            {!notesData?.vectorEnabled && <p className="text-[11px] text-[var(--warn)]">向量未启用（VECTOR_ENABLE=0），笔记不可用</p>}
            <div className="flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && noteText.trim() && addNote()}
                placeholder="记一条事实，如 用户对花生过敏"
                className={inputClass}
                disabled={!notesData?.vectorEnabled}
              />
              <Button size="sm" variant="primary" onClick={addNote} disabled={!noteText.trim() || !notesData?.vectorEnabled}>
                <Sparkles className="size-3.5" /> 记下
              </Button>
            </div>
            <div className="space-y-1.5">
              {(notesData?.notes ?? []).map((n) => (
                <div key={n.id} className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-white/4 px-3 py-2">
                  <span className="flex-1 text-[13px]">{n.text}</span>
                  <Badge>imp {n.importance.toFixed(2)}</Badge>
                  <span className="text-[10px] text-muted">{formatRelative(n.createdAt)}</span>
                  <button onClick={() => removeNote(n.text)} className="text-muted hover:text-[var(--danger)]">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {(notesData?.notes.length ?? 0) === 0 && notesData?.vectorEnabled && (
                <div className="py-4 text-center text-[12px] text-muted">暂无笔记</div>
              )}
            </div>
          </MotionGlassCard>
        </>
      )}
    </div>
  );
}
