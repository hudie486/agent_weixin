import type { InboundChainStep } from "../inboundChain.js";
import { pendingJobsForApprover, resolveApproval } from "../../plugins/periodic/approval.js";
import { pendingRepairJobsForApprover, resolveRepair } from "../../plugins/periodic/repair.js";
import { styleConfirmation } from "../../commandModule/confirmStyle.js";
import type { OutboundIntent } from "../../sessionManager/types.js";
import type { PeriodicJob } from "../../plugins/periodic/types.js";

const YES = /^(确认|确定|通过|同意|批准|提交|是|好|ok|yes|y)$/i;
const NO = /^(取消|拒绝|不提交|驳回|否|不|no|n)$/i;
const REPAIR_YES = /^(修复|修|去修|fix)$/i;
const REPAIR_NO = /^(不修|忽略|先不修|算了)$/i;

function jobTag(job: { shortName?: string | null; id: string }): string {
  return job.shortName?.trim() || job.id.slice(0, 8);
}

function pickByRef<T extends PeriodicJob>(pendings: T[], t: string): T | undefined {
  if (pendings.length === 1) return pendings[0];
  return pendings.find(
    (j) => (j.shortName && t.includes(j.shortName)) || t.includes(j.id.slice(0, 8)),
  );
}

/**
 * 周期任务·审批/修复回复处理（入站链首位）：
 * - 名下有待审批任务且回复「确认/取消」→ 提交/跳过本次执行；
 * - 名下有待修复提议且回复「修复/不修」（无待审批时「确认/取消」也算）→ 修复/忽略。
 * 多条待办需在指令后带简称/ID 定位。其他情况一律放行（返回 false）。
 */
export const periodicApprovalStep: InboundChainStep = async (chain, text) => {
  const userId = chain.userId;
  const approvals = pendingJobsForApprover(userId);
  const repairs = pendingRepairJobsForApprover(userId);
  if (approvals.length === 0 && repairs.length === 0) return false;

  const t = text.trim();
  const repairYes = REPAIR_YES.test(t);
  const repairNo = REPAIR_NO.test(t);
  const yes = YES.test(t);
  const no = NO.test(t);
  if (!repairYes && !repairNo && !yes && !no) return false;

  const notify = chain.framework.notify;
  // 措辞层：CMD_STYLE_ENABLE=1 时用 DeepSeek 改写得更自然（失败/未开启则原样）；plain 避免语气层再加每行 emoji
  const say = async (draft: string, intent: OutboundIntent): Promise<void> => {
    const styled = await styleConfirmation(draft, { dedupeKey: userId });
    await notify.notifyText({ userId, text: styled, intent, plain: true, envelope: chain.envelope });
  };

  // 修复拍板：专用词直达；「确认/取消」在没有待审批时也指修复
  const repairDecision = repairYes || repairNo || (approvals.length === 0 && (yes || no));
  if (repairs.length > 0 && repairDecision) {
    const target = pickByRef(repairs, t);
    if (!target) {
      const list = repairs.map((j) => `· ${jobTag(j)}`).join("\n");
      await notify.notifyText({
        userId,
        text: `你有多条待修复，回复时带上简称就行，比如「修复 ${jobTag(repairs[0]!)}」：\n${list}`,
        plain: true,
        envelope: chain.envelope,
      });
      return true;
    }
    const doRepair = repairYes || (!repairNo && yes);
    if (doRepair) await say(`收到，这就修「${jobTag(target)}」，修完会先试跑验证`, "info");
    const res = await resolveRepair(target.id, doRepair ? "repair" : "dismiss", {
      agentCfg: chain.framework.agentCfg,
      notify,
    });
    await say(res.message, res.ok ? (doRepair ? "success" : "info") : "warn");
    return true;
  }

  if (approvals.length === 0 || (!yes && !no)) return false;

  const target = pickByRef(approvals, t);
  if (!target) {
    const list = approvals.map((j) => `· ${jobTag(j)}`).join("\n");
    await notify.notifyText({
      userId,
      text: `你有多条待审批，回复时带上简称就行，比如「确认 ${jobTag(approvals[0]!)}」：\n${list}`,
      plain: true,
      envelope: chain.envelope,
    });
    return true;
  }

  if (yes) await say(`收到，这就去执行「${jobTag(target)}」`, "info");

  const res = await resolveApproval(target.id, yes ? "approve" : "reject", {
    agentCfg: chain.framework.agentCfg,
    notify,
  });
  await say(res.message, res.ok ? (yes ? "success" : "info") : "warn");
  return true;
};
