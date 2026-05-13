/**
 * 代码项目域：仅在本文件内组合「向导 UI」与「代码模块统一入口」。
 * 勿在此 import 周期、环境等其它业务包。
 */
import type { IncomingMessage } from "@wechatbot/wechatbot";
import type { MenuOptionDef, WizardCollected, WizardDef } from "../../wizard/types.js";
import { registerWizard } from "../../wizard/registry.js";
import { dispatchWizardCommandWithDefaults } from "../../framework/wizard/adapters.js";
import { loadCodeProjectsState, listUserProjects } from "./store.js";

const ALIAS_RE = /^[\w\u4e00-\u9fff-]{1,32}$/;

function validateAlias(s: string): string | null {
  const t = s.trim();
  if (!ALIAS_RE.test(t)) return "别名须为 1–32 位字母数字中文下划线连字符";
  return null;
}

function validateNonEmpty(s: string): string | null {
  if (!s.trim()) return "不能为空";
  return null;
}

function validateGlob(s: string): string | null {
  if (!s.trim()) return "glob 不能为空";
  return null;
}

function buildCodeTerminalSub({
  collected,
}: {
  collected: WizardCollected;
  msg: IncomingMessage;
}): string | undefined {
  const flow = collected._flow;
  if (flow === "list") return "list";
  if (flow === "add") {
    const al = collected.alias?.trim() ?? "";
    const p = collected.path?.trim() ?? "";
    if (!al || !p) return undefined;
    return `add ${al} ${p}`;
  }
  const al = collected.codeAlias?.trim() ?? "";
  if (flow === "compile_project") return al ? `compile ${al}` : undefined;
  if (flow === "view_project") return al ? `config ${al}` : undefined;
  if (flow === "param_glob") {
    if (!al) return undefined;
    const g = collected.editGlob?.trim() ?? "";
    if (!g) return undefined;
    return `config ${al} 产物 ${g}`;
  }
  if (flow === "param_name") {
    if (!al) return undefined;
    const n = collected.editSendName?.trim() ?? "";
    if (!n) return undefined;
    return `config ${al} 产物名 ${n}`;
  }
  if (flow === "param_clearglob") return al ? `config ${al} 清除 产物` : undefined;
  if (flow === "param_default") return al ? `default ${al}` : undefined;
  return undefined;
}

