import fs from "node:fs";
let s = fs.readFileSync("src/wizard/engine.ts", "utf8");
s = s.replace(
  'import type { IncomingMessage } from "@wechatbot/wechatbot";',
  'import type { InboundEnvelope } from "../sessionManager/types.js";',
);
s = s.replaceAll("msg: IncomingMessage", "inbound: InboundEnvelope");
s = s.replaceAll("msg.userId", "inbound.userId");
s = s.replaceAll(", msg,", ", inbound,");
s = s.replaceAll("(msg,", "(inbound,");
s = s.replaceAll("replyPlain(msg,", "replyPlain(inbound,");
s = s.replaceAll("buildTerminalSub({ collected, msg })", "buildTerminalSub({ collected, inbound })");
s = s.replaceAll("onTerminal({ ctx: wctx, msg, collected })", "onTerminal({ ctx: wctx, inbound, collected })");
s = s.replaceAll("loadOptions({ ctx, msg,", "loadOptions({ ctx, inbound,");
fs.writeFileSync("src/wizard/engine.ts", s);
