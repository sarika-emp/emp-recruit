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
} as const;
