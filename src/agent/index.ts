export {
  type AgentConfig,
  type AgentResult,
  loadAgentConfig,
  withAgentResume,
  buildAgentSpawnArgs,
  wrapSpawnCommand,
  resolveWindowsAgentScript,
  agentArgsIncludePrintProgress,
} from "./config.js";
export {
  appendWeChatHint,
  type StreamCallbacks,
  type RunAgentStreamingParams,
} from "./streamRunner.js";

import type { AgentConfig, AgentResult } from "./config.js";
import { cliCreateCursorChatId } from "./config.js";
import { runAgentStreaming as cliRunAgentStreaming, type RunAgentStreamingParams } from "./streamRunner.js";
import { sdkCreateCursorChatId, sdkRunAgentStreaming } from "./sdkRunner.js";

/** 创建续聊 chatId（cli: create-chat 子命令；sdk: Agent.create().agentId） */
export async function createCursorChatId(params: { cfg: AgentConfig; cwd?: string }): Promise<string> {
  return params.cfg.backend === "sdk" ? sdkCreateCursorChatId(params) : cliCreateCursorChatId(params);
}

/** 流式执行 Agent（按 cfg.backend 选择 cli/sdk 实现，签名一致） */
export function runAgentStreaming(params: RunAgentStreamingParams): Promise<AgentResult> {
  return params.cfg.backend === "sdk" ? sdkRunAgentStreaming(params) : cliRunAgentStreaming(params);
}
