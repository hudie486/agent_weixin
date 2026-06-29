import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, RotateCcw, Eye, EyeOff, FileCode2, LayoutGrid, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { GlassCard, MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { EffectBadge, Skeleton } from "@/components/ui/atoms";
import { cn } from "@/lib/cn";
import type { EnvConfigView, EnvFieldView } from "@/lib/types";

type Draft = Record<string, string>;

function isTrue(v: string): boolean {
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on";
}

function FieldControl({
  field,
  draftValue,
  editing,
  onChange,
  onToggleSecret,
}: {
  field: EnvFieldView;
  draftValue: string | undefined;
  editing: boolean;
  onChange: (v: string) => void;
  onToggleSecret: () => void;
}) {
  // 显示「真实生效值」：.env 文件值优先；未设则用进程环境实际值；再退到代码默认值。
  // （密钥不做此回填，避免把脱敏串塞进可编辑框）
  const resolved =
    field.type === "secret"
      ? field.value
      : field.set
        ? field.value
        : field.effectiveSet
          ? field.effective
          : field.def ?? "";
  const current = draftValue ?? resolved;
  const inputCls =
    "h-9 w-full rounded-lg border border-[var(--glass-border)] bg-white/5 px-3 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accent)]/40";

  if (field.type === "bool") {
    const on = isTrue(current);
    return (
      <button
        type="button"
        onClick={() => onChange(on ? "0" : "1")}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-[var(--accent)]" : "bg-white/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white transition-all",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    );
  }

  if (field.type === "enum" && field.options) {
    return (
      <select value={current} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">（默认）</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "secret") {
    if (field.set && !editing) {
      return (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-lg border border-[var(--glass-border)] bg-white/5 px-3 py-1.5 font-mono text-[13px] text-muted">
            {field.value || "••••"}
          </span>
          <Button size="sm" variant="subtle" onClick={onToggleSecret}>
            <Eye className="size-3.5" /> 替换
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draftValue ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "输入新密钥（留空=不变）"}
          className={cn(inputCls, "font-mono")}
        />
        {field.set && (
          <Button size="sm" variant="subtle" onClick={onToggleSecret}>
            <EyeOff className="size-3.5" /> 收起
          </Button>
        )}
      </div>
    );
  }

  if (field.type === "json" || field.type === "multiline") {
    return (
      <textarea
        value={current}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        rows={2}
        className={cn(inputCls, "h-auto resize-y py-2 font-mono")}
      />
    );
  }

  return (
    <input
      type={field.type === "int" ? "number" : "text"}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={inputCls}
    />
  );
}

function FieldRow({
  field,
  draft,
  secretEditing,
  setDraft,
  setSecretEditing,
}: {
  field: EnvFieldView;
  draft: Draft;
  secretEditing: Set<string>;
  setDraft: (fn: (d: Draft) => Draft) => void;
  setSecretEditing: (fn: (s: Set<string>) => Set<string>) => void;
}) {
  const dirty = field.key in draft;
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 rounded-xl px-3 py-3 sm:grid-cols-[1fr_minmax(0,360px)] sm:items-center",
        dirty && "bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]/30",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{field.label}</span>
          <EffectBadge effect={field.effect} />
          {dirty && <span className="text-[10px] text-[var(--accent)]">已修改</span>}
        </div>
        <div className="font-mono text-[10px] text-muted/70">{field.key}</div>
        {field.description && <div className="mt-0.5 text-[11px] text-muted">{field.description}</div>}
        {field.differs && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--warn)]/30 bg-[var(--warn)]/8 px-1.5 py-1 text-[10px]">
            <span className="text-[var(--warn)]">运行中</span>
            <span className="font-mono text-fg">{field.effectiveSet ? field.effective || "(空)" : "(未设置)"}</span>
            <span className="text-muted">
              {!field.set
                ? "来自进程环境（如 QQ 运行时注入 / shell），不在 .env"
                : "与 .env 不一致：改了未重启，或被进程环境覆盖"}
            </span>
          </div>
        )}
      </div>
      <FieldControl
        field={field}
        draftValue={draft[field.key]}
        editing={secretEditing.has(field.key)}
        onChange={(v) =>
          setDraft((d) => {
            const next = { ...d };
            // 与原值相同则视为未改（bool/enum/string）；secret 始终记入（无法比对原文）
            if (field.type !== "secret" && v === field.value) delete next[field.key];
            else next[field.key] = v;
            return next;
          })
        }
        onToggleSecret={() =>
          setSecretEditing((s) => {
            const next = new Set(s);
            if (next.has(field.key)) {
              next.delete(field.key);
              setDraft((d) => {
                const nd = { ...d };
                delete nd[field.key];
                return nd;
              });
            } else next.add(field.key);
            return next;
          })
        }
      />
    </div>
  );
}

