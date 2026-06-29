/** SSE 通道：单向实时推送（微信扫码事件等）。 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeWxLogin, currentWxQr, getWechatStatus } from "../wechatLogin.js";
import { streamRunJob } from "../../core/periodicAdmin.js";
import { getWebContext } from "../context.js";
import { loadAgentConfig, runAgentStreaming } from "../../agent/index.js";
import { recentLogs, subscribeLogs } from "../logCapture.js";
import { streamCompile, streamFix } from "../../core/codeAdmin.js";

export const sseRoutes = new Hono();

// 实时日志 tail：先补发最近若干行，再推增量。
sseRoutes.get("/logs", (c) => {
  return streamSSE(c, async (stream) => {
    for (const l of recentLogs(200)) {
      await stream.writeSSE({ data: JSON.stringify(l) });
    }
    let closed = false;
    const unsub = subscribeLogs((l) => {
      void stream.writeSSE({ data: JSON.stringify(l) });
    });
    stream.onAbort(() => {
      closed = true;
      unsub();
    });
    while (!closed) {
      await stream.sleep(15_000);
      if (closed) break;
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  });
});

// Agent 试跑：?q=<prompt>，流式回传增量文本，结束 done。
sseRoutes.get("/agent-run", (c) => {
  const prompt = (c.req.query("q") ?? "").slice(0, 4000).trim();
  return streamSSE(c, async (stream) => {
    if (!prompt) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: "prompt 为空" }) });
      await stream.writeSSE({ event: "done", data: "1" });
      return;
    }
    let cfg;
    try {
      cfg = loadAgentConfig();
    } catch {
      cfg = getWebContext()?.agentCfg;
    }
    if (!cfg) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: "Agent 配置不可用" }) });
      await stream.writeSSE({ event: "done", data: "1" });
      return;
    }
    try {
      const res = await runAgentStreaming({
        prompt,
        cfg,
        traceId: `web-agent-test:${Date.now()}`,
        stream: { onChunk: (text) => void stream.writeSSE({ data: JSON.stringify({ type: "chunk", text }) }) },
      });
      await stream.writeSSE({
        data: JSON.stringify({ type: res.ok ? "result" : "error", message: res.ok ? res.text : res.message }),
      });
    } catch (e) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) }) });
    }
    await stream.writeSSE({ event: "done", data: "1" });
  });
});

// 周期任务试跑：连接即执行，stdout/stderr 实时推送，结束后 done 并关闭。
sseRoutes.get("/periodic-run/:id", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    await streamRunJob(id, (chunk) => {
      void stream.writeSSE({ data: JSON.stringify(chunk) });
    });
    await stream.writeSSE({ event: "done", data: "1" });
  });
});

// 代码项目构建：连接即执行 build.sh，实时流式。
sseRoutes.get("/code-compile/:id", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    await streamCompile(id, (chunk) => {
      void stream.writeSSE({ data: JSON.stringify(chunk) });
    });
    await stream.writeSSE({ event: "done", data: "1" });
  });
});

// 代码项目修复：?q=<修复说明>，Agent 在本地项目内改代码，进度实时流式。
sseRoutes.get("/code-fix/:id", (c) => {
  const id = c.req.param("id");
  const instruction = (c.req.query("q") ?? "").slice(0, 2000);
  return streamSSE(c, async (stream) => {
    await streamFix(
      id,
      instruction,
      (chunk) => {
        void stream.writeSSE({ data: JSON.stringify(chunk) });
      },
      getWebContext()?.agentCfg,
    );
    await stream.writeSSE({ event: "done", data: "1" });
  });
});

sseRoutes.get("/wechat-login", (c) => {
  return streamSSE(c, async (stream) => {
    const send = (data: unknown) => stream.writeSSE({ data: JSON.stringify(data) });

    // 当前状态 + 进行中的二维码补发给新订阅者
    const st = getWechatStatus();
    if (st.online) await send({ type: "online" });
    const qr = currentWxQr();
    if (qr) await send({ type: "qr", dataUrl: qr.dataUrl, url: qr.url });

    let closed = false;
    const unsub = subscribeWxLogin((e) => {
      void send(e);
    });
    stream.onAbort(() => {
      closed = true;
      unsub();
    });

    // 心跳保活，直到客户端断开
    while (!closed) {
      await stream.sleep(15_000);
      if (closed) break;
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  });
});
