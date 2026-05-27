import { parseSlash } from "../../commands/slashParse.js";
import { routeSlashCommand } from "../../framework/commands/router.js";
import {
  actionResolversSingleton,
  commandRegistrySingleton,
} from "../../framework/commands/runtime.js";
import { startRootWizard } from "../../wizard/engine.js";
import { clearAllInteractionPending } from "../../wizard/stateStore.js";
import { handleUtilitySlash } from "../utilitySlash.js";
import type { InboundChainStep } from "../inboundChain.js";

export const slashCommandStep: InboundChainStep = async (chain, text) => {
  const slash = parseSlash(text);
  if (!slash) return false;

  clearAllInteractionPending(chain.inbound.userId, chain.wizardPath);
  if (slash.name === "向导" || slash.name === "菜单") {
    await startRootWizard(chain.wizard, chain.inbound, chain.wizardPath);
    return true;
  }
  if (await handleUtilitySlash(chain.notify, chain.inbound, slash.name, chain.userId)) {
    return true;
  }
  const ok = await routeSlashCommand(
    commandRegistrySingleton,
    actionResolversSingleton,
    chain.framework,
    text,
  );
  if (ok) return true;
  await chain.notify.replyText(chain.inbound, "未找到该命令，请发送 /帮助 查看可用命令。", "warn");
  return true;
};
