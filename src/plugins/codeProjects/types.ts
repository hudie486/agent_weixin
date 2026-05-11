export type CodeProjectKind = "local" | "ssh" | "clone";

/** SSH 远端工程（编译在远端执行；修复仅支持本地 kind） */
export type SshTarget = {
  user: string;
  host: string;
  /** POSIX 远端目录 */
  remotePath: string;
};

export type CloneMeta = {
  repoUrl: string;
  branch?: string;
  /** 克隆产生的本机 src 根目录（绝对路径） */
  localSrcDir: string;
};

export type CodeProject = {
  id: string;
  userId: string;
  /** 同一用户下唯一 */
  alias: string;
  kind: CodeProjectKind;
  /** local / clone：本机工程根目录 */
  localPath?: string;
  ssh?: SshTarget;
  cloneMeta?: CloneMeta;
  /** 注册或刷新时探测 build.sh */
  hasBuildScript: boolean;
  artifactGlob?: string | null;
  /** 发送到微信时的文件名或 caption 补充 */
  artifactSendName?: string | null;
  /** /代码 修复 专用 Cursor chatId */
  fixChatId?: string | null;
  createdAt: number;
};

export type CodeProjectsState = {
  version: 1;
  projects: CodeProject[];
  /** userId -> 默认项目 alias */
  defaultAliasByUserId: Record<string, string>;
};
