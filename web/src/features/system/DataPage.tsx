import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { HardDrive, Archive, RotateCcw, Trash2, FolderArchive, FileJson, Folder, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Badge, ErrorState } from "@/components/ui/atoms";
import { formatClock } from "@/lib/format";

type DataEntry = { name: string; type: "file" | "dir"; bytes: number; excluded: boolean };
type Backup = { name: string; createdAt: number; bytes: number };
type DataResp = { dataDir: string; entries: DataEntry[]; totalBytes: number; backups: Backup[] };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DataPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["data"],
    queryFn: () => api.get<DataResp>("/system/data"),
  });
  const [busy, setBusy] = useState<string>("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["data"] });

  const backup = async () => {
    setBusy("backup");
    try {
      const r = await api.post<{ backup: Backup }>("/system/backup");
      toast.success(`已备份：${r.backup.name}（${fmtBytes(r.backup.bytes)}）`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "备份失败");
    } finally {
      setBusy("");
    }
  };

  const restore = async (name: string) => {
    if (!confirm(`用备份「${name}」覆盖当前数据？\n（会先把当前数据自动快照一份，再覆盖；需重启生效）`)) return;
    setBusy(name);
    try {
      const r = await api.post<{ safetySnapshot: string }>("/system/restore", { name, confirm: true });
      toast.success(`已还原。当前数据已先快照为 ${r.safetySnapshot}。请重启后端生效。`, { duration: 7000 });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "还原失败");
    } finally {
      setBusy("");
    }
  };

  const del = async (name: string) => {
    if (!confirm(`删除备份「${name}」？`)) return;
    try {
      await api.del("/system/backup", { name, confirm: true });
      toast.success("已删除");
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
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">数据与备份</h1>
          <p className="font-mono text-[11px] text-muted">{data.dataDir}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          <Button size="sm" variant="primary" loading={busy === "backup"} onClick={backup}>
            <Archive className="size-3.5" /> 立即备份
          </Button>
        </div>
      </div>

      <MotionGlassCard className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <HardDrive className="size-4 text-muted" />
          <h2 className="text-sm font-semibold">数据目录</h2>
          <Badge className="ml-auto">有效 {fmtBytes(data.totalBytes)}</Badge>
        </div>
        <div className="space-y-1">
          {data.entries.map((e) => (
            <div key={e.name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/4">
              {e.type === "dir" ? (
                <Folder className="size-3.5 text-[var(--accent)]" />
              ) : (
                <FileJson className="size-3.5 text-muted" />
              )}
              <span className="font-mono text-[12px]">{e.name}</span>
              {e.excluded && <Badge className="text-[var(--warn)]">备份时跳过</Badge>}
              <span className="ml-auto text-[11px] text-muted">{fmtBytes(e.bytes)}</span>
            </div>
          ))}
          {data.entries.length === 0 && <div className="py-3 text-center text-[12px] text-muted">空</div>}
        </div>
      </MotionGlassCard>

      <MotionGlassCard className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <FolderArchive className="size-4 text-muted" />
          <h2 className="text-sm font-semibold">备份（{data.backups.length}）</h2>
        </div>
        {data.backups.length === 0 ? (
          <EmptyState title="还没有备份" hint="点右上「立即备份」生成一份快照（存到 data-backups/）" />
        ) : (
          <div className="space-y-1.5">
            {data.backups.map((b) => (
              <div key={b.name} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-white/4 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px]">{b.name}</div>
                  <div className="text-[11px] text-muted">{formatClock(b.createdAt)} · {fmtBytes(b.bytes)}</div>
                </div>
                <Button size="sm" variant="ghost" loading={busy === b.name} onClick={() => restore(b.name)}>
                  <RotateCcw className="size-3.5" /> 还原
                </Button>
                <Button size="sm" variant="subtle" className="text-[var(--danger)]" onClick={() => del(b.name)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </MotionGlassCard>

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        备份会快照整个数据目录到 <span className="font-mono">data-backups/</span>（跳过 <span className="font-mono">models</span> 嵌入缓存与临时产物）。
        还原会先把当前数据自动快照一份再覆盖，<b className="text-fg">重启后端</b>后生效。
        路径覆盖（各 <span className="font-mono">*_PATH</span>）在
        <button onClick={() => navigate("/system/env")} className="px-1 text-[var(--accent)] underline">环境变量</button>
        中配置。
      </GlassCard>
    </div>
  );
}
