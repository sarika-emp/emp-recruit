// ============================================================================
// ANTHROPIC (CLAUDE) LLM ADAPTER
// ============================================================================
// Uses the official @anthropic-ai/sdk. Default model claude-opus-4-8 with
// adaptive thinking. Configured via config.ai.anthropic.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../../config";
import type { LLMCompletionRequest, LLMProvider } from "./types";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.ai.anthropic.apiKey });
  }
  return client;
}

export const anthropicProvider: LLMProvider = {
  key: "anthropic",

  isConfigured(): boolean {
    return !!config.ai.anthropic.apiKey;
  },

  model(): string {
    return config.ai.anthropic.model;
  },

  async complete(req: LLMCompletionRequest): Promise<string> {
    const system = req.json
      ? `${req.system}\n\nRespond with a single valid JSON object and nothing else — no markdown fences, no prose.`
      : req.system;

    const message = await getClient().messages.create({
      model: config.ai.anthropic.model,
      max_tokens: req.maxTokens ?? 4096,
      system,
      messages: [{ role: "user", content: req.prompt }],
    });

    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  },
};
