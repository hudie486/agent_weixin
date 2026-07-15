import { createLogger } from "../../logger.js";

const log = createLogger("periodic-heartbeat");

/** 心跳间隔；0/off 关闭（默认 2 分钟） */
export function agentHeartbeatIntervalMs(): number {
  const raw = process.env.PERIODIC_AGENT_HEARTBEAT_MS?.trim();
  if (raw === "0" || raw?.toLowerCase() === "off") return 0;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 120_000;
}

export type AgentHeartbeat = {
  /** 有用户可见输出时调用，推迟下一次心跳 */
  touch(): void;
  stop(): void;
};

const NOOP: AgentHeartbeat = { touch: () => {}, stop: () => {} };

/**
 * Agent 长任务心跳：Agent 读代码/改文件/装依赖阶段没有 assistant 文本输出，
 * 用户端会长时间静默。interval 内无任何可见输出时发一条「仍在工作」。
 */
export function startAgentHeartbeat(args: {
  /** 动作名（用于话术）：如「脚本修改」「修复」「脚本生成」 */
  label: string;
  send: (text: string) => void | Promise<void>;
}): AgentHeartbeat {
  const interval = agentHeartbeatIntervalMs();
  if (interval <= 0) return NOOP;
  const startedAt = Date.now();
  let lastActivity = startedAt;
  let stopped = false;
  const timer = setInterval(
    () => {
      if (stopped) return;
      const now = Date.now();
      if (now - lastActivity < interval) return;
      lastActivity = now; // 心跳本身计入活动，避免密集连发
      const mins = Math.max(1, Math.round((now - startedAt) / 60_000));
      void Promise.resolve(
        args.send(`⏳ ${args.label}进行中（已约 ${mins} 分钟）：Agent 正在读代码/改文件/装依赖，这个阶段没有文字输出，属于正常现象。`),
      ).catch((e) => log.debug(`heartbeat send failed: ${e instanceof Error ? e.message : String(e)}`));
    },
    Math.min(interval, 30_000),
  );
  return {
    touch: () => {
      lastActivity = Date.now();
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
