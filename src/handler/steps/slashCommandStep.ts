import { parseSlash } from "../../commands/slashParse.js";
import { routeSlashCommand } from "../../framework/commands/router.js";
import {
  actionResolversSingleton,
  commandRegistrySingleton,
} from "../../framework/commands/runtime.js";
import { startRootWizard } from "../../wizard/engine.js";
import { clearAllInteractionPending } from "../../wizard/stateStore.js";
import { handleUtilitySlash } from "../utilitySlash.js";
import { prepareAliasSuggestion, setPendingSuggest } from "../../commandModule/alias/suggest.js";
import type { InboundChainCtx, InboundChainStep } from "../inboundChain.js";

export type SlashDispatchResult = "not_slash" | "wizard" | "utility" | "routed" | "not_found";

/**
 * 执行一段「斜杠命令文本」（向导/工具命令/模块命令）。供斜杠步骤与别名步骤共用。
 * 返回执行归类：not_slash 表示非斜杠（无副作用）。
 */
export async function dispatchSlashText(chain: InboundChainCtx, text: string): Promise<SlashDispatchResult> {
  const slash = parseSlash(text);
  if (!slash) return "not_slash";

  clearAllInteractionPending(chain.inbound.userId, chain.wizardPath);
  if (slash.name === "向导" || slash.name === "菜单") {
    await startRootWizard(chain.wizard, chain.inbound, chain.wizardPath);
    return "wizard";
  }
  if (await handleUtilitySlash(chain.notify, chain.inbound, slash.name, chain.userId, slash.rest)) {
    return "utility";
  }
  const ok = await routeSlashCommand(
    commandRegistrySingleton,
    actionResolversSingleton,
    chain.framework,
    text,
  );
  if (ok) return "routed";
  await chain.notify.replyText(chain.inbound, "未找到该命令，请发送 /帮助 查看可用命令。", "warn");
  return "not_found";
}

export const slashCommandStep: InboundChainStep = async (chain, text) => {
  if (!parseSlash(text)) return false;
  const result = await dispatchSlashText(chain, text);
  // 仅当真正执行了某条命令（utility/routed）时，才考虑提议把近期未命中的短句设成它的别名
  if (result === "utility" || result === "routed") {
    const sug = prepareAliasSuggestion(chain.userId, text);
    if (sug) {
      setPendingSuggest(chain.userId, sug);
      await chain.notify.replyText(
        chain.inbound,
        `💡 你刚说「${sug.display}」——要把它设成 ${sug.slash} 的别名吗？回复「好」就记住。`,
        "info",
      );
    }
  }
  return result !== "not_slash";
};
