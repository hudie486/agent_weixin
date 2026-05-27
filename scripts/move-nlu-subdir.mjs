import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/commandModule");
const destDir = path.join(root, "nlu");
const map = [
  ["nluConfig.ts", "config.ts"],
  ["nluLlmClient.ts", "llmClient.ts"],
  ["nluDomainRetry.ts", "domainRetry.ts"],
  ["nluManifests.ts", "manifests.ts"],
  ["nluResolve.ts", "resolve.ts"],
  ["nluMatchScores.ts", "matchScores.ts"],
  ["nluInbound.ts", "inbound.ts"],
  ["nluSlotFallbacks.ts", "slotFallbacks.ts"],
  ["nluDialogue.ts", "dialogue.ts"],
  ["nluPromptStyle.ts", "promptStyle.ts"],
];

const reps = [
  ['from "../framework', 'from "../../framework'],
  ['from "../logger', 'from "../../logger'],
  ['from "../util', 'from "../../util'],
  ['from "../wizard', 'from "../../wizard'],
  ['from "../sessionManager', 'from "../../sessionManager'],
  ['from "./nluConfig', 'from "./config'],
  ['from "./nluLlmClient', 'from "./llmClient'],
  ['from "./nluManifests', 'from "./manifests'],
  ['from "./nluDomainRetry', 'from "./domainRetry'],
  ['from "./nluMatchScores', 'from "./matchScores'],
  ['from "./nluDialogue', 'from "./dialogue'],
  ['from "./nluPromptStyle', 'from "./promptStyle'],
  ['from "./nluResolve', 'from "./resolve'],
  ['from "./nlu.js"', 'from "./core.js"'],
  ['from "./interactionSession', 'from "../interactionSession'],
  ['from "./paramCollector', 'from "../paramCollector'],
];

for (const [src, dest] of map) {
  const p = path.join(root, src);
  if (!fs.existsSync(p)) {
    console.warn("skip missing", src);
    continue;
  }
  let c = fs.readFileSync(p, "utf8");
  for (const [from, to] of reps) {
    c = c.split(from).join(to);
  }
  fs.writeFileSync(path.join(destDir, dest), c, "utf8");
  fs.unlinkSync(p);
}

console.log("moved NLU files into commandModule/nlu/");
