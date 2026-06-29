import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Code2, Star, Trash2, RefreshCw, HardDrive, Server, GitBranch, SlidersHorizontal, Hammer, Wrench, Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MotionGlassCard, GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState, Badge, inputClass } from "@/components/ui/atoms";
import { Sheet } from "@/components/ui/Overlay";
import { RunTerminal } from "@/components/RunTerminal";
import { cn } from "@/lib/cn";

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
  artifactSendName: string | null;
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
  const [run, setRun] = useState<{ project: Project; mode: "compile" | "fix" } | null>(null);

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
                <div className="flex flex-wrap gap-1.5">
                  {p.hasBuildScript && (
                    <Button size="sm" variant="primary" onClick={() => setRun({ project: p, mode: "compile" })}>
                      <Hammer className="size-3.5" /> 编译
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setRun({ project: p, mode: "fix" })}>
                    <Wrench className="size-3.5" /> 修复
                  </Button>
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
        <b className="text-fg">编译</b>：运行项目根 <span className="font-mono">build.sh</span>（本地或 SSH 远端），网页实时看输出与产物路径。
        <b className="text-fg"> 修复</b>：让 Agent 在本地项目内按你的说明改代码（仅本地项目）。也可在微信用
        <span className="font-mono"> /代码 编译 / 修复 </span>触发。
      </GlassCard>

      <Sheet
        open={!!run}
        onClose={() => setRun(null)}
        title={`${run?.mode === "fix" ? "修复" : "编译"} · ${run?.project.alias ?? ""}`}
        width={680}
      >
        {run && (run.mode === "compile" ? <CompilePanel project={run.project} /> : <FixPanel project={run.project} />)}
      </Sheet>
    </div>
  );
}

function CompilePanel({ project }: { project: Project }) {
  const [glob, setGlob] = useState(project.artifactGlob ?? "");
  const [savingGlob, setSavingGlob] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const saveGlob = async () => {
    setSavingGlob(true);
    try {
      await api.patch(`/code/projects/${project.id}`, { artifactGlob: glob.trim() || null });
      toast.success("已保存产物 glob");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSavingGlob(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/code/projects/${project.id}/artifact`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error || `下载失败 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const name = m ? decodeURIComponent(m[1]) : "artifact.bin";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        执行 <span className="font-mono">bash ./build.sh</span>
        {project.kind === "ssh" ? "（SSH 远端）" : `（${project.localPath}）`}，实时输出。
      </p>
      <div className="space-y-1">
        <div className="text-[11px] text-muted">产物 glob（相对工程根，决定从哪取产物；空则用 CODE_ARTIFACT_GLOB）</div>
        <div className="flex gap-2">
          <input value={glob} onChange={(e) => setGlob(e.target.value)} placeholder="dist/*.exe" className={cn(inputClass, "flex-1 font-mono")} />
          <Button size="sm" loading={savingGlob} onClick={saveGlob}>保存</Button>
          {project.kind === "local" && (
            <Button size="sm" variant="primary" loading={downloading} onClick={download}>
              下载产物
            </Button>
          )}
        </div>
      </div>
      <RunTerminal path={`/sse/code-compile/${project.id}`} />
      <p className="text-[10px] text-muted/70">
        构建成功后若仍「未找到产物」：多半是 glob 没指对，或 build.sh 没产出文件。SSH 远端产物暂不支持网页直接下载。
      </p>
    </div>
  );
}

function FixPanel({ project }: { project: Project }) {
  const [instruction, setInstruction] = useState("");
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(false);

  if (project.kind !== "local" || !project.localPath) {
    return (
      <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/8 p-4 text-[13px]">
        修复需要 Agent 直接读写项目文件，<b>仅支持本地项目</b>（当前为 {project.kind}）。
        SSH / clone 项目请在本机登记一份本地副本后再用修复。
      </div>
    );
  }
  const start = () => {
    if (!instruction.trim()) return;
    setActive(true);
    setRunId(Date.now());
  };
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        让 Agent 在 <span className="font-mono">{project.localPath}</span> 内按说明改代码（会真实修改文件、消耗模型额度）。
      </p>
      <div className="flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          placeholder="例如：修复登录页的空指针；把按钮改成蓝色"
          className={cn(inputClass, "flex-1")}
        />
        <Button variant="primary" onClick={start} disabled={!instruction.trim()}>
          <Play className="size-4" /> 开始修复
        </Button>
      </div>
      {active && <RunTerminal key={runId} path={`/sse/code-fix/${project.id}?q=${encodeURIComponent(instruction)}`} />}
    </div>
  );
}
