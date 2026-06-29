import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, Play, Power, PowerOff, SlidersHorizontal, ExternalLink, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { StatusDot, Skeleton, inputClass, EmptyState, ErrorState, Switch } from "@/components/ui/atoms";
import { Sheet } from "@/components/ui/Overlay";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/cn";

type WsStatus = {
  enabled: boolean;
  flagOn: boolean;
  url: string | null;
  running: boolean;
  processUp: boolean;
  reachable: boolean;
  uptimeMs: number;
  topK: number;
  autostart: boolean;
};
type WebResult = { title: string; url: string; content: string };
type Diag =
  | { ok: true; count: number; results: WebResult[] }
  | { ok: false; stage: string; error: string; hint?: string; status?: number };

export function WebsearchPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["websearch", "status"],
    queryFn: () => api.get<WsStatus>("/intelligence/websearch/status"),
    refetchInterval: 8000,
  });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[] | null>(null);

  const viewLog = async () => {
    setLogOpen(true);
    setLogLines(null);
    try {
      const r = await api.get<{ lines: string[] }>("/intelligence/websearch/searxng/log");
      setLogLines(r.lines);
    } catch {
      setLogLines(["(读取日志失败)"]);
    }
  };

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ["websearch", "status"] });

  const search = async () => {
    setBusy(true);
    setDiag(null);
    try {
      const r = await api.post<Diag & { error?: string }>("/intelligence/websearch/test", { query });
      setDiag(r);
    } catch (e) {
      setDiag({ ok: false, stage: "network", error: e instanceof ApiError ? e.message : "检索请求失败" });
    } finally {
      setBusy(false);
    }
  };

  const toggleSearxng = async (start: boolean) => {
    try {
      const r = await api.post<{ ok: boolean; message?: string }>(`/intelligence/websearch/searxng/${start ? "start" : "stop"}`);
      if (r.ok) toast.success(r.message ?? (start ? "已启动" : "已停止"));
      else toast.error(r.message ?? "操作失败");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  };

  const saveEnable = async (flagOn: boolean, url: string) => {
    setSaving(true);
    try {
      await api.patch("/config/env", { changes: { WEBSEARCH_ENABLE: flagOn ? "1" : "0", SEARXNG_URL: url.trim() } });
      toast.success("已写入 .env（已自动备份）。联网检索为「需重启」项——请重启后端后生效。", { duration: 6000 });
      setUrlDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) {
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
        <h1 className="text-xl font-semibold">联网检索</h1>
        <Button size="sm" onClick={() => navigate("/system/env")}>
          <SlidersHorizontal className="size-3.5" /> 配置
        </Button>
      </div>

      <MotionGlassCard className="flex flex-wrap items-center gap-4 p-5">
        <div
          className="grid size-12 place-items-center rounded-xl"
          style={{
            background: data.enabled ? "color-mix(in srgb, var(--ok) 18%, transparent)" : "rgba(255,255,255,.06)",
            color: data.enabled ? "var(--ok)" : "var(--fg-muted)",
          }}
        >
          <Search className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={data.enabled ? "online" : "offline"} />
            <span className="text-sm font-semibold">{data.enabled ? "已启用 grounding" : "未启用 (WEBSEARCH_ENABLE=0)"}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>
              SearXNG：
              {data.reachable ? (
                <span className="text-[var(--ok)]">运行中 · 端口可达</span>
              ) : data.processUp ? (
                <span className="text-[var(--warn)]">进程在跑，但端口未响应（启动中或已崩溃）</span>
              ) : (
                <span>未运行</span>
              )}
            </span>
            {data.url && (
              <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)]">
                {data.url} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {data.processUp && !data.reachable && (
            <Button size="sm" variant="ghost" onClick={viewLog}>
              <ScrollText className="size-3.5" /> 启动日志
            </Button>
          )}
          {data.processUp ? (
            <Button size="sm" variant="danger" onClick={() => toggleSearxng(false)}>
              <PowerOff className="size-3.5" /> 停止
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => toggleSearxng(true)}>
              <Power className="size-3.5" /> 启动
            </Button>
          )}
        </div>
      </MotionGlassCard>

      <MotionGlassCard className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">启用与地址</h2>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            启用 grounding
            <Switch checked={data.flagOn} onChange={(v) => saveEnable(v, urlDraft ?? data.url ?? "")} disabled={saving} />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] text-muted">SearXNG 地址（SEARXNG_URL）</div>
          <div className="flex gap-2">
            <input
              value={urlDraft ?? data.url ?? ""}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="http://127.0.0.1:8888"
              className={cn(inputClass, "flex-1 font-mono")}
            />
            <Button size="sm" variant="primary" loading={saving} onClick={() => saveEnable(true, urlDraft ?? data.url ?? "")} disabled={!(urlDraft ?? data.url ?? "").trim()}>
              <Save className="size-3.5" /> 启用并保存
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted/80">
          两种用法：①直接填一个<b>现成的 SearXNG 地址</b>(远程/局域网)；②用<b>本地内置</b> SearXNG——先在终端跑
          <span className="font-mono"> npm run searxng:setup </span>装好，再点上方「启动」(或设 SEARXNG_AUTOSTART=1 随工程自启)。
          保存为「需重启」项，<b className="text-fg">重启后端后</b>才会让 grounding 真正生效；但「试搜」只要地址可达即可立即测试。
          {!data.url && <span className="text-[var(--warn)]"> 当前未设地址，故显示未启用。</span>}
        </p>
      </MotionGlassCard>

      <MotionGlassCard className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">试搜</h2>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && search()}
            placeholder="例如：今天上海天气"
            className={cn(inputClass, "flex-1")}
          />
          <Button variant="primary" loading={busy} onClick={search} disabled={!query.trim()}>
            <Play className="size-4" /> 检索
          </Button>
        </div>
        {diag != null && !diag.ok && (
          <div className="space-y-1.5 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/8 p-3">
            <div className="text-[13px] font-medium text-[var(--danger)]">
              检索失败（{diag.stage}{diag.status ? ` ${diag.status}` : ""}）
            </div>
            <div className="break-words font-mono text-[11px] text-muted">{diag.error}</div>
            {diag.hint && <div className="text-[12px] text-fg">💡 {diag.hint}</div>}
          </div>
        )}
        {diag != null && diag.ok && diag.count === 0 && (
          <EmptyState title="连通正常，但本次 0 条结果" hint="换个关键词试试；SearXNG 已返回有效 JSON（说明配置 OK）" />
        )}
        {diag != null && diag.ok && diag.count > 0 && (
          <div className="space-y-2">
            {diag.results.map((r, i) => (
              <div key={i} className="rounded-lg border border-[var(--glass-border)] bg-white/4 p-3">
                <a href={r.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-[var(--accent)]">
                  [{i + 1}] {r.title}
                </a>
                <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{r.content}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted/60">{r.url}</div>
              </div>
            ))}
          </div>
        )}
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        一键安装本地 SearXNG：<span className="font-mono">npm run searxng:setup</span>，再点上方「启动」。地址 / TopK / 超时在「环境变量 · 联网检索」中配置。
        到 SearXNG 的请求<b className="text-fg">已强制直连、不走代理</b>，无需再手动配 NO_PROXY。
        <br />
        <b className="text-fg">注意</b>：别让浏览器/编辑器的<b>自动翻译插件</b>动到 <span className="font-mono">searxng/settings.yml</span>——它会把 YAML 的
        <span className="font-mono"> true/false </span>译成「正确/假」导致启动失败。
      </GlassCard>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="SearXNG 启动日志（最近输出）" width={680}>
        {logLines === null ? (
          <Skeleton className="h-64" />
        ) : logLines.length === 0 ? (
          <EmptyState title="暂无日志" hint="点击「启动」后这里会显示 SearXNG 的 stdout/stderr" />
        ) : (
          <pre className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--glass-border)] bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
            {logLines.join("\n")}
          </pre>
        )}
      </Sheet>
    </div>
  );
}
