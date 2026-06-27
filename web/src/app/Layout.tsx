import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeft,
  Command as CommandIcon,
  Sun,
  Moon,
  LogOut,
  Circle,
  Menu,
  Sparkles,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { toggleTheme, useTheme, useBlur, setBlur } from "@/lib/theme";
import { NAV } from "./nav";
import { openCommandPalette } from "./commandPaletteStore";
import type { StatusResponse } from "@/lib/types";

function EnvPill() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<StatusResponse>("/status"),
    refetchInterval: 8000,
  });
  const env = data?.health.env;
  if (!env) return null;
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] font-medium",
        env === "dev"
          ? "border-[var(--warn)]/40 bg-[var(--warn)]/12 text-[var(--warn)]"
          : "border-[var(--ok)]/40 bg-[var(--ok)]/12 text-[var(--ok)]",
      )}
    >
      {env === "dev" ? "DEV" : "PROD"}
    </span>
  );
}

function ConnLights() {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.get<StatusResponse>("/status"),
    refetchInterval: 8000,
  });
  if (!data) return null;
  return (
    <div className="flex items-center gap-2">
      {data.platforms.map((p) => (
        <span key={p.id} className="flex items-center gap-1 text-[11px] text-muted" title={p.detail}>
          <Circle
            className="size-2"
            fill={p.online ? "var(--ok)" : p.enabled ? "var(--warn)" : "rgba(255,255,255,.3)"}
            stroke="none"
          />
          {p.label}
        </span>
      ))}
    </div>
  );
}

function IconButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "grid size-9 place-items-center rounded-lg border border-[var(--glass-border)] bg-white/5 text-muted hover:text-fg",
        active && "text-[var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const blur = useBlur();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.clear();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-full w-full gap-3 p-3">
      {/* 移动端遮罩 */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: collapsed ? 76 : 248 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "glass flex shrink-0 flex-col overflow-hidden p-3",
          // 移动端：固定为抽屉，覆盖宽度并按开关平移
          "max-md:fixed max-md:inset-y-3 max-md:left-3 max-md:z-50 max-md:!w-[256px] max-md:shadow-2xl max-md:transition-transform",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-[130%]",
        )}
      >
        <div className="mb-4 flex items-center gap-2 px-1">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/20 text-[var(--accent)]">
            <CommandIcon className="size-5" />
          </div>
          {(!collapsed || mobileOpen) && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Agent 控制台</div>
              <div className="truncate text-[10px] text-muted">wechat-agent-bot</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto pr-1">
          {NAV.map((g, i) => (
            <div key={i} className="space-y-1">
              {(!collapsed || mobileOpen) && g.group && (
                <div className="px-2 text-[10px] font-medium uppercase tracking-wider text-muted/70">{g.group}</div>
              )}
              {g.items.map((it) => (
                <NavLink
                  key={it.path}
                  to={it.path}
                  end={it.path === "/"}
                  title={it.label}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] transition-colors",
                      isActive
                        ? "bg-[var(--accent)]/18 text-fg shadow-[inset_0_0_0_1px_var(--glass-border)]"
                        : "text-muted hover:bg-white/6 hover:text-fg",
                    )
                  }
                >
                  <it.icon className="size-[18px] shrink-0" />
                  {(!collapsed || mobileOpen) && <span className="truncate">{it.label}</span>}
                  {(!collapsed || mobileOpen) && it.ready === undefined && (
                    <span className="ml-auto text-[9px] text-muted/50">soon</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="mt-3 flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-muted hover:bg-white/6 hover:text-fg max-md:hidden"
        >
          {collapsed ? <PanelLeft className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && <span>收起</span>}
        </button>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="glass flex h-14 shrink-0 items-center gap-3 px-4">
          <button
            onClick={() => setMobileOpen(true)}
            title="菜单"
            className="grid size-9 place-items-center rounded-lg border border-[var(--glass-border)] bg-white/5 text-muted hover:text-fg md:hidden"
          >
            <Menu className="size-4" />
          </button>
          <EnvPill />
          <div className="hidden sm:block">
            <ConnLights />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openCommandPalette}
              className="flex items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-white/5 px-2.5 py-1.5 text-[12px] text-muted hover:text-fg"
            >
              <CommandIcon className="size-3.5" />
              <span className="hidden md:inline">命令面板</span>
              <kbd className="rounded bg-white/10 px-1 text-[10px]">⌘K</kbd>
            </button>
            <IconButton onClick={() => setBlur(!blur)} title={blur ? "关闭毛玻璃（省 GPU / 可达性）" : "开启毛玻璃"} active={blur}>
              <Sparkles className="size-4" />
            </IconButton>
            <IconButton onClick={toggleTheme} title="切换主题">
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
            <IconButton onClick={logout} title="退出登录">
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto pr-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
