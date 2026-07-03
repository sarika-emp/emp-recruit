// ============================================================================
// AI JOB DESCRIPTION GENERATOR ROUTES
// POST /generate-description — Generate a job description from basic inputs
// POST /generate            — Alias for /generate-description (#862)
// GET  /templates           — List available JD templates (#863)
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import * as jdService from "../../services/job-description/job-description.service";
import { generateJobDescriptionSchema } from "@emp-recruit/shared";

const router = Router();

// Shared handler for POST /generate-description and POST /generate
const generateHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = generateJobDescriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        details[key] = details[key] || [];
        details[key].push(issue.message);
      }
      throw new ValidationError("Invalid input", details);
    }

    const result = await jdService.generateJobDescription(parsed.data, req.user!.empcloudOrgId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
};

// POST /generate-description — Generate a job description
router.post(
  "/generate-description",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin", "hr_manager"),
  generateHandler,
);

// POST /generate — Alias for /generate-description (#862)
router.post(
  "/generate",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin", "hr_manager"),
  generateHandler,
);

// GET /templates — List available JD templates (seniority levels & role categories) (#863)
router.get(
  "/templates",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin", "hr_manager"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = {
        seniority_levels: [
          { value: "intern", label: "Intern", years: "0 years" },
          { value: "junior", label: "Junior", years: "0-2 years" },
          { value: "mid", label: "Mid-Level", years: "3-5 years" },
          { value: "senior", label: "Senior", years: "5-8 years" },
          { value: "lead", label: "Lead", years: "7-10 years" },
          { value: "director", label: "Director", years: "10-15 years" },
          { value: "vp", label: "VP", years: "12+ years" },
          { value: "c_level", label: "C-Level", years: "15+ years" },
        ],
        role_categories: [
          { value: "engineer", label: "Engineering / Software Development" },
          { value: "designer", label: "Design / UX / Creative" },
          { value: "product", label: "Product Management" },
          { value: "marketing", label: "Marketing / Growth" },
          { value: "sales", label: "Sales / Business Development" },
          { value: "hr", label: "Human Resources / People Ops" },
          { value: "finance", label: "Finance / Accounting" },
          { value: "operations", label: "Operations / Logistics" },
          { value: "data", label: "Data / Analytics / ML" },
          { value: "default", label: "General / Other" },
        ],
      };
      sendSuccess(res, templates);
    } catch (err) {
      next(err);
    }
  },
);

export { router as jobDescriptionRoutes };
