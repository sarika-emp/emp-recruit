// ============================================================================
// LLM PROVIDER REGISTRY
// ============================================================================
// Resolves the active LLM provider from config.ai.provider. Returns null when
// no provider is configured, so callers can fall back to heuristics.
// ============================================================================

import { config } from "../../../config";
import { logger } from "../../../utils/logger";
import type { LLMProvider, LLMProviderKey } from "./types";
import { anthropicProvider } from "./anthropic.adapter";
import { openaiProvider } from "./openai.adapter";

const registry: Record<Exclude<LLMProviderKey, "none">, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

/** The active LLM provider, or null when none is configured. */
export function getLLM(): LLMProvider | null {
  const key = config.ai.provider as LLMProviderKey;
  if (key === "none") return null;
  const provider = registry[key];
  if (!provider) {
    logger.warn(`Unknown AI_PROVIDER "${key}"; AI features disabled`);
    return null;
  }
  if (!provider.isConfigured()) {
    logger.warn(`AI_PROVIDER "${key}" selected but no API key set; AI features disabled`);
    return null;
  }
  return provider;
}

export function isLLMEnabled(): boolean {
  return getLLM() !== null;
}

export type { LLMProvider } from "./types";
