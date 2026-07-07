import { Router, Request, Response, NextFunction } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { sendSuccess, sendPaginated } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import {
  createCandidateSchema,
  updateCandidateSchema,
  bulkImportCandidatesSchema,
  idParamSchema,
  paginationSchema,
} from "@emp-recruit/shared";
import { uploadResume } from "../middleware/upload.middleware";
import * as candidateService from "../../services/candidate/candidate.service";

const router = Router();

// All candidate routes require authentication and HR roles
router.use(authenticate, authorize("super_admin", "org_admin", "hr_admin", "hr_manager"));

// GET / — list candidates
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = paginationSchema.parse(req.query);
    const orgId = req.user!.empcloudOrgId;

    const result = await candidateService.listCandidates(orgId, {
      page: query.page,
      perPage: query.perPage,
      search: query.search,
      sort: query.sort,
      order: query.order,
    });

    return sendPaginated(res, result.data, result.total, result.page, result.perPage);
  } catch (err) {
    next(err);
  }
});

// POST / — create candidate
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createCandidateSchema.parse(req.body);
    const orgId = req.user!.empcloudOrgId;

    const candidate = await candidateService.createCandidate(orgId, data);
    return sendSuccess(res, candidate, 201);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return next(new ValidationError("Invalid candidate data", err.flatten().fieldErrors));
    }
    next(err);
  }
});

// POST /bulk — import many candidates into a job's pipeline in one request
router.post("/bulk", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { job_id, candidates } = bulkImportCandidatesSchema.parse(req.body);
    const orgId = req.user!.empcloudOrgId;

    const result = await candidateService.bulkImportCandidates(orgId, job_id, candidates);
    return sendSuccess(res, result, 201);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return next(new ValidationError("Invalid bulk import data", err.flatten().fieldErrors));
    }
    next(err);
  }
});

// GET /:id — get candidate
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    const orgId = req.user!.empcloudOrgId;

    const candidate = await candidateService.getCandidate(orgId, id);
    return sendSuccess(res, candidate);
  } catch (err) {
    next(err);
  }
});

// PUT /:id — update candidate
router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    const data = updateCandidateSchema.parse(req.body);
    const orgId = req.user!.empcloudOrgId;

    const candidate = await candidateService.updateCandidate(orgId, id, data);
    return sendSuccess(res, candidate);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return next(new ValidationError("Invalid candidate data", err.flatten().fieldErrors));
    }
    next(err);
  }
});

// POST /:id/resume — upload resume
router.post(
  "/:id/resume",
  uploadResume.single("resume"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const orgId = req.user!.empcloudOrgId;

      if (!req.file) {
        return next(new ValidationError("No resume file provided"));
      }

      const relativePath = req.file.path.replace(process.cwd(), "").replace(/\\/g, "/");
      const candidate = await candidateService.updateResumePath(orgId, id, relativePath);
      return sendSuccess(res, candidate);
    } catch (err) {
      next(err);
    }
  },
);

// GET /:id/applications — get candidate's applications
router.get("/:id/applications", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = idParamSchema.parse(req.params);
    const orgId = req.user!.empcloudOrgId;

    const applications = await candidateService.getCandidateApplications(orgId, id);
    return sendSuccess(res, applications);
  } catch (err) {
    next(err);
  }
});

export { router as candidateRoutes };
