// ============================================================================
// PUBLIC ROUTES (NO AUTH)
// Career pages, public job listings, and application submissions.
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import * as careerPageService from "../../services/career-page/career-page.service";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";

const router = Router();

// ---------------------------------------------------------------------------
// Multer config for resume uploads
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(process.cwd(), "uploads", "resumes"));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and Word documents are allowed"));
    }
  },
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const applySchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  cover_letter: z.string().optional(),
  current_company: z.string().optional(),
  experience_years: z.coerce.number().optional(),
  expected_salary: z.coerce.number().optional(),
});

// ---------------------------------------------------------------------------
// GET /careers/:slug — career page info
// ---------------------------------------------------------------------------
router.get("/careers/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await careerPageService.getPublicCareerPage(String(req.params.slug));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

// Alias: GET /career-page/:slug -> /careers/:slug (#867)
router.get("/career-page/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await careerPageService.getPublicCareerPage(String(req.params.slug));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /careers/:slug/jobs — list open jobs
// ---------------------------------------------------------------------------
router.get("/careers/:slug/jobs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await careerPageService.getPublicJobs(String(req.params.slug));
    sendSuccess(res, jobs);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /careers/:slug/jobs/:jobId — job detail
// ---------------------------------------------------------------------------
router.get("/careers/:slug/jobs/:jobId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await careerPageService.getPublicJobDetail(String(req.params.slug), String(req.params.jobId));
    sendSuccess(res, job);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /careers/:slug/apply — submit application (multipart)
// ---------------------------------------------------------------------------
router.post(
  "/careers/:slug/apply",
  upload.single("resume"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = applySchema.safeParse(req.body);
      if (!parsed.success) {
        const details: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".");
          details[key] = details[key] || [];
          details[key].push(issue.message);
        }
        throw new ValidationError("Invalid input", details);
      }

      const jobId = req.body.job_id || req.query.job_id;
      if (!jobId) {
        throw new ValidationError("job_id is required");
      }

      const resumePath = req.file ? `/uploads/resumes/${req.file.filename}` : undefined;

      const result = await careerPageService.submitPublicApplication(
        String(req.params.slug),
        jobId as string,
        parsed.data,
        resumePath,
      );

      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /feeds/indeed/:token.xml — public Indeed XML job feed (no auth).
// Indeed's crawler fetches this URL; the token scopes it to one org.
// ---------------------------------------------------------------------------
router.get(
  "/feeds/indeed/:token.xml",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { buildIndeedFeed, resolveOrgByFeedToken } = await import(
        "../../services/publishing/indeed-feed.service"
      );
      const token = String(req.params.token);
      const orgId = await resolveOrgByFeedToken(token);
      if (orgId == null) {
        res.status(404).type("application/xml").send("<!-- unknown feed -->");
        return;
      }
      const xml = await buildIndeedFeed(orgId);
      res.type("application/xml").send(xml);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /feeds/linkedin/:token.xml — public LinkedIn XML job feed (no auth).
// ---------------------------------------------------------------------------
router.get(
  "/feeds/linkedin/:token.xml",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { buildLinkedInFeed, resolveOrgByLinkedInToken } = await import(
        "../../services/publishing/linkedin-feed.service"
      );
      const token = String(req.params.token);
      const orgId = await resolveOrgByLinkedInToken(token);
      if (orgId == null) {
        res.status(404).type("application/xml").send("<!-- unknown feed -->");
        return;
      }
      const xml = await buildLinkedInFeed(orgId);
      res.type("application/xml").send(xml);
    } catch (err) {
      next(err);
    }
  },
);

export { router as publicRoutes };
