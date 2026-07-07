// ============================================================================
// LLM PROVIDER — adapter interface
// ============================================================================
// One interface, swappable providers (Anthropic Claude, OpenAI, or any
// OpenAI-compatible endpoint). Used by AI candidate evaluation and, later,
// resume scoring. Selected via config.ai.provider.
// ============================================================================

export type LLMProviderKey = "anthropic" | "openai" | "none";

export interface LLMCompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Ask the provider to return strict JSON when supported. */
  json?: boolean;
}

export interface LLMProvider {
  key: LLMProviderKey;
  /** True when the provider has the credentials it needs. */
  isConfigured(): boolean;
  /** Which model this provider will use (for auditing/storage). */
  model(): string;
  /** Single-shot completion; returns the raw assistant text. */
  complete(req: LLMCompletionRequest): Promise<string>;
}
