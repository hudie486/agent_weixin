/**
 * 注入环境变量域（injected-env.json）：向导仅对接环境模块统一入口。
 * 勿在此 import 代码项目、周期任务等其它业务包。
 */
import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { MenuOptionDef, WizardCollected, WizardDef } from "../wizard/types.js";
import { registerWizard } from "../wizard/registry.js";
import { dispatchWizardCommandWithDefaults } from "../framework/wizard/adapters.js";
import { readInjectedEnvForUser } from "./injectedEnv.js";

function validateEnvKeyFormat(s: string): string | null {
  const t = s.trim();
  if (!t) return "键不能为空";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return "键须为字母数字下划线，且不以数字开头";
  return null;
}

function validateEnvKeyExists(s: string): string | null {
  return validateEnvKeyFormat(s);
}

function validateEnvVal(s: string): string | null {
  if (!s.trim()) return "值不能为空";
  return null;
}

function validateNonEmpty(s: string): string | null {
  return s.trim() ? null : "不能为空";
}

function resolveWizardTargetUserId(msg: IncomingMessage, collected: WizardCollected): string {
  const t = collected._targetUserId?.trim();
  return t || msg.userId;
}

function withTargetAfterAction(
  action: string,
  rest: string,
  msg: IncomingMessage,
  collected: WizardCollected,
): string {
  const target = resolveWizardTargetUserId(msg, collected);
  const trimmed = rest.trim();
  if (target === msg.userId) return trimmed ? `${action} ${trimmed}` : action;
  return trimmed ? `${action} for ${target} ${trimmed}` : `${action} for ${target}`;
}

function buildEnvTerminalSub({
  collected,
  msg,
}: {
  collected: WizardCollected;
  msg: IncomingMessage;
}): string | undefined {
  const flow = collected._flow;
  if (flow === "help") return "help";
  if (flow === "list") return withTargetAfterAction("list", "", msg, collected);
  if (flow === "set") {
    const k = collected.envKey?.trim() ?? "";
    const v = collected.envVal ?? "";
    if (!k || !v.trim()) return undefined;
    return withTargetAfterAction("set", `${k} ${v}`, msg, collected);
  }
  if (flow === "delete") {
    const k = collected.delKey?.trim() ?? "";
    if (!k) return undefined;
    return withTargetAfterAction("delete", k, msg, collected);
  }
  if (flow === "modify") {
    const k = collected.modEnvKey?.trim() ?? "";
    const v = collected.modEnvVal ?? "";
    if (!k || !v.trim()) return undefined;
    return withTargetAfterAction("set", `${k} ${v}`, msg, collected);
  }
  return undefined;
}

/** 向全局向导表注册「注入环境变量」向导（wizardId 固定为 env） */
export function registerInjectedEnvWizard(): void {
  const def: WizardDef = {
    id: "env",
    title: "注入环境变量（帮助、列表、新增、修改、删除）",
    requireAdmin: false,
    rootStepId: "env_scope",
    commandDomain: "env",
    buildTerminalSub: buildEnvTerminalSub,
    steps: {
      env_scope: {
        kind: "menu",
        prompt: "请选择操作目标用户：",
        options: [
          {
            label: "当前用户（默认）",
            help: "后续命令不带 for <userId>",
            example: "1",
            nextStepId: "env_main",
            setCollected: { _targetUserId: "" },
          },
          {
            label: "指定用户（管理员）",
            help: "后续命令统一追加 for <userId>",
            example: "2",
            nextStepId: "env_target_user",
          },
        ],
      },
      env_target_user: {
        kind: "freeText",
        prompt: "请输入目标 userId（后续步骤统一按该用户执行）：",
        field: "_targetUserId",
        validate: validateNonEmpty,
        nextStepId: "env_main",
      },
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
        loadOptions: ({ msg, collected }) => {
          const env = readInjectedEnvForUser(resolveWizardTargetUserId(msg, collected));
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
      const sub = buildEnvTerminalSub({ collected, msg });
      if (!sub) {
        await ctx.notify.replyText(msg, "向导数据不完整，无法生成命令。", "error");
        return;
      }
      const ok = await dispatchWizardCommandWithDefaults({ ctx, msg, domain: "env", sub });
      if (!ok) {
        await ctx.notify.replyText(msg, `命令未注册：${sub}`, "error");
      }
      return;
    },
  };
  registerWizard(def);
}
