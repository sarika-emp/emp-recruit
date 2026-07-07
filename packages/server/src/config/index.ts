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

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5179",
  },

  // Public URLs used when building crawlable job feeds (Indeed, etc.).
  // - apiBaseUrl: where the XML feed itself is served (this server).
  // - siteBaseUrl: the public career-page site candidates apply on (the client),
  //   used to build each job's apply URL in the feed.
  publicUrls: {
    apiBaseUrl:
      process.env.PUBLIC_API_BASE_URL || `http://localhost:${parseInt(process.env.PORT || "4500")}`,
    siteBaseUrl: process.env.PUBLIC_SITE_BASE_URL || process.env.CORS_ORIGIN || "http://localhost:5179",
  },

  // AI — pluggable LLM (candidate evaluation, resume scoring) + speech-to-text.
  // `provider` selects the LLM adapter; leave keys unset to run in heuristic /
  // placeholder mode. "openai" also drives any OpenAI-compatible endpoint via
  // OPENAI_BASE_URL (Together, Groq, OpenRouter, local, …).
  ai: {
    provider:
      process.env.AI_PROVIDER ||
      (process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : "none"),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || "gpt-4o",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    },
    // Speech-to-text for interview recordings.
    transcription: {
      provider:
        process.env.STT_PROVIDER || (process.env.DEEPGRAM_API_KEY ? "deepgram" : "none"),
      deepgram: {
        apiKey: process.env.DEEPGRAM_API_KEY || "",
        model: process.env.DEEPGRAM_MODEL || "nova-2",
      },
    },
  },

  // Public client URL — used to build join links for embedded interview rooms
  // (the <InterviewRoom> page lives in the client app, not this server).
  clientUrl: process.env.CLIENT_URL || "http://localhost:5179",

  // Public URL of THIS server — used as the OAuth redirect base for the
  // meeting-provider connect flow (Google/Teams callbacks land here).
  publicUrl: process.env.SERVER_PUBLIC_URL || "http://localhost:4500",

  // Interview meeting providers. `defaultProvider` is the fallback when an org
  // has no meeting_provider_configs row. Jitsi works with zero config (public
  // rooms); set JAAS_* to switch to authenticated, recordable JaaS rooms.
  // Google/Teams/Zoom credentials here are app-level defaults; per-org OAuth
  // (Phase 2) overrides them.
  meeting: {
    defaultProvider: process.env.MEETING_DEFAULT_PROVIDER || "jitsi",
    jitsi: {
      // 'public' (meet.jit.si, no auth) | 'jaas' (8x8.vc, JWT-gated + recording)
      mode: process.env.JITSI_MODE || (process.env.JAAS_APP_ID ? "jaas" : "public"),
      domain: process.env.JITSI_DOMAIN || "meet.jit.si",
      roomPrefix: process.env.JITSI_ROOM_PREFIX || "emprecruit",
      jaas: {
        appId: process.env.JAAS_APP_ID || "",
        // JaaS API key id (the `kid` header). Format: <appId>/<keyid>
        keyId: process.env.JAAS_KEY_ID || "",
        // PEM private key; supports \n-escaped single-line env values
        privateKey: (process.env.JAAS_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
        domain: process.env.JAAS_DOMAIN || "8x8.vc",
      },
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    teams: {
      clientId: process.env.MS_CLIENT_ID || "",
      clientSecret: process.env.MS_CLIENT_SECRET || "",
      tenantId: process.env.MS_TENANT_ID || "",
    },
    zoom: {
      accountId: process.env.ZOOM_ACCOUNT_ID || "",
      clientId: process.env.ZOOM_CLIENT_ID || "",
      clientSecret: process.env.ZOOM_CLIENT_SECRET || "",
    },
  },
} as const;
