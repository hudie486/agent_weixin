import { joinWxLines } from "../../util/wxRichText.js";
import { qqApiBase, QQ_API_BASE_PROD, QQ_API_BASE_SANDBOX } from "./apiBase.js";
import type { QqBotConfig } from "./config.js";

function isFetchFailed(msg: string): boolean {
  return /\bfetch failed\b/i.test(msg);
}

/** 凭证校验 / 启动失败时的可读说明（对齐 QQ 机器人官方文档） */
export function formatQqNetworkErrorMessage(
  phase: "validate" | "startup",
  raw: string,
  cfg?: Pick<QqBotConfig, "sandbox">,
): string {
  const apiHost = cfg ? qqApiBase(cfg) : QQ_API_BASE_PROD;
  const lines = [
    phase === "validate" ? "QQ 机器人凭证校验未通过。" : "QQ 机器人凭证已保存，但长连接未能启动。",
    "",
    `接口返回：${raw}`,
    "",
  ];

  if (isFetchFailed(raw)) {
    lines.push(
      "原因说明（参考 QQ 机器人官方文档）：",
      "· 获取 AccessToken（bots.qq.com）与调用 OpenAPI / 获取 WSS 网关（api.sgroup.qq.com）是不同域名。",
      `· 当前配置请求网关：${apiHost}/gateway/bot`,
      "· 日志里若已有 access_token refreshed，说明 Token 接口可达，但网关域名可能被防火墙/代理/DNS 拦截。",
      "",
      "请逐项排查：",
      "1. 本机或服务器能否访问上述 HTTPS 地址（与微信 wechatbot 出网要求类似）",
      "2. 若走代理：在 .env 配置 HTTPS_PROXY / HTTP_PROXY（进程启动时会绑定全局 fetch）",
      "3. WebSocket Identify 须使用 QQBot {access_token}（由 ClientSecret 换取；Bot {AppID}.{Secret} 会 4004）",
      "4. 应用在 QQ 开放平台是否为沙箱：沙箱须加命令参数「沙箱」或向导中选沙箱",
      `   （沙箱 API：${QQ_API_BASE_SANDBOX}；正式：${QQ_API_BASE_PROD}）`,
      "5. 官方文档说明 WebSocket 推送将逐步迁移至 Webhook；当前本项目仍用 WSS，需保证能连上返回的 wss 地址",
      "",
      "文档：https://github.com/tencent-connect/bot-docs",
    );
  } else if (/gateway|401|403|404/i.test(raw)) {
    lines.push(
      "常见原因：AppID/Secret 错误、沙箱与正式环境不匹配、或机器人未开通对应能力。",
      `当前 API 根：${apiHost}`,
    );
  } else {
    lines.push("常见原因：AppID/Secret 错误、沙箱/正式环境不匹配，或机器人未配置事件订阅。");
  }

  lines.push("", "命令：/用户 QQ 连接 <AppID> <Secret> [沙箱]");
  return joinWxLines(lines);
}
