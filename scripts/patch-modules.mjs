import fs from "node:fs";
import path from "node:path";

const files = [
  "src/modules/code/commands.ts",
  "src/modules/code/service.ts",
  "src/modules/code/module.ts",
  "src/modules/env/commands.ts",
  "src/modules/env/service.ts",
  "src/modules/env/module.ts",
  "src/modules/periodic/commands.ts",
  "src/modules/periodic/service.ts",
  "src/modules/periodic/module.ts",
  "src/modules/user/commands.ts",
  "src/modules/user/service.ts",
  "src/modules/user/module.ts",
  "src/modules/agent/module.ts",
];

for (const f of files) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/import type \{ IncomingMessage \} from "@wechatbot\/wechatbot";\n?/g, "");
  s = s.replace(
    /import type \{ FrameworkContext \} from "\.\.\/\.\.\/framework\/contracts\/module\.js";/,
    'import type { FrameworkContext } from "../../framework/contracts/module.js";\nimport type { InboundEnvelope } from "../../sessionManager/types.js";',
  );
  s = s.replaceAll("input.msg", "ctx.envelope");
  s = s.replaceAll("if (!input.msg) return;", "if (!ctx.userId) return;");
  s = s.replaceAll("cmd.msg", "cmd.envelope");
  s = s.replaceAll("MessageContext", "FrameworkContext");
  fs.writeFileSync(p, s);
}
