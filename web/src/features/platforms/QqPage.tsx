import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Plug, PlugZap, ShieldCheck, Power } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { GlassCard, MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { StatusDot, Skeleton, Switch, Field, inputClass } from "@/components/ui/atoms";
import { cn } from "@/lib/cn";

type QqStatus = {
  configured: boolean;
  connected: boolean;
  appId?: string;
  instanceId?: string;
  sandbox?: boolean;
  enabled?: boolean;
  savedAt: number | null;
  clientSecretMasked?: string;
  botTokenMasked?: string;
  intentsRaw?: string | null;
};

export function QqPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["qq", "status"],
    queryFn: () => api.get<QqStatus>("/platforms/qq/status"),
    refetchInterval: 5000,
  });

  const [appId, setAppId] = useState("");
  const [credType, setCredType] = useState<"secret" | "token">("secret");
  const [cred, setCred] = useState("");
  const [sandbox, setSandbox] = useState(false);
  const [intentsRaw, setIntentsRaw] = useState("");
  const [busy, setBusy] = useState<"" | "validate" | "connect" | "disconnect">("");

  const payload = () => ({
    appId,
    clientSecret: credType === "secret" ? cred : undefined,
    botToken: credType === "token" ? cred : undefined,
    sandbox,
    intentsRaw: intentsRaw.trim() || undefined,
  });

  const validate = async () => {
    setBusy("validate");
    try {
      const r = await api.post<{ ok: boolean; error?: string }>("/platforms/qq/validate", payload());
      if (r.ok) toast.success("凭证校验通过");
      else toast.error(r.error ?? "校验失败");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "校验失败");
    } finally {
      setBusy("");
    }
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const r = await api.post<{ ok: boolean; message?: string; error?: string }>(
        "/platforms/qq/connect",
        payload(),
      );
      if (r.ok) {
        toast.success(r.message ?? "已连接");
        setCred("");
      } else toast.error(r.error ?? r.message ?? "连接失败");
      await qc.invalidateQueries({ queryKey: ["qq", "status"] });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "连接失败");
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    if (!confirm("断开并清除本地 QQ 凭证？")) return;
    setBusy("disconnect");
    try {
      await api.post("/platforms/qq/disconnect");
      toast.success("已断开并清除凭证");
      await qc.invalidateQueries({ queryKey: ["qq", "status"] });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "断开失败");
    } finally {
      setBusy("");
    }
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">QQ 机器人</h1>

      <MotionGlassCard className="flex items-center gap-4 p-5">
        <div
          className="grid size-12 place-items-center rounded-xl"
          style={{
            background: data.connected ? "color-mix(in srgb, var(--ok) 18%, transparent)" : "rgba(255,255,255,.06)",
            color: data.connected ? "var(--ok)" : "var(--fg-muted)",
          }}
        >
          <Bot className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={data.connected ? "online" : data.configured ? "warn" : "offline"} />
            <span className="text-sm font-semibold">
              {data.connected ? "WebSocket 已连接" : data.configured ? "已配置 · 未连接" : "未配置"}
            </span>
          </div>
          <div className="text-[11px] text-muted">
            {data.appId ? `AppID ${data.appId} · 实例 ${data.instanceId ?? "qq-main"}` : "尚未填写凭证"}
            {data.savedAt ? ` · 保存于 ${new Date(data.savedAt).toLocaleString("zh-CN")}` : ""}
          </div>
        </div>
        {data.configured && (
          <Button size="sm" variant="danger" className="ml-auto" loading={busy === "disconnect"} onClick={disconnect}>
            <Power className="size-3.5" /> 断开
          </Button>
        )}
      </MotionGlassCard>

      <MotionGlassCard className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">配置接入凭证</h2>
        <Field label="AppID">
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="开放平台 AppID" className={inputClass} />
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-medium">凭证</div>
            <div className="ml-auto flex rounded-lg border border-[var(--glass-border)] p-0.5">
              {(["secret", "token"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setCredType(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px]",
                    credType === t ? "bg-[var(--accent)]/20 text-fg" : "text-muted",
                  )}
                >
                  {t === "secret" ? "ClientSecret" : "BotToken"}
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            value={cred}
            onChange={(e) => setCred(e.target.value)}
            placeholder={credType === "secret" ? "ClientSecret" : "BotToken（QQBot. 开头）"}
            className={cn(inputClass, "font-mono")}
          />
          {(data.clientSecretMasked || data.botTokenMasked) && !cred && (
            <div className="text-[11px] text-muted">
              已保存：{data.clientSecretMasked ? `Secret ${data.clientSecretMasked}` : `Token ${data.botTokenMasked}`}（留空=沿用）
            </div>
          )}
        </div>

        <Field label="Intents" hint="逗号分隔：C2C,DIRECT_MESSAGE,PUBLIC_GUILD_MESSAGES（留空=默认）">
          <input
            value={intentsRaw}
            onChange={(e) => setIntentsRaw(e.target.value)}
            placeholder={data.intentsRaw ?? "C2C,DIRECT_MESSAGE,PUBLIC_GUILD_MESSAGES"}
            className={cn(inputClass, "font-mono")}
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-[var(--glass-border)] bg-white/4 px-3 py-2.5">
          <div>
            <div className="text-[13px] font-medium">沙箱环境</div>
            <div className="text-[11px] text-muted">QQ_BOT_SANDBOX</div>
          </div>
          <Switch checked={sandbox} onChange={setSandbox} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" loading={busy === "validate"} onClick={validate} disabled={!appId || !cred}>
            <ShieldCheck className="size-4" /> 仅校验
          </Button>
          <Button variant="primary" loading={busy === "connect"} onClick={connect} disabled={!appId || (!cred && !data.configured)}>
            {data.connected ? <PlugZap className="size-4" /> : <Plug className="size-4" />} 保存并连接
          </Button>
        </div>
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        <div className="mb-1 font-medium text-fg">提示</div>
        保存前会请求 QQ 开放平台校验 AppID/Secret。若提示 <span className="font-mono">fetch failed</span> 多为本机出网问题，而非凭证一定错；
        WebSocket 关闭码 <span className="font-mono">4004</span> 表示鉴权失败，请核对凭证与沙箱开关。
      </GlassCard>
    </div>
  );
}
