import type { WxIntent } from "../../wxTone.js";
import type { PeriodicJob } from "./types.js";
import type { PushResult } from "../../wxSession/types.js";
import type { OutboundIntent } from "../../sessionManager/types.js";
import { sessionRegistry } from "../../sessionManager/index.js";
import { listPeriodicNotifyTargets, resolveDefaultNotifyInstanceId } from "../../shared/notifyTarget.js";
import { parsePeriodicStdout } from "./stdoutParse.js";

export { parsePeriodicStdout, PERIODIC_STDOUT_SEP } from "./stdoutParse.js";

/** @deprecated 使用 parsePeriodicStdout */
export function splitPeriodicStdout(text: string): string[] {
  return parsePeriodicStdout(text);
}

/** 解析周期任务主通知 Bot 实例（兼容旧调用） */
export function resolveJobNotifyInstanceId(job: PeriodicJob): string {
  return job.notifyInstanceId?.trim() || resolveDefaultNotifyInstanceId(job.notifyUserId);
}

/** 向任务全部通知对象推送（主用户 + notifyTargets） */
export async function pushPeriodicJobMessage(
  job: PeriodicJob,
  text: string,
  intent: WxIntent = "info",
): Promise<PushResult> {
  const targets = listPeriodicNotifyTargets(job);
  let ok = 0;
  let lastErr: unknown;
  for (const t of targets) {
    try {
      await sessionRegistry().deliver(
        t.userId,
        { text, plain: true, intent: intent as OutboundIntent },
        {
          source: `periodic/${job.id}`,
          useReplyToken: false,
          instanceIdOverride: t.instanceId ?? resolveDefaultNotifyInstanceId(t.userId),
        },
      );
      ok += 1;
    } catch (e) {
      lastErr = e;
    }
  }
  if (ok === 0 && lastErr) throw lastErr;
  return { status: "sent" };
}
