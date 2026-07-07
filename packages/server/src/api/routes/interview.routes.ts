// ============================================================================
// INTERVIEW ROUTES
// All interview scheduling, panelist management, and feedback endpoints.
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { recordingUpload } from "../middleware/upload.middleware";
import { sendSuccess, sendPaginated } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import * as interviewService from "../../services/interview/interview.service";
import * as recordingService from "../../services/interview/recording.service";
import * as evaluationService from "../../services/ai/evaluation.service";
import type { InterviewStatus } from "@emp-recruit/shared";

const router = Router();

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// GET / — List interviews (HR/admin only)
// ---------------------------------------------------------------------------
router.get("/", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const { page, limit, application_id, status, sort_field, sort_order } = req.query;

    const result = await interviewService.listInterviews(orgId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      application_id: application_id as string | undefined,
      status: status as InterviewStatus | undefined,
      sort_field: sort_field as string | undefined,
      sort_order: sort_order as "asc" | "desc" | undefined,
    });

    return sendPaginated(res, result.data, result.total, result.page, result.perPage);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST / — Schedule a new interview (hr_admin, hr_manager only)
// ---------------------------------------------------------------------------
router.post(
  "/",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const { application_id, type, round, title, scheduled_at, duration_minutes, location, meeting_link, notes, panelists } = req.body;

      if (!application_id || !type || !round || !title || !scheduled_at || !duration_minutes) {
        throw new ValidationError("Missing required fields: application_id, type, round, title, scheduled_at, duration_minutes");
      }

      const roundNum = Number(round);
      if (!Number.isInteger(roundNum) || roundNum < 1) {
        throw new ValidationError("Round must be a positive integer");
      }
      const durationNum = Number(duration_minutes);
      if (!Number.isInteger(durationNum) || durationNum < 15 || durationNum > 480) {
        throw new ValidationError("Duration must be between 15 and 480 minutes");
      }

      const interview = await interviewService.scheduleInterview(orgId, {
        application_id,
        type,
        round: roundNum,
        title,
        scheduled_at,
        duration_minutes: durationNum,
        location,
        meeting_link,
        notes,
        created_by: req.user!.empcloudUserId,
        panelists,
      });

      return sendSuccess(res, interview, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /meeting-config — Org's default meeting provider + available providers
// PUT /meeting-config — Update the org's default provider / settings
// NOTE: declared before "/:id" so the literal path isn't captured as an id.
// ---------------------------------------------------------------------------
router.get(
  "/meeting-config",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cfg = await interviewService.getMeetingConfig(req.user!.empcloudOrgId);
      return sendSuccess(res, cfg);
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/meeting-config",
  authorize("org_admin", "hr_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { default_provider, settings } = req.body ?? {};
      const cfg = await interviewService.setMeetingConfig(req.user!.empcloudOrgId, {
        default_provider,
        settings,
      });
      return sendSuccess(res, cfg);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id — Get interview detail with panelists + feedback (HR/admin only)
// ---------------------------------------------------------------------------
router.get("/:id", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const interview = await interviewService.getInterview(orgId, String(req.params.id));
    return sendSuccess(res, interview);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/calendar-links — Get calendar URLs (Google, Outlook, Office 365)
// ---------------------------------------------------------------------------
router.get("/:id/calendar-links", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const links = await interviewService.getCalendarLinks(orgId, String(req.params.id));
    return sendSuccess(res, links);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/calendar.ics — Download ICS file for the interview
// ---------------------------------------------------------------------------
router.get("/:id/calendar.ics", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const icsContent = await interviewService.generateICSFile(orgId, String(req.params.id));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="interview-${req.params.id}.ics"`);
    return res.send(icsContent);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /:id — Update / reschedule interview (HR/admin only)
// ---------------------------------------------------------------------------
router.put("/:id", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const { type, round, title, scheduled_at, duration_minutes, location, meeting_link, notes } = req.body;

    if (round !== undefined && round !== null) {
      const roundNum = Number(round);
      if (!Number.isInteger(roundNum) || roundNum < 1) {
        throw new ValidationError("Round must be a positive integer");
      }
    }
    if (duration_minutes !== undefined && duration_minutes !== null) {
      const durationNum = Number(duration_minutes);
      if (!Number.isInteger(durationNum) || durationNum < 15 || durationNum > 480) {
        throw new ValidationError("Duration must be between 15 and 480 minutes");
      }
    }

    const interview = await interviewService.updateInterview(orgId, String(req.params.id), {
      type,
      round,
      title,
      scheduled_at,
      duration_minutes,
      location,
      meeting_link,
      notes,
    });

    return sendSuccess(res, interview);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id/status — Change interview status (HR/admin only)
// ---------------------------------------------------------------------------
router.patch("/:id/status", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const { status } = req.body;

    if (!status) {
      throw new ValidationError("Missing required field: status");
    }

    const interview = await interviewService.changeStatus(orgId, String(req.params.id), status);
    return sendSuccess(res, interview);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/panelists — Add a panelist
// ---------------------------------------------------------------------------
router.post(
  "/:id/panelists",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const { user_id, role } = req.body;

      if (!user_id || !role) {
        throw new ValidationError("Missing required fields: user_id, role");
      }

      const panelist = await interviewService.addPanelist(orgId, String(req.params.id), user_id, role);
      return sendSuccess(res, panelist, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /:id/panelists/:userId — Remove a panelist
// ---------------------------------------------------------------------------
router.delete(
  "/:id/panelists/:userId",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      await interviewService.removePanelist(orgId, String(req.params.id), Number(String(req.params.userId)));
      return sendSuccess(res, { message: "Panelist removed" });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/feedback — Submit feedback (any panelist)
// ---------------------------------------------------------------------------
router.post("/:id/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const userId = req.user!.empcloudUserId;
    const { recommendation, technical_score, communication_score, cultural_fit_score, overall_score, strengths, weaknesses, notes } = req.body;

    if (!recommendation) {
      throw new ValidationError("Missing required field: recommendation");
    }

    const feedback = await interviewService.submitFeedback(orgId, String(req.params.id), userId, {
      recommendation,
      technical_score,
      communication_score,
      cultural_fit_score,
      overall_score,
      strengths,
      weaknesses,
      notes,
    });

    return sendSuccess(res, feedback, 201);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/feedback — Get all feedback for an interview
// ---------------------------------------------------------------------------
router.get("/:id/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const feedback = await interviewService.getFeedback(orgId, String(req.params.id));
    return sendSuccess(res, feedback);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/generate-meet — Provision a meeting via the configured provider.
// Optional body { provider } overrides the org default (jitsi, google_meet,
// teams, zoom). Returns the full meeting record, not just the link.
// ---------------------------------------------------------------------------
router.post(
  "/:id/generate-meet",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const provider = req.body?.provider as string | undefined;
      const meeting = await interviewService.createMeeting(orgId, String(req.params.id), provider);
      // `meeting_link` kept in the response for backward compatibility.
      return sendSuccess(res, { ...meeting, meeting_link: meeting.joinUrl });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/meeting-token — Mint short-lived join credentials for the embedded
// room (<InterviewRoom>). HR/panelists join as moderators.
// ---------------------------------------------------------------------------
router.post(
  "/:id/meeting-token",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const u = req.user!;
      const token = await interviewService.getInterviewRoomToken(orgId, String(req.params.id), {
        userId: u.empcloudUserId,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email,
        email: u.email,
        moderator: true,
      });
      return sendSuccess(res, token);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/send-invitation — Send email invitation to candidate + panelists
// ---------------------------------------------------------------------------
router.post(
  "/:id/send-invitation",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const result = await interviewService.sendInterviewInvitation(orgId, String(req.params.id));
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/recordings — Upload recording (multipart)
// ---------------------------------------------------------------------------
router.post(
  "/:id/recordings",
  authorize("org_admin", "hr_admin", "hr_manager"),
  recordingUpload.single("recording"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const userId = req.user!.empcloudUserId;

      if (!req.file) {
        throw new ValidationError("No recording file provided");
      }

      const recording = await recordingService.uploadRecording(
        orgId,
        String(req.params.id),
        req.file,
        userId,
      );
      return sendSuccess(res, recording, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id/recordings — List recordings for an interview (HR/admin only)
// ---------------------------------------------------------------------------
router.get("/:id/recordings", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const recordings = await recordingService.getRecordings(orgId, String(req.params.id));
    return sendSuccess(res, recordings);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id/recordings/:recId — Delete a recording
// ---------------------------------------------------------------------------
router.delete(
  "/:id/recordings/:recId",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      await recordingService.deleteRecording(orgId, String(req.params.recId));
      return sendSuccess(res, { message: "Recording deleted" });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/recordings/:recId/transcribe — Generate transcript from recording
// ---------------------------------------------------------------------------
router.post(
  "/:id/recordings/:recId/transcribe",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const transcript = await recordingService.generateTranscript(
        orgId,
        String(req.params.id),
        String(req.params.recId),
      );
      return sendSuccess(res, transcript, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id/transcript — Get transcript for an interview (HR/admin only)
// ---------------------------------------------------------------------------
router.get("/:id/transcript", authorize("org_admin", "hr_admin", "hr_manager"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.empcloudOrgId;
    const transcript = await recordingService.getTranscript(orgId, String(req.params.id));
    return sendSuccess(res, transcript);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /:id/transcript/:tId — Update transcript summary
// ---------------------------------------------------------------------------
router.put(
  "/:id/transcript/:tId",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const { summary } = req.body;

      if (summary === undefined) {
        throw new ValidationError("Missing required field: summary");
      }

      const transcript = await recordingService.updateTranscriptSummary(
        orgId,
        String(req.params.tId),
        summary,
      );
      return sendSuccess(res, transcript);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/ai-evaluate — Generate an AI candidate evaluation from the stored
// transcript + interviewer feedback (HR/admin only)
// ---------------------------------------------------------------------------
router.post(
  "/:id/ai-evaluate",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const evaluation = await evaluationService.generateEvaluation(orgId, String(req.params.id));
      return sendSuccess(res, evaluation, 201);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id/ai-evaluation — Get the AI evaluation for an interview (HR/admin only)
// ---------------------------------------------------------------------------
router.get(
  "/:id/ai-evaluation",
  authorize("org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.empcloudOrgId;
      const evaluation = await evaluationService.getEvaluation(orgId, String(req.params.id));
      return sendSuccess(res, evaluation);
    } catch (err) {
      next(err);
    }
  },
);

export { router as interviewRoutes };
