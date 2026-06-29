import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Command as CommandIcon, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import type { AuthMe } from "@/lib/types";

export function LoginPage() {
  const navigate = useNavigate();
  const { data: me, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthMe>("/auth/me"),
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstRun = me && !me.passwordSet;

  // 已登录则直接进入
  if (me?.authenticated) {
    navigate("/", { replace: true });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (firstRun && password !== confirm) {
      setError("两次输入的口令不一致");
      return;
    }
    setBusy(true);
    try {
      if (firstRun) {
        await api.post("/auth/password", { newPassword: password });
      } else {
        await api.post("/auth/login", { password });
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="glass-elevated w-[min(420px,94vw)] p-8"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-[var(--accent)]/20 text-[var(--accent)]">
            <CommandIcon className="size-7" />
          </div>
          <h1 className="text-lg font-semibold">Agent 控制台</h1>
          <p className="mt-1 text-xs text-muted">
            {isLoading ? "加载中…" : firstRun ? "首次使用，请设置管理员口令" : "请输入管理员口令登录"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder={firstRun ? "设置口令（至少 4 位）" : "管理员口令"}
            className="h-11 w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
          />
          {firstRun && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再次输入口令"
              className="h-11 w-full rounded-xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/50"
            />
          )}
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <Button type="submit" variant="primary" loading={busy} className="w-full" disabled={!password}>
            {firstRun ? "设置并进入" : "登录"}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted/70">
          <ShieldCheck className="size-3.5" />
          仅本机 / 局域网 · 口令与微信 /用户 验证 同源
        </div>
      </motion.div>
    </div>
  );
}
