import fs from "node:fs";

const files = [
  "src/plugins/periodic/wizardRegistration.ts",
  "src/plugins/codeProjects/wizardRegistration.ts",
  "src/config/injectedEnvWizard.ts",
  "src/modules/user/wizard.ts",
];

for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/import type \{ IncomingMessage \} from "@wechatbot\/wechatbot";\r?\n/g, "");
  if (!s.includes("InboundEnvelope")) {
    s = s.replace(
      /import type \{ WizardHandlerCtx/,
      'import type { InboundEnvelope } from "../sessionManager/types.js";\nimport type { WizardHandlerCtx',
    );
    s = s.replace(
      /from "\.\.\/wizard\/types\.js";/,
      'from "../wizard/types.js";\nimport type { InboundEnvelope } from "../sessionManager/types.js";',
    );
  }
  s = s.replaceAll("msg: IncomingMessage", "inbound: InboundEnvelope");
  s = s.replaceAll("msg.userId", "inbound.userId");
  s = s.replaceAll("({ msg })", "({ inbound })");
  s = s.replaceAll("({ msg,", "({ inbound,");
  s = s.replaceAll(", msg }", ", inbound }");
  s = s.replaceAll("dispatchWizardCommandWithDefaults({\n    ctx,\n    msg,", "dispatchWizardCommandWithDefaults({\n    ctx,\n    inbound:");
  s = s.replaceAll("msg,", "inbound,");
  s = s.replaceAll("target === msg.userId", "target === inbound.userId");
  s = s.replaceAll("return t || msg.userId", "return t || inbound.userId");
  fs.writeFileSync(f, s);
}
