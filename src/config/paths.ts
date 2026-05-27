import path from "node:path";

export function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function underData(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}

export const dataPaths = {
  sessions: (): string =>
    process.env.SESSION_STORE_PATH?.trim() || underData("sessions.json"),
  sessionForInstance: (instanceId: string): string =>
    process.env.SESSION_STORE_PATH?.trim() || underData(`sessions.${instanceId}.json`),
  users: (): string => process.env.USER_STORE_PATH?.trim() || underData("users.json"),
  adminAuth: (): string => process.env.ADMIN_AUTH_PATH?.trim() || underData("admin-auth.json"),
  periodicState: (): string =>
    process.env.PERIODIC_STATE_PATH?.trim() || underData("periodic-state.json"),
  periodicJobsRoot: (): string =>
    path.resolve(process.env.PERIODIC_JOB_ROOT?.trim() || underData("periodic-jobs")),
  injectedEnv: (): string =>
    process.env.INJECTED_ENV_PATH?.trim() || underData("injected-env.json"),
  interactionState: (): string =>
    process.env.INTERACTION_STATE_PATH?.trim() || underData("interaction-state.json"),
  wizardStateLegacy: (): string =>
    process.env.WIZARD_STATE_PATH?.trim() || underData("wizard-state.json"),
  outboundRetryQueue: (): string =>
    process.env.OUTBOUND_RETRY_QUEUE_PATH?.trim() || underData("outbound-retry-queue.json"),
  qqBotConfig: (): string =>
    process.env.QQ_BOT_CONFIG_PATH?.trim() || underData("qq-bot-config.json"),
  qqSession: (instanceId: string): string =>
    process.env.QQ_SESSION_STORE_PATH?.trim() || underData(`sessions.${instanceId}.json`),
  codeProjects: (): string =>
    process.env.CODE_PROJECTS_PATH?.trim() || underData("code-projects.json"),
  codeArtifactsTmp: (): string => underData("code-artifacts-tmp"),
  resourceAudience: (): string =>
    process.env.RESOURCE_AUDIENCE_PATH?.trim() || underData("resource-audience.json"),
  steamFriendsState: (): string =>
    process.env.STEAM_FRIENDS_STATE_PATH?.trim() || underData("steam-friends-state.json"),
  wechatbotStorage: (): string =>
    process.env.WECHATBOT_STORAGE_DIR?.trim() || underData(".wechatbot"),
  wechatbotInstancesRoot: (): string =>
    path.resolve(process.env.BOT_INSTANCES_ROOT?.trim() || underData(".wechatbot-instances")),
  botInstancesState: (): string =>
    path.resolve(process.env.BOT_INSTANCES_STATE_PATH?.trim() || underData("bot-instances.json")),
};
