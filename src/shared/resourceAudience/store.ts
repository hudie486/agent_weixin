import fs from "node:fs";
import path from "node:path";

export type ResourceAudienceState = {
  version: 1;
  /** 成员 userId -> 继承其环境/代码的 owner userId */
  envSourceByMember: Record<string, string>;
  codeSourceByMember: Record<string, string>;
};

function storePath(): string {
  return (
    process.env.RESOURCE_AUDIENCE_PATH?.trim() ||
    path.join(process.cwd(), "data", "resource-audience.json")
  );
}

function empty(): ResourceAudienceState {
  return { version: 1, envSourceByMember: {}, codeSourceByMember: {} };
}

export function loadResourceAudience(): ResourceAudienceState {
  const p = storePath();
  try {
    if (!fs.existsSync(p)) return empty();
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<ResourceAudienceState>;
    if (raw.version !== 1) return empty();
    return {
      version: 1,
      envSourceByMember: { ...(raw.envSourceByMember ?? {}) },
      codeSourceByMember: { ...(raw.codeSourceByMember ?? {}) },
    };
  } catch {
    return empty();
  }
}

function save(state: ResourceAudienceState): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, p);
}

export function resolveEnvSourceUserId(userId: string): string {
  const uid = userId.trim();
  if (!uid) return uid;
  const owner = loadResourceAudience().envSourceByMember[uid]?.trim();
  return owner || uid;
}

export function resolveCodeSourceUserId(userId: string): string {
  const uid = userId.trim();
  if (!uid) return uid;
  const owner = loadResourceAudience().codeSourceByMember[uid]?.trim();
  return owner || uid;
}

export function linkEnvMember(ownerUserId: string, memberUserId: string): void {
  const owner = ownerUserId.trim();
  const member = memberUserId.trim();
  if (!owner || !member) throw new Error("ownerUserId 与 memberUserId 不能为空");
  if (owner === member) throw new Error("不能将用户链接到自身");
  const st = loadResourceAudience();
  st.envSourceByMember[member] = owner;
  save(st);
}

export function unlinkEnvMember(memberUserId: string): boolean {
  const member = memberUserId.trim();
  const st = loadResourceAudience();
  if (!(member in st.envSourceByMember)) return false;
  delete st.envSourceByMember[member];
  save(st);
  return true;
}

export function linkCodeMember(ownerUserId: string, memberUserId: string): void {
  const owner = ownerUserId.trim();
  const member = memberUserId.trim();
  if (!owner || !member) throw new Error("ownerUserId 与 memberUserId 不能为空");
  if (owner === member) throw new Error("不能将用户链接到自身");
  const st = loadResourceAudience();
  st.codeSourceByMember[member] = owner;
  save(st);
}

export function unlinkCodeMember(memberUserId: string): boolean {
  const member = memberUserId.trim();
  const st = loadResourceAudience();
  if (!(member in st.codeSourceByMember)) return false;
  delete st.codeSourceByMember[member];
  save(st);
  return true;
}

export function listEnvMembers(ownerUserId: string): string[] {
  const owner = ownerUserId.trim();
  const st = loadResourceAudience();
  return Object.entries(st.envSourceByMember)
    .filter(([, o]) => o === owner)
    .map(([m]) => m);
}

export function listCodeMembers(ownerUserId: string): string[] {
  const owner = ownerUserId.trim();
  const st = loadResourceAudience();
  return Object.entries(st.codeSourceByMember)
    .filter(([, o]) => o === owner)
    .map(([m]) => m);
}
