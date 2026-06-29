/**
 * `.env` 读写服务（Web 控制台 core 层）。
 *
 * - 解析时保留注释、空行与原始顺序；写回时只改动目标 key 所在行，其余原样。
 * - 写前自动备份 `.env.bak.<时间戳>`，原子写（tmp + rename）。
 * - 读取时密钥脱敏（永不回传明文）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ENV_CATEGORIES,
  ENV_FIELDS,
  getEnvFieldMeta,
  isSecretKey,
  type EnvFieldMeta,
} from "./envCatalog.js";

export function envFilePath(): string {
  return process.env.ENV_FILE_PATH?.trim() || path.join(process.cwd(), ".env");
}

type ParsedLine =
  | { kind: "kv"; key: string; value: string; raw: string }
  | { kind: "raw"; raw: string };

function parseValue(rawValue: string): string {
  let v = rawValue.trim();
  if (v.length >= 2) {
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q)) {
      v = v.slice(1, -1);
      if (q === '"') {
        v = v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      return v;
    }
  }
  // 去除「值 + 空格 + #」形式的行内注释
  const m = v.search(/\s#/);
  if (m >= 0) v = v.slice(0, m).trim();
  return v;
}

function serializeValue(v: string): string {
  if (v === "") return "";
  // 含空格 / # / 引号 / 换行，或首尾空白 → 双引号转义；否则原样（保留 JSON 数组等紧凑写法）
  if (/[\s"#]/.test(v) || v !== v.trim()) {
    if (!/[\s#\n]/.test(v)) return v; // 仅含引号但无空格/#：dotenv 按字面读，原样更安全
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return v;
}

const KV_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function parseEnvText(text: string): ParsedLine[] {
  const lines = text.split(/\r?\n/);
  // 末尾因 split 产生的空串：仅当原文以换行结尾时保留一个空行，避免写回时丢/加换行
  const out: ParsedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      out.push({ kind: "raw", raw });
      continue;
    }
    const m = KV_RE.exec(raw);
    if (!m) {
      out.push({ kind: "raw", raw });
      continue;
    }
    out.push({ kind: "kv", key: m[1]!, value: parseValue(m[2]!), raw });
  }
  return out;
}

function readRawText(): string {
  const p = envFilePath();
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  } catch {
    return "";
  }
}

/** 解析 .env 得到 key→value（仅未注释行）。 */
export function readEnvFileValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseEnvText(readRawText())) {
    if (line.kind === "kv") out[line.key] = line.value;
  }
  return out;
}

function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "••••";
  return `${v.slice(0, 3)}••••${v.slice(-3)}`;
}