/** 向全局向导表注册「代码项目」向导（wizardId 固定为 code，勿与其它域冲突） */
export function registerCodeProjectsWizard(): void {
  const def: WizardDef = {
    id: "code",
    title: "代码项目（添加、选择项目后编译与配置）",
    requireAdmin: true,
    rootStepId: "code_menu",
    commandDomain: "code",
    buildTerminalSub: buildCodeTerminalSub,
    steps: {
      code_menu: {
        kind: "menu",
        prompt: "请选择：",
        options: [
          {
            label: "添加本地项目",
            help: "登记本机目录；随后输入别名与路径",
            example: "1",
            nextStepId: "code_add_alias",
            setCollected: { _flow: "add" },
          },
          {
            label: "选择已有项目",
            help: "从列表选别名后，可编译或改产物 glob / 展示名等",
            example: "2",
            nextStepId: "code_project_pick",
            setCollected: { _flow: "project" },
          },
          {
            label: "查看项目列表",
            help: "列出已登记项目",
            example: "3",
            nextStepId: "code_term",
            setCollected: { _flow: "list" },
          },
        ],
      },
      code_project_pick: {
        kind: "dynamicMenu",
        prompt: "请选择项目（按已登记别名）：",
        loadOptions: ({ ctx: _ctx, msg, collected: _c }) => {
          const st = loadCodeProjectsState();
          const mine = listUserProjects(st, msg.userId);
          const MAX = 8;
          const out: MenuOptionDef[] = [];
          if (!mine.length) {
            return [
              {
                label: "暂无已登记项目（先添加或查看列表）",
                help: "若项目在他人账号下请换对应账号",
                example: "1",
                nextStepId: "code_term",
                setCollected: { _flow: "list" },
              },
              {
                label: "仍要手动输入项目别名",
                help: "1–32 位须与登记一致",
                example: "2",
                nextStepId: "code_project_alias_manual",
              },
            ];
          }
          for (let i = 0; i < Math.min(mine.length, MAX); i++) {
            const p = mine[i]!;
            const kindHint =
              p.kind === "ssh"
                ? "SSH 远程工程"
                : p.kind === "clone"
                  ? "克隆工程"
                  : "本地工程";
            out.push({
              label: p.alias,
              help: `${kindHint} · build.sh ${p.hasBuildScript ? "有" : "无"}`,
              example: String(out.length + 1),
              nextStepId: "code_project_menu",
              setCollected: { codeAlias: p.alias },
            });
          }
          if (mine.length > MAX) {
            out.push({
              label: "以上未列出我的项目（手动输入别名）",
              help: "1–32 位",
              example: String(out.length + 1),
              nextStepId: "code_project_alias_manual",
            });
          } else {
            out.push({
              label: "手动输入其它项目别名",
              help: "未出现在上表时使用",
              example: String(out.length + 1),
              nextStepId: "code_project_alias_manual",
            });
          }
          return out;
        },
      },
      code_project_alias_manual: {
        kind: "freeText",
        prompt: "请输入**项目别名**（须为已登记项目）：",
        field: "codeAlias",
        validate: validateAlias,
        nextStepId: "code_project_menu",
      },
      code_project_menu: {
        kind: "menu",
        prompt: "已选项目，请选择操作：",
        options: [
          {
            label: "执行编译",
            help: "需项目已有 build.sh",
            example: "1",
            nextStepId: "code_term",
            setCollected: { _flow: "compile_project" },
          },
          {
            label: "查看当前配置",
            help: "同「仅发项目别名」的配置查看",
            example: "2",
            nextStepId: "code_term",
            setCollected: { _flow: "view_project" },
          },
          {
            label: "修改产物与选项",
            help: "glob、展示名、清除 glob、设为默认",
            example: "3",
            nextStepId: "code_project_params",
          },
        ],
      },
      code_project_params: {
        kind: "menu",
        prompt: "请选择要修改的项：",
        options: [
          {
            label: "配置产物 glob",
            help: "相对项目根的匹配规则",
            example: "1",
            nextStepId: "code_edit_glob_only",
            setCollected: { _flow: "param_glob" },
          },
          {
            label: "配置产物展示名",
            help: "发到微信时的文件名或说明",
            example: "2",
            nextStepId: "code_edit_name_only",
            setCollected: { _flow: "param_name" },
          },
          {
            label: "清除项目级产物 glob",
            help: "回退到全局 CODE_ARTIFACT_GLOB",
            example: "3",
            nextStepId: "code_term",
            setCollected: { _flow: "param_clearglob" },
          },
          {
            label: "设为默认项目",
            help: "后续省略别名时默认使用该项目",
            example: "4",
            nextStepId: "code_term",
            setCollected: { _flow: "param_default" },
          },
        ],
      },
      code_edit_glob_only: {
        kind: "freeText",
        prompt: "请输入新的产物 glob：",
        field: "editGlob",
        validate: validateGlob,
        nextStepId: "code_term",
      },
      code_edit_name_only: {
        kind: "freeText",
        prompt: "请输入新的产物展示名：",
        field: "editSendName",
        validate: validateNonEmpty,
        nextStepId: "code_term",
      },
      code_add_alias: {
        kind: "freeText",
        prompt: "请输入项目别名（1–32 位，字母数字中文下划线连字符）：",
        field: "alias",
        validate: validateAlias,
        nextStepId: "code_add_path",
      },
      code_add_path: {
        kind: "freeText",
        prompt: "请输入本地工程目录的绝对路径：",
        field: "path",
        validate: validateNonEmpty,
        nextStepId: "code_term",
      },
      code_term: { kind: "terminal" },
    },
    onTerminal: async ({ ctx, msg, collected }) => {
      const sub = buildCodeTerminalSub({ collected, msg });
      if (!sub) {
        await ctx.notify.replyText(msg, "向导数据不完整，无法生成命令。", "error");
        return;
      }
      const ok = await dispatchWizardCommandWithDefaults({ ctx, msg, domain: "code", sub });
      if (!ok) {
        await ctx.notify.replyText(msg, `命令未注册：${sub}`, "error");
      }
      return;
    },
  };
  registerWizard(def);
}
