// ============================================================================
// EMP-RECRUIT SERVER ENTRY POINT
// ============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import path from "path";
import { config } from "./config";
import { initDB, closeDB } from "./db/adapters";
import { initEmpCloudDB, migrateEmpCloudDB, closeEmpCloudDB } from "./db/empcloud";
import { logger } from "./utils/logger";

// Route imports
import { healthRoutes } from "./api/routes/health.routes";
import { jobRoutes } from "./api/routes/job.routes";
import { candidateRoutes } from "./api/routes/candidate.routes";
import { applicationRoutes } from "./api/routes/application.routes";
import { offerRoutes } from "./api/routes/offer.routes";
import { onboardingRoutes } from "./api/routes/onboarding.routes";
import { interviewRoutes } from "./api/routes/interview.routes";
import { authRoutes } from "./api/routes/auth.routes";
import { publicRoutes } from "./api/routes/public.routes";
import { portalRoutes } from "./api/routes/portal.routes";
import { careerPageRoutes } from "./api/routes/career-page.routes";
import { referralRoutes } from "./api/routes/referral.routes";
import { analyticsRoutes } from "./api/routes/analytics.routes";
import { emailTemplateRoutes } from "./api/routes/email-template.routes";
import { scoringRoutes } from "./api/routes/scoring.routes";
import { offerLetterRoutes } from "./api/routes/offer-letter.routes";
import { comparisonRoutes } from "./api/routes/comparison.routes";
import { pipelineRoutes } from "./api/routes/pipeline.routes";
import { backgroundCheckRoutes } from "./api/routes/background-check.routes";
import { jobDescriptionRoutes } from "./api/routes/job-description.routes";
import { surveyRoutes } from "./api/routes/survey.routes";
import { assessmentRoutes } from "./api/routes/assessment.routes";
import { organizationRoutes } from "./api/routes/organization.routes";
import { jobPublishingRoutes } from "./api/routes/job-publishing.routes";
import { errorHandler } from "./api/middleware/error.middleware";
import { apiLimiter, authLimiter } from "./api/middleware/rate-limit.middleware";
import { swaggerUIHandler, openapiHandler } from "./api/docs";
import { recordMounts } from "./api/route-recorder";

const app = express();

// Record route mounts for OpenAPI auto-discovery (before any .use mounts).
recordMounts(app);

// Self-hosted Swagger UI assets — served same-origin from /api/docs/ui so the
// proxy/helmet CSP ('self') allows them (the old unpkg CDN is blocked).
const swaggerUiAssetPath = (
  require("swagger-ui-dist") as { getAbsoluteFSPath(): string }
).getAbsoluteFSPath();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
// Strict helmet everywhere except the Swagger UI page, which needs a relaxed
// CSP (inline initializer + Swagger's inline styles / eval). swaggerUIHandler
// sets its own permissive CSP for that route.
const helmetStrict = helmet();
const helmetNoCsp = helmet({ contentSecurityPolicy: false });
app.use((req, res, next) =>
  req.path.startsWith("/api/docs") ? helmetNoCsp(req, res, next) : helmetStrict(req, res, next),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.cors.origin === "*") return callback(null, true);
      // Allow empcloud.com subdomains (production & test)
      if (origin.endsWith(".empcloud.com") && origin.startsWith("https://")) {
        return callback(null, true);
      }
      if (
        config.env === "development" &&
        (origin.startsWith("http://localhost") ||
          origin.startsWith("http://127.0.0.1") ||
          origin.endsWith(".ngrok-free.dev"))
      ) {
        return callback(null, true);
      }
      const allowed = config.cors.origin.split(",").map((s) => s.trim());
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// Guarantee req.body is always an object. express.json() only populates it when
// a JSON content-type is present, so a body-less POST (e.g. POST /accept with no
// payload) leaves req.body undefined — and any `req.body.x` read then throws.
app.use((req, _res, next) => {
  if (req.body == null) req.body = {};
  next();
});
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.use("/health", healthRoutes);

// ---------------------------------------------------------------------------
// API Routes (v1)
// ---------------------------------------------------------------------------
const v1 = express.Router();
// Record v1's sub-mounts (v1.use('/x', routes)) for OpenAPI auto-discovery,
// prefixed with /api/v1 — must run before the v1.use(...) calls below.
recordMounts(v1, "/api/v1");
v1.use(apiLimiter);

// Active routes
v1.use("/jobs", jobRoutes);
v1.use("/candidates", candidateRoutes);
v1.use("/applications", applicationRoutes);
v1.use("/offers", offerRoutes);
v1.use("/onboarding", onboardingRoutes);

v1.use("/interviews", interviewRoutes);

v1.use("/auth", authLimiter, authRoutes);
v1.use("/referrals", referralRoutes);
v1.use("/email-templates", emailTemplateRoutes);
v1.use("/career-pages", careerPageRoutes);
v1.use("/analytics", analyticsRoutes);
v1.use("/scoring", scoringRoutes);
v1.use("/ai", scoringRoutes); // alias — /ai/batch-score -> /scoring/batch-score (#866)
v1.use("/offer-letters", offerLetterRoutes);
v1.use("/applications", comparisonRoutes);
v1.use("/pipeline", pipelineRoutes);
v1.use("/pipeline-stages", pipelineRoutes); // alias — /pipeline-stages/stages -> /pipeline/stages (#864)
v1.use("/background-checks", backgroundCheckRoutes);
v1.use("/jobs", jobDescriptionRoutes);
v1.use("/job-descriptions", jobDescriptionRoutes); // alias — /job-descriptions/generate-description (#862 #863)
v1.use("/surveys", surveyRoutes);
v1.use("/assessments", assessmentRoutes);
v1.use("/organizations", organizationRoutes);
v1.use("/job-publishing", jobPublishingRoutes); // outbound job-board publishing (scaffold)

// Public routes (no auth required) — career pages, job listings, applications
app.use("/api/v1/public", publicRoutes);

// Candidate portal routes (portal auth — separate from employee auth)
app.use("/api/v1/portal", portalRoutes);

app.use("/api/v1", v1);

// Static file serving for uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// API Documentation
// Self-hosted Swagger UI assets (swagger-ui-dist) served same-origin.
app.use("/api/docs/ui", express.static(swaggerUiAssetPath, { maxAge: "7d", immutable: true }));
app.get("/api/docs", swaggerUIHandler);
app.get("/api/docs/openapi.json", openapiHandler);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  try {
    // Validate configuration
    const { validateConfig } = await import("./config/validate");
    validateConfig();

    // Initialize EmpCloud master database (users, orgs, auth)
    await initEmpCloudDB();
    await migrateEmpCloudDB();

    // Initialize recruit module database
    const db = await initDB();
    logger.info("Recruit database connected");

    // Run migrations
    await db.migrate();
    logger.info("Recruit database migrations applied");

    // Start server
    app.listen(config.port, config.host, () => {
      logger.info(`emp-recruit server running at http://${config.host}:${config.port}`);
      logger.info(`   Environment: ${config.env}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down...");
  await closeDB();
  await closeEmpCloudDB();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();

export { app };
