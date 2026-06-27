export { handleMemoryCommand } from "./command.js";
export { buildMemoryContext, rememberFact } from "./recall.js";
export { extractAndStoreMemory } from "./extractor.js";
export { startMemoryConsolidation, consolidateUser, consolidateAll } from "./consolidate.js";
export { isMemoryEnabled, isMemoryAutoExtractEnabled, isMemoryConsolidateEnabled } from "./config.js";
