/** 后端响应类型（与 src/web、src/core 对齐）。 */

export type SystemHealth = {
  ok: true;
  version: string;
  node: string;
  pid: number;
  platform: string;
  uptimeMs: number;
  startedAt: number;
  env: "dev" | "prod";
  now: number;
};

export type PlatformStatus = {
  id: string;
  label: string;
  enabled: boolean;
  online: boolean;
  detail?: string;
};

export type StatusResponse = {
  health: SystemHealth;
  platforms: PlatformStatus[];
  periodic: {
    total: number;
    enabled: number;
    nextRuns: { id: string; shortName: string | null; nextRunAt: number; cron: string | null }[];
  };
  outbound: {
    pending: number;
    users: { userId: string; count: number }[];
  };
  recentErrors: { id: string; shortName: string | null; at: number; summary: string }[];
};

export type AuthMe = { authenticated: boolean; passwordSet: boolean };

export type EnvEffect = "instant" | "hot" | "restart";
export type EnvFieldType =
  | "string"
  | "int"
  | "bool"
  | "json"
  | "url"
  | "secret"
  | "enum"
  | "multiline";

export type EnvFieldView = {
  key: string;
  category: string;
  label: string;
  effect: EnvEffect;
  type: EnvFieldType;
  secret?: boolean;
  options?: string[];
  placeholder?: string;
  description?: string;
  set: boolean;
  value: string;
  masked: boolean;
};

export type EnvCategoryView = {
  id: string;
  label: string;
  group: string;
  fields: EnvFieldView[];
};

export type EnvConfigView = {
  path: string;
  exists: boolean;
  categories: EnvCategoryView[];
};
