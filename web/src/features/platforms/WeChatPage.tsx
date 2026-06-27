import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { QrCode, RefreshCw, Wifi, WifiOff, SlidersHorizontal, ScanLine, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { GlassCard, MotionGlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { StatusDot, Skeleton } from "@/components/ui/atoms";
import { Modal } from "@/components/ui/Overlay";
import { toast } from "sonner";

type WeChatStatus = { enabled: boolean; hasAdmin: boolean; online: boolean; busy: boolean };
type WxLoginEvent =
  | { type: "qr"; dataUrl: string; url: string }
  | { type: "scanned" }
  | { type: "online" }
  | { type: "error"; message: string };

export function WeChatPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["wechat", "status"],
    queryFn: () => api.get<WeChatStatus>("/platforms/wechat/status"),
    refetchInterval: 5000,
  });

  const [loginActive, setLoginActive] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("");

  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addQr, setAddQr] = useState<{ dataUrl: string; qrUrl: string } | null>(null);

  const addWechatUser = async () => {
    setAddOpen(true);
    setAddQr(null);
    setAddBusy(true);
    try {
      const r = await api.post<{ ok: boolean; dataUrl?: string; qrUrl?: string; error?: string }>(
        "/platforms/wechat/add-user",
      );
      if (r.ok && (r.dataUrl || r.qrUrl)) setAddQr({ dataUrl: r.dataUrl ?? "", qrUrl: r.qrUrl ?? "" });
      else toast.error(r.error ?? "获取二维码失败");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "请求失败");
    } finally {
      setAddBusy(false);
    }
  };

  useSSE<WxLoginEvent>(
    "/sse/wechat-login",
    (e) => {
      if (e.type === "qr") {
        setQr(e.dataUrl || null);
        setPhase("请用微信扫描二维码");
      } else if (e.type === "scanned") {
        setPhase("已扫码，请在手机上确认…");
      } else if (e.type === "online") {
        setPhase("");
        setQr(null);
        setLoginActive(false);
        toast.success("微信已上线");
        void qc.invalidateQueries({ queryKey: ["wechat", "status"] });
        void qc.invalidateQueries({ queryKey: ["status"] });
      } else if (e.type === "error") {
        setPhase("");
        setQr(null);
        toast.error(`登录失败：${e.message}`);
      }
    },
    { enabled: loginActive },
  );

  const startLogin = async () => {
    setLoginActive(true);
    setQr(null);
    setPhase("正在请求二维码…");
    try {
      const r = await api.post<{ started: boolean; reason?: string }>("/platforms/wechat/login");
      if (!r.started) {
        setPhase("");
        if (r.reason?.includes("已在线")) {
          toast.info("微信已在线");
          setLoginActive(false);
        } else {
          toast.error(r.reason ?? "无法发起登录");
          setLoginActive(false);
        }
      }
    } catch (e) {
      setLoginActive(false);
      setPhase("");
      toast.error(e instanceof ApiError ? e.message : "请求失败");
    }
  };

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
        <h1 className="text-xl font-semibold">微信</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={addWechatUser}>
            <UserPlus className="size-3.5" /> 添加微信账号
          </Button>
          <Button size="sm" onClick={() => navigate("/system/env")}>
            <SlidersHorizontal className="size-3.5" /> 更多设置
          </Button>
        </div>
      </div>

      <MotionGlassCard className="flex items-center gap-4 p-5">
        <div
          className="grid size-12 place-items-center rounded-xl"
          style={{
            background: data.online ? "color-mix(in srgb, var(--ok) 18%, transparent)" : "rgba(255,255,255,.06)",
            color: data.online ? "var(--ok)" : "var(--fg-muted)",
          }}
        >
          {data.online ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={data.online ? "online" : data.enabled ? "warn" : "offline"} />
            <span className="text-sm font-semibold">
              {!data.enabled ? "已禁用" : data.online ? "在线" : data.busy ? "扫码登录中" : "离线"}
            </span>
          </div>
          <div className="text-[11px] text-muted">
            {!data.enabled
              ? "WECHAT_ENABLED=0：在「环境变量 · 微信」中开启并重启"
              : data.hasAdmin
                ? "管理员实例已就绪"
                : "管理员实例未就绪"}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["wechat", "status"] })}
          >
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          {data.enabled && !data.online && (
            <Button size="sm" variant="primary" onClick={startLogin} loading={loginActive && !qr}>
              <ScanLine className="size-3.5" /> 扫码登录
            </Button>
          )}
        </div>
      </MotionGlassCard>

      {loginActive && (
        <MotionGlassCard className="flex flex-col items-center gap-4 p-8">
          <div className="grid size-[260px] place-items-center rounded-2xl border border-[var(--glass-border)] bg-white/5">
            {qr ? (
              <motion.img
                key={qr}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                src={qr}
                alt="微信登录二维码"
                className="size-[230px] rounded-xl bg-white p-2"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted">
                <QrCode className="size-10 animate-pulse" />
                <span className="text-xs">{phase || "等待二维码…"}</span>
              </div>
            )}
          </div>
          {qr && <div className="text-sm text-muted">{phase}</div>}
          <Button size="sm" variant="subtle" onClick={() => { setLoginActive(false); setQr(null); }}>
            取消
          </Button>
        </MotionGlassCard>
      )}

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        <div className="mb-1 font-medium text-fg">说明</div>
        <p className="mb-1">
          <b className="text-fg">扫码登录</b>：管理员实例离线时重新登录你自己的微信（二维码经 SSE 实时推送）。
        </p>
        <p>
          <b className="text-fg">添加微信账号</b>：生成新的扫码二维码，让<b>另一个微信</b>扫码登录、成为本服务受控的 Bot（多账号）。等价于
          <span className="font-mono"> /用户 添加 微信 </span>。若长时间拿不到二维码或频繁掉线，多为本机到
          <span className="font-mono"> ilinkai.weixin.qq.com </span>的网络/代理问题。
        </p>
      </GlassCard>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="添加微信账号（扫码登录）" width={420}>
        <div className="flex flex-col items-center gap-4">
          <div className="grid size-[260px] place-items-center rounded-2xl border border-[var(--glass-border)] bg-white/5">
            {addQr?.dataUrl ? (
              <motion.img
                key={addQr.dataUrl}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                src={addQr.dataUrl}
                alt="微信添加账号二维码"
                className="size-[230px] rounded-xl bg-white p-2"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted">
                <QrCode className="size-10 animate-pulse" />
                <span className="text-xs">{addBusy ? "正在生成二维码…" : "二维码加载失败"}</span>
              </div>
            )}
          </div>
          <p className="text-center text-[12px] text-muted">
            用<b className="text-fg">要添加的那个微信</b>扫码并确认登录（约 60 秒内有效）。<br />
            登录成功后它会成为受控 Bot；之后对方给它发消息即自动登记为用户。
          </p>
          <Button size="sm" variant="subtle" onClick={() => setAddOpen(false)}>
            关闭
          </Button>
        </div>
      </Modal>
    </div>
  );
}
