// ============================================================================
// REFERRAL ROUTES

// GET / — list referrals
// POST / — submit referral
// PATCH /:id/status — update referral status
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../middleware/auth.middleware";
import * as referralService from "../../services/referral/referral.service";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";

const router = Router();

router.use(authenticate);

const submitSchema = z.object({
  job_id: z.string().uuid("Invalid job ID"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  // Phone is optional; when given it must look like a phone number — only digits
  // and phone punctuation, at least one digit — never alphabetic input. BUG-13.
  phone: z
    .string()
    .refine(
      (v) => {
        if (!v.trim()) return true;
        if (/[^\d+\-()\s]/.test(v)) return false;
        const digits = v.replace(/\D/g, "");
        return digits.length >= 1 && digits.length <= 12;
      },
      { message: "Please enter a valid phone number" },
    )
    .optional(),
  relationship: z.string().optional(),
  notes: z.string().optional(),
  resume_path: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(["submitted", "under_review", "hired", "rejected", "bonus_eligible", "bonus_paid"]),
  bonus_amount: z.number().optional(),
});

// GET /jobs � open internal jobs available for employee referrals.
// This must not use the HR-only /jobs route: regular employees can access referrals.
router.get("/jobs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await referralService.listInternalOpenJobs(req.user!.empcloudOrgId);
    sendSuccess(res, jobs);
  } catch (err) {
    next(err);
  }
});
// GET /
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const params: any = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
    };

    // Employees can only see their own referrals
    if (user.role === "employee") {
      params.referrerId = user.empcloudUserId;
    }

    const result = await referralService.listReferrals(user.empcloudOrgId, params);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

// POST /
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        details[key] = details[key] || [];
        details[key].push(issue.message);
      }
      throw new ValidationError("Invalid input", details);
    }

    const referral = await referralService.submitReferral(
      req.user!.empcloudOrgId,
      req.user!.empcloudUserId,
      parsed.data,
    );
    sendSuccess(res, referral, 201);
  } catch (err) {
    next(err);
  }
});

// PATCH /:id/status
router.patch(
  "/:id/status",
  authorize("super_admin", "org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        const details: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".");
          details[key] = details[key] || [];
          details[key].push(issue.message);
        }
        throw new ValidationError("Invalid input", details);
      }

      const referral = await referralService.updateReferralStatus(
        req.user!.empcloudOrgId,
        String(req.params.id),
        parsed.data.status,
        parsed.data.bonus_amount,
      );
      sendSuccess(res, referral);
    } catch (err) {
      next(err);
    }
  },
);

export { router as referralRoutes };
