import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Play, FileCode2, Trash2, Clock, Zap, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Switch, Field, inputClass, Badge } from "@/components/ui/atoms";
import { Modal, Sheet } from "@/components/ui/Overlay";
import { RunTerminal } from "@/components/RunTerminal";
import { formatClock, formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

type Job = {
  id: string;
  kind: "schedule" | "trigger";
  shortName: string | null;
  enabled: boolean;
  notifyUserId: string;
  userPrompt: string | null;
  cronExpression: string | null;
  nextRunAt: number | null;
  deliveryMode: "stdout_nonempty" | "every_run" | null;
  generationStatus: string | null;
  lastRunAt: number | null;
  lastErrorAt: number | null;
  lastErrorSummary: string | null;
};
type JobsResp = { jobs: Job[]; defaultScript: string };

function CronPreview({ cron }: { cron: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    if (!cron.trim()) {
      setText("");
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ ok: boolean; nextRunAt?: number; error?: string }>("/periodic/preview-cron", { cron });
        if (!alive) return;
        setText(r.ok && r.nextRunAt ? `下次触发：${formatClock(r.nextRunAt)}（${formatRelative(r.nextRunAt)}）` : `⚠ ${r.error}`);
      } catch {
        /* ignore */
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cron]);
  if (!text) return null;
  return <div className={cn("text-[11px]", text.startsWith("⚠") ? "text-[var(--danger)]" : "text-[var(--ok)]")}>{text}</div>;
}

