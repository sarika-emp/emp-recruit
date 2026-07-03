// ============================================================================
// SHARED LLM SERVICE  —  the single choke point every AI agent calls
// ----------------------------------------------------------------------------
// Foundation piece #1. Extracted and generalised from the inline OpenAI call
// that lived in job-description.service.ts, so every future AI agent (JD gen,
// resume structuring, ranking rationale, copilot, ...) shares one wrapper with
// consistent: provider selection, model tiering, tenant tagging, retries,
// timeouts, and a keyless fallback contract.
//
// KEYLESS BY DESIGN: with no ANTHROPIC_API_KEY / OPENAI_API_KEY configured,
// `isEnabled()` is false and every `complete*` call resolves to null. Callers
// treat null as "fall back to my deterministic path" — exactly how the JD
// generator already behaves. Drop a key into .env later and the SAME callers
// start getting real model output, no code change.
//
// Uses fetch (no SDK dependency) to keep this PR dependency-free; the provider
// wire format is isolated behind `callProvider()` so swapping to an official
// SDK later is a one-function change.
// ============================================================================

import { config } from "../../config";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reasoning depth → maps to a concrete model per provider. Pick per call so
 *  cost is a per-agent decision, not a global one. */
export type LlmTier = "deep" | "balanced" | "cheap";

/** Every call is tagged with the tenant + optional run linkage for audit/cost. */
export interface LlmContext {
  /** req.user.empcloudOrgId — the tenant this call is attributed to. */
  organizationId: number;
  /** Optional FK into agent_runs (added by a later foundation piece). */
  agentRunId?: string;
  /** req.user.recruitProfileId / empcloudUserId — who triggered it. */
  actorId?: number;
  /** Free label for logs/metrics, e.g. "jd-generator", "copilot". */
  feature?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  tier?: LlmTier;          // default "balanced"
  system?: string;         // convenience: prepended as a system message
  maxTokens?: number;      // default 2048
  temperature?: number;    // default 0.7
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: LlmProvider;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
}

export type LlmProvider = "anthropic" | "openai" | "none";

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(): LlmProvider {
  const p = config.ai.provider;
  if (p === "anthropic") return config.ai.anthropicApiKey ? "anthropic" : "none";
  if (p === "openai") return config.ai.openaiApiKey ? "openai" : "none";
  if (p === "none") return "none";
  // "auto": prefer Anthropic (the product default), then OpenAI, else none.
  if (config.ai.anthropicApiKey) return "anthropic";
  if (config.ai.openaiApiKey) return "openai";
  return "none";
}

function modelFor(tier: LlmTier, provider: LlmProvider): string {
  if (provider === "openai") return config.ai.models.openai;
  // anthropic (and the id set used when provider === "none" is irrelevant)
  return config.ai.models[tier];
}

/** True when a real provider+key is configured. Callers can check this to skip
 *  building a prompt entirely and go straight to their fallback. */
export function isEnabled(): boolean {
  return resolveProvider() !== "none";
}

/** Which provider/model would be used — handy for logs and the /health surface. */
export function describe(): { provider: LlmProvider; enabled: boolean; models: Record<LlmTier, string> } {
  const provider = resolveProvider();
  return {
    provider,
    enabled: provider !== "none",
    models: {
      deep: modelFor("deep", provider),
      balanced: modelFor("balanced", provider),
      cheap: modelFor("cheap", provider),
    },
  };
}

// ---------------------------------------------------------------------------
// Low-level provider call (isolated wire format)
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.ai.requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callAnthropic(model: string, messages: LlmMessage[], opts: Required<Pick<LlmCallOptions, "maxTokens" | "temperature">>): Promise<LlmResult | null> {
  // Anthropic wants the system prompt as a top-level field, not a message.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.ai.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, system, messages: turns, max_tokens: opts.maxTokens, temperature: opts.temperature }),
  });
  if (!res.ok) {
    logger.warn(`[llm] Anthropic ${res.status} ${res.statusText}`);
    return null;
  }
  const data = (await res.json()) as any;
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  if (!text) return null;
  return {
    text,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      model,
      provider: "anthropic",
    },
  };
}

async function callOpenAI(model: string, messages: LlmMessage[], opts: Required<Pick<LlmCallOptions, "maxTokens" | "temperature">>): Promise<LlmResult | null> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ai.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    }),
  });
  if (!res.ok) {
    logger.warn(`[llm] OpenAI ${res.status} ${res.statusText}`);
    return null;
  }
  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;
  return {
    text,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model,
      provider: "openai",
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Free-text completion. Returns null when no provider is configured OR the call
 * fails after retries — callers MUST treat null as "use my fallback".
 */
export async function complete(
  ctx: LlmContext,
  messages: LlmMessage[],
  opts: LlmCallOptions = {},
): Promise<LlmResult | null> {
  const provider = resolveProvider();
  if (provider === "none") return null;

  const tier = opts.tier ?? "balanced";
  const model = modelFor(tier, provider);
  const call = {
    maxTokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
  };
  const msgs: LlmMessage[] = opts.system ? [{ role: "system", content: opts.system }, ...messages] : messages;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= config.ai.maxRetries; attempt++) {
    try {
      const result = provider === "anthropic"
        ? await callAnthropic(model, msgs, call)
        : await callOpenAI(model, msgs, call);
      if (result) {
        logger.info(`[llm] ${provider}/${model} ok org=${ctx.organizationId} feature=${ctx.feature ?? "?"} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
        return result;
      }
      // null (non-ok response) — retry on the chance it's transient.
    } catch (err) {
      lastErr = err;
      logger.warn(`[llm] attempt ${attempt + 1}/${config.ai.maxRetries + 1} failed: ${String(err)}`);
    }
    if (attempt < config.ai.maxRetries) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  if (lastErr) logger.warn(`[llm] giving up after retries, falling back. org=${ctx.organizationId} feature=${ctx.feature ?? "?"}`);
  return null;
}

/**
 * Completion that expects a JSON object back. Strips markdown fences and parses.
 * Returns null on no-provider / failure / unparseable output → caller falls back.
 * This is what most agents actually want (structured extraction/generation).
 */
export async function completeJson<T = unknown>(
  ctx: LlmContext,
  messages: LlmMessage[],
  opts: LlmCallOptions = {},
): Promise<{ parsed: T; usage: LlmUsage } | null> {
  const result = await complete(ctx, messages, opts);
  if (!result) return null;
  try {
    let jsonStr = result.text.trim();
    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonStr = fenced[1].trim();
    const parsed = JSON.parse(jsonStr) as T;
    return { parsed, usage: result.usage };
  } catch (err) {
    logger.warn(`[llm] completeJson parse failed, falling back. feature=${ctx.feature ?? "?"}: ${String(err)}`);
    return null;
  }
}

export const llmService = { complete, completeJson, isEnabled, describe };
