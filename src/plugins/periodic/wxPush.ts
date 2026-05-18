import type { WxIntent } from "../../wxTone.js";
import type { PeriodicJob } from "./types.js";
import type { PushResult } from "../../wxSession/types.js";
import { wxSessionRegistry } from "../../wxSession/registry.js";
import { parsePeriodicStdout } from "./stdoutParse.js";

export { parsePeriodicStdout, PERIODIC_STDOUT_SEP } from "./stdoutParse.js";

/** @deprecated 使用 parsePeriodicStdout */
export function splitPeriodicStdout(text: string): string[] {
  return parsePeriodicStdout(text);
}

/** 解析周期任务应使用的 Bot 实例 ID */
export function resolveJobNotifyInstanceId(job: PeriodicJob): string {
  const hint = job.notifyInstanceId?.trim();
  return wxSessionRegistry().resolveInstanceId(job.notifyUserId, hint || undefined);
}

/** 经微信会话 Hub 主动推送（单条） */
export async function pushPeriodicJobMessage(
  job: PeriodicJob,
  text: string,
  intent: WxIntent = "info",
): Promise<PushResult> {
  const instanceId = resolveJobNotifyInstanceId(job);
  return wxSessionRegistry().push({
    instanceId,
    userId: job.notifyUserId,
    message: { text, intent, plain: true },
    delivery: { mode: "proactive" },
    source: `periodic/${job.id}`,
  });
}