export function PeriodicPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["periodic"],
    queryFn: () => api.get<JobsResp>("/periodic/jobs"),
    refetchInterval: 10000,
  });
  const [creating, setCreating] = useState(false);
  const [scriptJob, setScriptJob] = useState<Job | null>(null);
  const [runJob, setRunJob] = useState<Job | null>(null);

  const knownUsers = useMemo(
    () => Array.from(new Set((data?.jobs ?? []).map((j) => j.notifyUserId))),
    [data],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["periodic"] });

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api.patch(`/periodic/jobs/${id}`, body);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失败");
    }
  };

  const remove = async (job: Job) => {
    if (!confirm(`删除任务「${job.shortName ?? job.id.slice(0, 8)}」及其脚本目录？`)) return;
    try {
      await api.del(`/periodic/jobs/${job.id}`, { confirm: true });
      toast.success("已删除");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">周期任务</h1>
          <p className="text-xs text-muted">CRON 走上海时区 · 脚本可在网页直接编辑（零 token）</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" /> 新建任务
          </Button>
        </div>
      </div>

      {data.jobs.length === 0 ? (
        <MotionGlassCard className="p-3">
          <EmptyState icon={<Clock className="size-8" />} title="还没有周期任务" hint="点击「新建任务」，直接写一段 run.mjs 即可" />
        </MotionGlassCard>
      ) : (
        <div className="space-y-2.5">
          {data.jobs.map((j) => (
            <MotionGlassCard key={j.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{j.shortName ?? j.id.slice(0, 8)}</span>
                    <Badge>{j.kind === "schedule" ? "定时" : "触发"}</Badge>
                    {j.cronExpression && <Badge className="font-mono">{j.cronExpression}</Badge>}
                    <Badge>{j.deliveryMode === "every_run" ? "每轮推送" : "非空才推"}</Badge>
                    {j.generationStatus && j.generationStatus !== "ready" && (
                      <Badge className="text-[var(--warn)]">{j.generationStatus}</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    <span>通知 {j.notifyUserId.slice(0, 22)}</span>
                    {j.kind === "schedule" && j.nextRunAt && (
                      <span className="text-[var(--accent)]">下次 {formatClock(j.nextRunAt)}</span>
                    )}
                    {j.lastRunAt && <span>上次 {formatRelative(j.lastRunAt)}</span>}
                    {j.lastErrorAt && <span className="text-[var(--danger)]">· 失败：{(j.lastErrorSummary ?? "").slice(0, 40)}</span>}
                  </div>
                  {j.userPrompt && <div className="mt-1 truncate text-[11px] text-muted/70">{j.userPrompt}</div>}
                </div>
                <Switch checked={j.enabled} onChange={(v) => patch(j.id, { enabled: v })} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => setRunJob(j)}>
                  <Play className="size-3.5" /> 试跑
                </Button>
                <Button size="sm" onClick={() => setScriptJob(j)}>
                  <FileCode2 className="size-3.5" /> 编辑脚本
                </Button>
                {j.kind === "schedule" && (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => {
                      const next = prompt("修改 CRON（5 段：分 时 日 月 周）", j.cronExpression ?? "");
                      if (next && next.trim() !== j.cronExpression) void patch(j.id, { cronExpression: next.trim() });
                    }}
                  >
                    <Clock className="size-3.5" /> 改 CRON
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => patch(j.id, { deliveryMode: j.deliveryMode === "every_run" ? "stdout_nonempty" : "every_run" })}
                >
                  <Zap className="size-3.5" /> 切推送
                </Button>
                <Button size="sm" variant="subtle" className="text-[var(--danger)]" onClick={() => remove(j)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </MotionGlassCard>
          ))}
        </div>
      )}

      <CreateModal
        open={creating}
        onClose={() => setCreating(false)}
        defaultScript={data.defaultScript}
        knownUsers={knownUsers}
        onCreated={() => {
          setCreating(false);
          refresh();
        }}
      />

      <Sheet open={!!scriptJob} onClose={() => setScriptJob(null)} title={`脚本 · ${scriptJob?.shortName ?? scriptJob?.id.slice(0, 8) ?? ""}`} width={640}>
        {scriptJob && <ScriptEditor jobId={scriptJob.id} />}
      </Sheet>

      <Sheet open={!!runJob} onClose={() => setRunJob(null)} title={`试跑 · ${runJob?.shortName ?? runJob?.id.slice(0, 8) ?? ""}`} width={640}>
        {runJob && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted">立即执行 run.mjs，仅在此预览输出，不推送到平台、不改任务状态。</p>
            <RunTerminal path={`/sse/periodic-run/${runJob.id}`} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

function ScriptEditor({ jobId }: { jobId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["periodic", "script", jobId],
    queryFn: () => api.get<{ entry: string; exists: boolean; content: string }>(`/periodic/jobs/${jobId}/script`),
  });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading || !data) return <Skeleton className="h-80" />;
  const value = text ?? data.content;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ ok: boolean; checkError?: string }>(`/periodic/jobs/${jobId}/script`, { content: value });
      if (r.checkError) toast.warning(`已保存，但语法检查告警：${r.checkError.slice(0, 120)}`);
      else toast.success("脚本已保存（node --check 通过）");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">{data.entry}{data.exists ? "" : "（新建）"}</span>
        <Button size="sm" variant="primary" loading={busy} onClick={save}>
          保存
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[60vh] w-full resize-none rounded-lg border border-[var(--glass-border)] bg-black/30 p-3 font-mono text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
      />
    </div>
  );
}

function CreateModal({
  open,
  onClose,
  defaultScript,
  knownUsers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultScript: string;
  knownUsers: string[];
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<"schedule" | "trigger">("schedule");
  const [cron, setCron] = useState("0 9 * * *");
  const [shortName, setShortName] = useState("");
  const [notifyUserId, setNotifyUserId] = useState(knownUsers[0] ?? "");
  const [deliveryMode, setDeliveryMode] = useState<"stdout_nonempty" | "every_run">("stdout_nonempty");
  const [userPrompt, setUserPrompt] = useState("");
  const [script, setScript] = useState(defaultScript);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setScript(defaultScript);
      setNotifyUserId(knownUsers[0] ?? "");
    }
  }, [open, defaultScript, knownUsers]);

  const submit = async () => {
    if (!notifyUserId.trim()) {
      toast.error("请填写通知对象 userId");
      return;
    }
    setBusy(true);
    try {
      await api.post("/periodic/jobs", {
        kind,
        cronExpression: kind === "schedule" ? cron : undefined,
        shortName: shortName || undefined,
        notifyUserId,
        deliveryMode,
        userPrompt,
        script,
      });
      toast.success("任务已创建");
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="新建周期任务" width={640}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <select value={kind} onChange={(e) => setKind(e.target.value as "schedule" | "trigger")} className={inputClass}>
              <option value="schedule">定时 (schedule)</option>
              <option value="trigger">触发 (trigger)</option>
            </select>
          </Field>
          <Field label="简称（可选）">
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="如 早报" className={inputClass} />
          </Field>
        </div>

        {kind === "schedule" && (
          <Field label="CRON（5 段：分 时 日 月 周，上海时区）">
            <input value={cron} onChange={(e) => setCron(e.target.value)} className={cn(inputClass, "font-mono")} placeholder="0 9 * * *" />
            <CronPreview cron={cron} />
          </Field>
        )}

        <Field label="通知对象 userId" hint="微信原始 ID 或 qq:c2c:<openid>">
          <input
            value={notifyUserId}
            onChange={(e) => setNotifyUserId(e.target.value)}
            list="known-users"
            className={cn(inputClass, "font-mono")}
            placeholder="userId"
          />
          <datalist id="known-users">
            {knownUsers.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="推送策略">
            <select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as "stdout_nonempty" | "every_run")} className={inputClass}>
              <option value="stdout_nonempty">stdout 非空才推</option>
              <option value="every_run">每轮都推（空则占位）</option>
            </select>
          </Field>
          <Field label="描述（可选）">
            <input value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} className={inputClass} placeholder="任务用途" />
          </Field>
        </div>

        <Field label="脚本 run.mjs（ESM，结果走 stdout）">
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
            className="h-56 w-full resize-y rounded-lg border border-[var(--glass-border)] bg-black/30 p-3 font-mono text-[12px] outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="subtle" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            创建任务
          </Button>
        </div>
      </div>
    </Modal>
  );
}
