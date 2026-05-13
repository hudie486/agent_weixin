import type { FrameworkContext, ModuleDomain } from "../contracts/module.js";
import type { IncomingMessage } from "@wechatbot/wechatbot";

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
  msg?: IncomingMessage;
};

export type CommandHandler = {
  domain: ModuleDomain;
  action: CommandAction;
  handle: (ctx: FrameworkContext, input: CommandInput) => Promise<void>;
};
