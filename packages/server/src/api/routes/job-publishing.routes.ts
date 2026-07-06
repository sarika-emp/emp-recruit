// ============================================================================
// JOB PUBLISHING ROUTES  —  scaffold
// ----------------------------------------------------------------------------
// Authenticated (HR-role) endpoints for publishing job postings OUT to external
// boards. Mounted at v1.use("/job-publishing", jobPublishingRoutes). Org id
// always comes from the token, never the body. Follows the module's handler
// convention: try -> service -> sendSuccess; catch -> next(err).
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import {
  getBoards,
  publishToBoards,
  getPublications,
  unpublishFromBoard,
  updateBoardSettings,
} from "../../services/publishing/job-publishing.service";

const router = Router();
router.use(authenticate, authorize("super_admin", "org_admin", "hr_admin", "hr_manager"));

// GET /job-publishing/boards — list boards + per-org status
router.get("/boards", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const boards = await getBoards(req.user!.empcloudOrgId);
    return sendSuccess(res, boards);
  } catch (err) {
    next(err);
  }
});

// PUT /job-publishing/boards/:board — enable/disable or mark credentials
router.put("/boards/:board", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const board = req.params.board as string;
    if (!board) throw new ValidationError("board is required");
    const { enabled, credentialsConfigured } = req.body ?? {};
    const boards = await updateBoardSettings(
      req.user!.empcloudOrgId,
      board,
      { enabled, credentialsConfigured },
      req.user!.empcloudUserId,
    );
    return sendSuccess(res, boards);
  } catch (err) {
    next(err);
  }
});

// GET /job-publishing/jobs/:jobId/publications — a job's publications per board
router.get(
  "/jobs/:jobId/publications",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.jobId as string;
      if (!jobId) throw new ValidationError("jobId is required");
      const pubs = await getPublications(req.user!.empcloudOrgId, jobId);
      return sendSuccess(res, pubs);
    } catch (err) {
      next(err);
    }
  },
);

// POST /job-publishing/jobs/:jobId/publish — publish a job to selected boards
router.post("/jobs/:jobId/publish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.jobId as string;
    if (!jobId) throw new ValidationError("jobId is required");
    const { boards } = req.body ?? {};
    const results = await publishToBoards(
      req.user!.empcloudOrgId,
      jobId,
      boards,
      req.user!.empcloudUserId,
    );
    return sendSuccess(res, results);
  } catch (err) {
    next(err);
  }
});

// POST /job-publishing/jobs/:jobId/unpublish — remove a job from one board
router.post("/jobs/:jobId/unpublish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobId = req.params.jobId as string;
    if (!jobId) throw new ValidationError("jobId is required");
    const { board } = req.body ?? {};
    if (!board) throw new ValidationError("board is required");
    const result = await unpublishFromBoard(req.user!.empcloudOrgId, jobId, board);
    return sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
});

export { router as jobPublishingRoutes };