function RawEditor({ onSaved }: { onSaved: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["env", "raw"],
    queryFn: () => api.get<{ raw: string; path: string }>("/config/env/raw"),
  });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const value = text ?? data.raw;
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/config/env/raw", { raw: value });
      toast.success("已保存 .env 原文（已自动备份）");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <GlassCard className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted">{data.path}</span>
        <Button size="sm" variant="primary" loading={busy} onClick={save}>
          <Save className="size-3.5" /> 保存原文
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[60vh] w-full resize-none rounded-lg border border-[var(--glass-border)] bg-black/20 p-3 font-mono text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
      />
    </GlassCard>
  );
}

export function EnvSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["env"],
    queryFn: () => api.get<EnvConfigView>("/config/env"),
  });
  const [draft, setDraft] = useState<Draft>({});
  const [secretEditing, setSecretEditing] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<string>("平台");
  const [rawMode, setRawMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restartPending, setRestartPending] = useState(false);

  const groups = useMemo(() => {
    if (!data) return [];
    const order: string[] = [];
    const map = new Map<string, EnvConfigView["categories"]>();
    for (const c of data.categories) {
      if (!map.has(c.group)) {
        map.set(c.group, []);
        order.push(c.group);
      }
      map.get(c.group)!.push(c);
    }
    return order.map((g) => ({ group: g, categories: map.get(g)! }));
  }, [data]);

  const dirtyCount = Object.keys(draft).length;

  const fieldByKey = useMemo(() => {
    const m = new Map<string, EnvFieldView>();
    data?.categories.forEach((c) => c.fields.forEach((f) => m.set(f.key, f)));
    return m;
  }, [data]);

  const save = async () => {
    if (dirtyCount === 0) return;
    setBusy(true);
    try {
      await api.patch("/config/env", { changes: draft });
      const touchedRestart = Object.keys(draft).some((k) => fieldByKey.get(k)?.effect === "restart");
      setRestartPending((p) => p || touchedRestart);
      setDraft({});
      setSecretEditing(new Set());
      await qc.invalidateQueries({ queryKey: ["env"] });
      toast.success(`已保存 ${dirtyCount} 项变更（已自动备份 .env）`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    try {
      await api.post("/system/restart", { confirm: true });
      toast.info("已请求重启，等待进程拉起…");
      setRestartPending(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "重启失败（可能无外部守护）");
    }
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const active = groups.find((g) => g.group === activeGroup) ?? groups[0];

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">环境变量</h1>
          <p className="text-xs text-muted">{data.path}</p>
        </div>
        <Button size="sm" variant={rawMode ? "ghost" : "primary"} onClick={() => setRawMode(false)}>
          <LayoutGrid className="size-3.5" /> 分类表单
        </Button>
        <Button size="sm" variant={rawMode ? "primary" : "ghost"} onClick={() => setRawMode(true)}>
          <FileCode2 className="size-3.5" /> 原文
        </Button>
      </div>

      {restartPending && (
        <MotionGlassCard className="flex items-center gap-3 border-[var(--warn)]/30 bg-[var(--warn)]/10 p-3">
          <AlertTriangle className="size-4 text-[var(--warn)]" />
          <span className="text-[13px]">部分改动为「需重启」项，重启后生效。</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="subtle" onClick={() => setRestartPending(false)}>
              稍后
            </Button>
            <Button size="sm" variant="primary" onClick={restart}>
              <RotateCcw className="size-3.5" /> 立即重启
            </Button>
          </div>
        </MotionGlassCard>
      )}

      {rawMode ? (
        <RawEditor onSaved={() => qc.invalidateQueries({ queryKey: ["env"] })} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <button
                key={g.group}
                onClick={() => setActiveGroup(g.group)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  g.group === active.group
                    ? "bg-[var(--accent)]/18 text-fg"
                    : "text-muted hover:bg-white/6 hover:text-fg",
                )}
              >
                {g.group}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {active.categories.map((cat) => (
              <MotionGlassCard key={cat.id} className="p-4">
                <h2 className="mb-1 px-1 text-sm font-semibold">{cat.label}</h2>
                <div className="divide-y divide-[var(--glass-border)]">
                  {cat.fields.map((f) => (
                    <FieldRow
                      key={f.key}
                      field={f}
                      draft={draft}
                      secretEditing={secretEditing}
                      setDraft={setDraft}
                      setSecretEditing={setSecretEditing}
                    />
                  ))}
                </div>
              </MotionGlassCard>
            ))}
          </div>
        </>
      )}

      {!rawMode && dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <GlassCard
            elevated
            className="flex items-center gap-3 px-4 py-2.5 shadow-2xl"
          >
            <span className="text-[13px]">{dirtyCount} 项未保存</span>
            <Button size="sm" variant="subtle" onClick={() => { setDraft({}); setSecretEditing(new Set()); }}>
              放弃
            </Button>
            <Button size="sm" variant="primary" loading={busy} onClick={save}>
              <Save className="size-3.5" /> 保存
            </Button>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
