import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4500"),
  host: process.env.HOST || "0.0.0.0",

  // Recruit module database (recruitment-specific tables only)
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "emp_recruit",
    poolMin: parseInt(process.env.DB_POOL_MIN || "2"),
    poolMax: parseInt(process.env.DB_POOL_MAX || "10"),
  },

  // EmpCloud master database (users, organizations, auth — shared across modules)
  empcloudDb: {
    host: process.env.EMPCLOUD_DB_HOST || process.env.DB_HOST || "localhost",
    port: parseInt(process.env.EMPCLOUD_DB_PORT || process.env.DB_PORT || "3306"),
    user: process.env.EMPCLOUD_DB_USER || process.env.DB_USER || "root",
    password: process.env.EMPCLOUD_DB_PASSWORD || process.env.DB_PASSWORD || "",
    name: process.env.EMPCLOUD_DB_NAME || "empcloud",
  },

  // Redis (for queues, caching)
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || "change-this-in-production",
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || "2h",
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",
  },

  // Email (interview invites, offer letters, notifications)
  email: {
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "1025"),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "recruit@empcloud.com",
  },

  // AI / LLM (shared llm.service — the single choke point for every AI agent).
  // Provider is auto-selected by whichever key is present; with NO key the
  // service is a no-op and every caller falls back to its deterministic path
  // (e.g. the JD generator's template mode), so the module runs keyless today.
  ai: {
    // "auto" picks anthropic if ANTHROPIC_API_KEY is set, else openai if
    // OPENAI_API_KEY is set, else "none" (template/heuristic fallbacks only).
    provider: (process.env.AI_PROVIDER || "auto") as "auto" | "anthropic" | "openai" | "none",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    // Per-tier model IDs — overridable via env without code changes.
    models: {
      deep: process.env.AI_MODEL_DEEP || "claude-opus-4-8",
      balanced: process.env.AI_MODEL_BALANCED || "claude-sonnet-5",
      cheap: process.env.AI_MODEL_CHEAP || "claude-haiku-4-5",
      // OpenAI fallbacks (used only when provider resolves to openai)
      openai: process.env.AI_MODEL_OPENAI || "gpt-4o-mini",
    },
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || "2"),
    requestTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || "60000"),
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5179",
  },
} as const;