export type EnvFieldView = EnvFieldMeta & {
  set: boolean;
  /** .env 文件中的值（非密钥：原值；密钥：脱敏串） */
  value: string;
  masked: boolean;
  /** 当前进程实际生效的值（process.env，含运行时注入/ shell 环境；密钥脱敏） */
  effective: string;
  effectiveSet: boolean;
  /** 运行中的有效值与 .env 文件值是否不一致（如 QQ 配置在运行时注入、或改了 .env 未重启） */
  differs: boolean;
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

/** 给前端的分类视图（密钥脱敏；未知 key 归入 other）。 */
export function getEnvConfigView(): EnvConfigView {
  const fileValues = readEnvFileValues();
  const byCat = new Map<string, EnvFieldView[]>();
  const ensure = (id: string): EnvFieldView[] => {
    let arr = byCat.get(id);
    if (!arr) {
      arr = [];
      byCat.set(id, arr);
    }
    return arr;
  };

  const toView = (meta: EnvFieldMeta): EnvFieldView => {
    const set = Object.prototype.hasOwnProperty.call(fileValues, meta.key);
    const raw = set ? fileValues[meta.key]! : "";
    const masked = meta.secret === true || meta.type === "secret";
    const envVal = process.env[meta.key];
    const effectiveSet = envVal !== undefined;
    const effRaw = envVal ?? "";
    return {
      ...meta,
      set,
      masked,
      value: masked && raw ? maskSecret(raw) : raw,
      effective: masked && effRaw ? maskSecret(effRaw) : effRaw,
      effectiveSet,
      differs: raw.trim() !== effRaw.trim(),
    };
  };

  for (const meta of ENV_FIELDS) ensure(meta.category).push(toView(meta));

  // 未在目录中的 key → other
  for (const key of Object.keys(fileValues)) {
    if (getEnvFieldMeta(key)) continue;
    const secret = isSecretKey(key);
    const raw = fileValues[key]!;
    const envVal = process.env[key];
    const effRaw = envVal ?? "";
    ensure("other").push({
      key,
      category: "other",
      label: key,
      effect: "restart",
      type: secret ? "secret" : "string",
      secret,
      set: true,
      masked: secret,
      value: secret ? maskSecret(raw) : raw,
      effective: secret && effRaw ? maskSecret(effRaw) : effRaw,
      effectiveSet: envVal !== undefined,
      differs: raw.trim() !== effRaw.trim(),
    });
  }

  const categories: EnvCategoryView[] = ENV_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    group: c.group,
    fields: byCat.get(c.id) ?? [],
  })).filter((c) => c.fields.length > 0);

  return { path: envFilePath(), exists: fs.existsSync(envFilePath()), categories };
}

function backupEnvFile(): string | null {
  const p = envFilePath();
  if (!fs.existsSync(p)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${p}.bak.${ts}`;
  try {
    fs.copyFileSync(p, bak);
    return bak;
  } catch {
    return null;
  }
}

function writeEnvTextAtomic(text: string): void {
  const p = envFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, "utf-8");
    fs.renameSync(tmp, p);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** 把 changes 写回 .env：已存在则改值；存在注释占位 `# KEY=` 则就地启用；都没有则追加。 */
export function applyEnvChanges(changes: Record<string, string>): {
  backup: string | null;
  applied: string[];
} {
  const keys = Object.keys(changes);
  if (keys.length === 0) return { backup: null, applied: [] };

  const text = readRawText();
  const lines = text.split(/\r?\n/);
  const remaining = new Set(keys);

  const commentedRe = (key: string) =>
    new RegExp(`^(\\s*)#\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  // 1) 覆盖已存在的未注释行
  for (let i = 0; i < lines.length; i++) {
    const m = KV_RE.exec(lines[i]!);
    if (m && remaining.has(m[1]!)) {
      const key = m[1]!;
      lines[i] = `${key}=${serializeValue(changes[key]!)}`;
      remaining.delete(key);
    }
  }
  // 2) 就地启用注释占位
  if (remaining.size > 0) {
    for (let i = 0; i < lines.length; i++) {
      for (const key of Array.from(remaining)) {
        if (commentedRe(key).test(lines[i]!)) {
          lines[i] = `${key}=${serializeValue(changes[key]!)}`;
          remaining.delete(key);
        }
      }
    }
  }
  // 3) 追加
  if (remaining.size > 0) {
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") lines.push("");
    lines.push("# ── 由 Web 控制台追加 ──");
    for (const key of keys) {
      if (!remaining.has(key)) continue;
      lines.push(`${key}=${serializeValue(changes[key]!)}`);
      remaining.delete(key);
    }
  }

  const backup = backupEnvFile();
  writeEnvTextAtomic(lines.join("\n"));
  return { backup, applied: keys };
}

/** 原文读写（高级视图）。 */
export function readEnvRaw(): string {
  return readRawText();
}

export function writeEnvRaw(text: string): { backup: string | null } {
  // 基本校验：能解析即可（不强制每行合法，注释/空行允许）
  parseEnvText(text);
  const backup = backupEnvFile();
  writeEnvTextAtomic(text.endsWith("\n") ? text : `${text}\n`);
  return { backup };
}
