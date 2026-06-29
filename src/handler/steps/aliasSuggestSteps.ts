import { addAlias } from "../../commandModule/alias/store.js";
import { indexAliasVector } from "../../commandModule/alias/intentIndex.js";
import {
  clearPendingSuggest,
  getPendingSuggest,
  isAffirmative,
  recordMiss,
} from "../../commandModule/alias/suggest.js";
import type { InboundChainStep } from "../inboundChain.js";
import { dispatchSlashText } from "./slashCommandStep.js";

/**
 * 拦截「好」确认：仅当该用户有未过期的别名建议时生效。
 * 肯定 → 写入别名（并写入语义索引）；executeOnConfirm 时一并执行该命令；
 * 其它 → 放弃建议、静默清除、继续正常处理本条消息。
 */
export const aliasConfirmStep: InboundChainStep = async (chain, text) => {
  const pending = getPendingSuggest(chain.userId);
  if (!pending) return false;

  if (isAffirmative(text)) {
    clearPendingSuggest(chain.userId);
    const res = addAlias(chain.userId, pending.key, pending.slash);
    if (!res.ok) {
      await chain.notify.replyText(chain.inbound, "这条暂时没法设为别名，先跳过。", "warn");
      return true;
    }
    void indexAliasVector(chain.userId, res.entry.key, res.entry.slash);
    if (pending.executeOnConfirm) {
      await chain.notify.replyText(chain.inbound, `好，记住了，这就执行 ${pending.slash}`, "success");
      await dispatchSlashText(chain, pending.slash);
    } else {
      await chain.notify.replyText(
        chain.inbound,
        `好嘞，记住了：以后你说「${pending.display}」我就执行 ${pending.slash} ✅`,
        "success",
      );
    }
    return true;
  }

  clearPendingSuggest(chain.userId);
  return false;
};

/**
 * 记录「未命中的短自然语言」，供后续斜杠命令触发别名建议。
 * 永远返回 false：纯记录，继续走 miss 提示/Agent。
 */
export const recordMissStep: InboundChainStep = async (chain, text) => {
  recordMiss(chain.userId, text);
  return false;
};
