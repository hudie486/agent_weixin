import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Code2, Star, Trash2, RefreshCw, HardDrive, Server, GitBranch, SlidersHorizontal } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Badge } from "@/components/ui/atoms";

type Project = {
  id: string;
  userId: string;
  alias: string;
  kind: "local" | "ssh" | "clone";
  localPath: string | null;
  ssh: string | null;
  repoUrl: string | null;
  branch: string | null;
  hasBuildScript: boolean;
  artifactGlob: string | null;
  isDefault: boolean;
  createdAt: number;
};

const kindIcon = { local: HardDrive, ssh: Server, clone: GitBranch } as const;

export function CodePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["code"],
    queryFn: () => api.get<{ projects: Project[] }>("/code/projects"),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["code"] });

  const setDefault = async (p: Project) => {
    try {
      await api.post(`/code/projects/${p.id}/default`);
      toast.success(`已设「${p.alias}」为 ${p.userId.slice(0, 12)} 的默认项目`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  };

  const remove = async (p: Project) => {
    if (!confirm(`删除项目登记「${p.alias}」？（仅移除登记，不动磁盘文件）`)) return;
    try {
      await api.del(`/code/projects/${p.id}`, { confirm: true });
      toast.success("已删除登记");
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
          <h1 className="text-xl font-semibold">代码项目</h1>
          <p className="text-xs text-muted">已登记的本地 / SSH / clone 工程</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" /> 刷新
          </Button>
          <Button size="sm" onClick={() => navigate("/system/env")}>
            <SlidersHorizontal className="size-3.5" /> 路径白名单
          </Button>
        </div>
      </div>

      {data.projects.length === 0 ? (
        <MotionGlassCard className="p-3">
          <EmptyState icon={<Code2 className="size-8" />} title="还没有登记的项目" hint="可在微信用 /代码 添加；网页端登记入口将在后续提供" />
        </MotionGlassCard>
      ) : (
        <div className="space-y-2.5">
          {data.projects.map((p) => {
            const Icon = kindIcon[p.kind];
            return (
              <MotionGlassCard key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="grid size-10 place-items-center rounded-xl bg-white/6 text-[var(--accent)]">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{p.alias}</span>
                    <Badge>{p.kind}</Badge>
                    {p.isDefault && <Badge className="text-[var(--warn)]">默认</Badge>}
                    {p.hasBuildScript ? <Badge className="text-[var(--ok)]">build.sh</Badge> : <Badge>无 build.sh</Badge>}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                    {p.localPath ?? p.ssh ?? p.repoUrl ?? "—"}
                    {p.branch ? ` @${p.branch}` : ""}
                  </div>
                  <div className="text-[10px] text-muted/60">归属 {p.userId.slice(0, 22)}</div>
                </div>
                <div className="flex gap-1.5">
                  {!p.isDefault && (
                    <Button size="sm" variant="subtle" onClick={() => setDefault(p)}>
                      <Star className="size-3.5" /> 设默认
                    </Button>
                  )}
                  <Button size="sm" variant="subtle" className="text-[var(--danger)]" onClick={() => remove(p)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </MotionGlassCard>
            );
          })}
        </div>
      )}

      <GlassCard className="p-5 text-[12px] leading-relaxed text-muted">
        构建 / 修复（build.sh、SSH 远端编译、Agent 修复）将在后续接入网页端流式日志；当前可在微信用
        <span className="font-mono"> /代码 编译 / 修复 </span>触发。
      </GlassCard>
    </div>
  );
}
