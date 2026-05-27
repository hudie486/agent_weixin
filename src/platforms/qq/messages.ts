import type { QqBotConfig } from "./config.js";
import { formatQqNetworkErrorMessage } from "./errors.js";

export function formatQqCredentialValidationError(e: unknown, cfg?: QqBotConfig): string {
  const raw = e instanceof Error ? e.message : String(e);
  return formatQqNetworkErrorMessage("validate", raw, cfg);
}
