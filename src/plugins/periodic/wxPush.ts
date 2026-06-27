import type { WxIntent } from "../../wxTone.js";
import type { PeriodicJob } from "./types.js";
import type { PushResult } from "../../wxSession/types.js";
import type { OutboundIntent } from "../../sessionManager/types.js";
import { sessionRegistry } from "../../sessionManager/index.js";
import { listPeriodicNotifyTargets, resolveDefaultNotifyInstanceId } from "../../shared/notifyTarget.js";
import { createLogger } from "../../logger.js";
import { parsePeriodicStdout } from "./stdoutParse.js";

export { parsePeriodicStdout, PERIODIC_STDOUT_SEP } from "./stdoutParse.js";

const log = createLogger("periodic-push");

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
  const errors: string[] = [];
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
      const m = e instanceof Error ? e.message : String(e);
      errors.push(`${t.userId}: ${m}`);
      log.debug(`periodic push failed job=${job.id} user=${t.userId}: ${m}`);
    }
  }
  if (ok === 0 && errors.length) {
    throw new Error(errors.join("; "));
  }
  if (errors.length) {
    log.debug(`periodic push partial job=${job.id} ok=${ok}/${targets.length} failed=${errors.join("; ")}`);
  }
  return { status: "sent" };
}
