import { type ReactNode, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EnvEffect } from "@/lib/types";

/** 完整文本 + 一键复制（解决聊天里 userId 被截断的问题）。 */
export function CopyText({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 退化：选中文本
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      onClick={copy}
      title="点击复制"
      className={cn(
        "group inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--glass-border)] bg-white/5 px-2 py-0.5 font-mono text-[12px] hover:bg-white/10",
        className,
      )}
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-[var(--ok)]" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-muted group-hover:text-fg" />
      )}
    </button>
  );
}

export function StatusDot({ state }: { state: "online" | "warn" | "offline" | "error" }) {
  const color =
    state === "online"
      ? "var(--ok)"
      : state === "warn"
        ? "var(--warn)"
        : state === "error"
          ? "var(--danger)"
          : "rgba(255,255,255,0.35)";
  return (
    <span className="relative inline-flex size-2.5">
      {(state === "online" || state === "warn") && (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      )}
      <span className="relative inline-flex size-2.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

const effectStyle: Record<EnvEffect, { label: string; cls: string }> = {
  instant: { label: "即时生效", cls: "text-[var(--ok)] bg-[var(--ok)]/12 border-[var(--ok)]/30" },
  hot: { label: "热加载", cls: "text-[var(--accent)] bg-[var(--accent)]/12 border-[var(--accent)]/30" },
  restart: { label: "需重启", cls: "text-[var(--warn)] bg-[var(--warn)]/12 border-[var(--warn)]/30" },
};

export function EffectBadge({ effect }: { effect: EnvEffect }) {
  const s = effectStyle[effect];
  return (
    <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none", s.cls)}>
      {s.label}
    </span>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-white/5 px-2 py-0.5 text-[11px] text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-white/8", className)} />;
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-[var(--accent)]" : "bg-white/15",
      )}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="text-[13px] font-medium">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-[var(--glass-border)] bg-white/5 px-3 text-[13px] outline-none focus:ring-2 focus:ring-[var(--accent)]/40";

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="glass flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-[var(--danger)]/15 text-[var(--danger)]">
        <span className="text-xl leading-none">!</span>
      </div>
      <div className="text-sm font-medium text-fg">加载失败</div>
      <div className="max-w-md break-words text-xs text-muted">{message || "请求未成功"}</div>
      <div className="text-[11px] text-muted/70">
        若提示 404，多为后端未加载新接口——请重启机器人进程（npm run dev / 重新 npm start）。
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-lg border border-[var(--glass-border)] bg-white/5 px-3 py-1.5 text-[12px] text-fg hover:bg-white/10"
        >
          重试
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted opacity-60">{icon}</div>}
      <div className="text-sm font-medium text-fg">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted">{hint}</div>}
    </div>
  );
}
