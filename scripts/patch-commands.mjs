import fs from "node:fs";

const files = [
  "src/modules/code/commands.ts",
  "src/modules/env/commands.ts",
  "src/modules/periodic/commands.ts",
  "src/modules/user/commands.ts",
];

for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/import type \{ IncomingMessage \} from "@wechatbot\/wechatbot";\r?\n/g, "");
  s = s.replace(/export async function execute\w+CommandSub\([\s\S]*?\): Promise<boolean> \{[\s\S]*?\}\r?\n\r?\n/, "");
  s = s.replaceAll("if (!input.msg) return;", "");
  s = s.replaceAll("input.msg,", "ctx,");
  s = s.replace(
    /handle: async \(ctx, input\) => \{\s*await execute(\w+)Action\(\s*\{ notify: ctx\.notify[\s\S]*?\},\s*ctx,\s*action,\s*input\.sub,\s*\);\s*\},/g,
    "handle: async (ctx, input) => {\n        await execute$1Action(ctx, action, input.sub);\n      },",
  );
  fs.writeFileSync(f, s);
}
