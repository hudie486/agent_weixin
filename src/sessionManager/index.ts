import { SessionRegistry } from "./registry.js";
import { createSessionNotifyPort, type SessionNotifyPort } from "./notifyPort.js";

export type { PlatformId, DeliveryBinding, DeliveryScope, OutboundPayload, InboundEnvelope } from "./types.js";
export { SessionRegistry } from "./registry.js";
export { createSessionNotifyPort, type SessionNotifyPort } from "./notifyPort.js";
export { deliverSessionOutbound } from "./deliver.js";
export { drainOutboundQueueForUser, enqueueOutboundMessage } from "./outboundQueue.js";
export { relayOutbound } from "./outboundRelay.js";
export { wechatBusinessUserId, qqBusinessUserId, parsePlatformFromUserId } from "./userId.js";

let registrySingleton: SessionRegistry | undefined;

export function sessionRegistry(): SessionRegistry {
  if (!registrySingleton) registrySingleton = new SessionRegistry();
  return registrySingleton;
}

export function resetSessionRegistryForTests(): void {
  registrySingleton = undefined;
}

export function createDefaultSessionNotify(hooks?: Parameters<typeof createSessionNotifyPort>[1]): SessionNotifyPort {
  return createSessionNotifyPort(sessionRegistry(), hooks);
}
