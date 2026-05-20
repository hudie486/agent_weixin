import type { FrameworkContext, ModuleDomain } from "../contracts/module.js";
import type { InboundEnvelope } from "../../sessionManager/index.js";

export type CommandAction = string;

export type CommandSpec = {
  domain: ModuleDomain;
  action: CommandAction;
  usage: string;
  summary: string;
};

export type CommandInput = {
  domain: ModuleDomain;
  action: CommandAction;
  sub: string;
  source: "slash" | "wizard" | "system";
  userId: string;
  envelope?: InboundEnvelope;
};

export type CommandHandler = {
  domain: ModuleDomain;
  action: CommandAction;
  handle: (ctx: FrameworkContext, input: CommandInput) => Promise<void>;
};
