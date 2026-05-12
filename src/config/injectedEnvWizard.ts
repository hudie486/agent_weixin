/**
 * 注入环境变量域（injected-env.json）：向导仅对接 handleEnvSlash。
 * 勿在此 import 代码项目、周期任务等其它业务包。
 */
import type { MenuOptionDef, WizardDef } from "../wizard/types.js";
import { registerWizard } from "../wizard/registry.js";
import { handleEnvSlash } from "../handler/envSlash.js";
import { readInjectedEnv } from "./injectedEnv.js";

function validateEnvKeyFormat(s: string): string | null {
  const t = s.trim();
  if (!t) return "键不能为空";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return "键须为字母数字下划线，且不以数字开头";
  return null;
}

function validateEnvKeyExists(s: string): string | null {
  const fmt = validateEnvKeyFormat(s);
  if (fmt) return fmt;
  const k = s.trim();
  const env = readInjectedEnv();
  if (!(k in env)) return "无此键，请先「列出已注入的键」确认名称";
  return null;
}

function validateEnvVal(s: string): string | null {
  if (!s.trim()) return "值不能为空";
  return null;
}

/** 向全局向导表注册「注入环境变量」向导（wizardId 固定为 env） */
export function registerInjectedEnvWizard(): void {
  const def: WizardDef = {
    id: "env",
    title: "注入环境变量（帮助、列表、新增、修改、删除）",
    requireAdmin: true,
    rootStepId: "env_main",
    steps: {
      env_main: {
        kind: "menu",
        prompt: "请选择：",
        options: [
          {
            label: "查看帮助说明",
            help: "同 /环境 help",
            example: "1",
            nextStepId: "env_term",
            setCollected: { _flow: "help" },
          },
          {
            label: "列出已注入的键",
            help: "值脱敏显示",
            example: "2",
            nextStepId: "env_term",
            setCollected: { _flow: "list" },
          },
          {
            label: "设置变量",
            help: "写入注入配置并合并到当前进程",
            example: "3",
            nextStepId: "env_set_key",
            setCollected: { _flow: "set" },
          },
          {
            label: "删除变量",
            help: "按键删除",
            example: "4",
            nextStepId: "env_del_key",
            setCollected: { _flow: "delete" },
          },
          {
            label: "修改已有变量的值",
            help: "从键名列表选或手动输入，再填新值",
            example: "5",
            nextStepId: "env_mod_pick",
            setCollected: { _flow: "modify" },
          },
        ],
      },
      env_set_key: {
        kind: "freeText",
        prompt: "请输入环境变量键名（如 MY_API_KEY）：",
        field: "envKey",
        validate: validateEnvKeyFormat,
        nextStepId: "env_set_val",
      },
      env_set_val: {
        kind: "freeText",
        prompt: "请输入变量值（可含空格，整行作为值）：",
        field: "envVal",
        validate: validateEnvVal,
        nextStepId: "env_term",
      },
      env_del_key: {
        kind: "freeText",
        prompt: "请输入要删除的键名：",
        field: "delKey",
        validate: validateEnvKeyFormat,
        nextStepId: "env_term",
      },
      env_mod_pick: {
        kind: "dynamicMenu",
        prompt: "请选择要修改的**已有键名**（将再输入新值）：",
        loadOptions: ({ ctx: _ctx, msg: _msg, collected: _c }) => {
          const env = readInjectedEnv();
          const keys = Object.keys(env).sort();
          const MAX = 8;
          const out: MenuOptionDef[] = [];
          if (!keys.length) {
            return [
              {
                label: "当前无已注入键可改（先看列表）",
                help: "同 /环境 list",
                example: "1",
                nextStepId: "env_term",
                setCollected: { _flow: "list" },
              },
              {
                label: "仍手动输入已有键名",
                help: "须为已存在的键",
                example: "2",
                nextStepId: "env_mod_key_manual",
              },
            ];
          }
          for (let i = 0; i < Math.min(keys.length, MAX); i++) {
            const k = keys[i]!;
            const raw = env[k] ?? "";
            out.push({
              label: k,
              help: `当前值约 ${raw.length} 字符（不在此展示明文）`,
              example: String(out.length + 1),
              nextStepId: "env_mod_val",
              setCollected: { modEnvKey: k },
            });
          }
          if (keys.length > MAX) {
            out.push({
              label: "以上未列出我的键（手动输入键名）",
              help: "须为已存在的键",
              example: String(out.length + 1),
              nextStepId: "env_mod_key_manual",
            });
          } else {
            out.push({
              label: "手动输入其它已有键名",
              help: "未出现在上表时使用",
              example: String(out.length + 1),
              nextStepId: "env_mod_key_manual",
            });
          }
          return out;
        },
      },
      env_mod_key_manual: {
        kind: "freeText",
        prompt: "请输入要修改的**已有键名**（须已在注入列表中）：",
        field: "modEnvKey",
        validate: validateEnvKeyExists,
        nextStepId: "env_mod_val",
      },
      env_mod_val: {
        kind: "freeText",
        prompt: "请输入该键的**新值**（整行作为值，可含空格）：",
        field: "modEnvVal",
        validate: validateEnvVal,
        nextStepId: "env_term",
      },
      env_term: { kind: "terminal" },
    },
    onTerminal: async ({ ctx, msg, collected }) => {
      const flow = collected._flow;
      if (flow === "help") {
        await handleEnvSlash(ctx.notify, msg, "help");
        return;
      }
      if (flow === "list") {
        await handleEnvSlash(ctx.notify, msg, "list");
        return;
      }
      if (flow === "set") {
        const k = collected.envKey?.trim() ?? "";
        const v = collected.envVal ?? "";
        await handleEnvSlash(ctx.notify, msg, `set ${k} ${v}`);
        return;
      }
      if (flow === "delete") {
        const k = collected.delKey?.trim() ?? "";
        await handleEnvSlash(ctx.notify, msg, `delete ${k}`);
        return;
      }
      if (flow === "modify") {
        const k = collected.modEnvKey?.trim() ?? "";
        const v = collected.modEnvVal ?? "";
        await handleEnvSlash(ctx.notify, msg, `set ${k} ${v}`);
        return;
      }
      await ctx.notify.replyText(msg, "向导内部错误：未知环境操作。", "error");
    },
  };
  registerWizard(def);
}
