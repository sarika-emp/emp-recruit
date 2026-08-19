import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import * as ops from "../../services/recruitment-ops/recruitment-ops.service";

const router = Router();
router.use(authenticate, authorize("super_admin", "org_admin", "hr_admin", "hr_manager"));
const wrap = (fn: (req: Request) => Promise<any>, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
  try { return sendSuccess(res, await fn(req), status); } catch (err: any) {
    if (err?.name === "ZodError") return next(new ValidationError("Invalid recruitment operations data", err.flatten().fieldErrors));
    next(err);
  }
};

const fieldSchema = z.object({ label: z.string().min(1).max(200), field_key: z.string().regex(/^[a-z][a-z0-9_]*$/), field_type: z.enum(["text", "textarea", "number", "date", "yes_no", "single_choice", "multi_choice"]), options: z.array(z.string()).optional(), required: z.boolean().optional(), condition_field_key: z.string().optional(), condition_value: z.string().optional(), is_knockout: z.boolean().optional(), knockout_value: z.string().optional() });
router.get("/forms/:jobId", wrap((req) => ops.listFormFields(req.user!.empcloudOrgId, String(req.params.jobId))));
router.put("/forms/:jobId", wrap((req) => ops.replaceFormFields(req.user!.empcloudOrgId, String(req.params.jobId), z.array(fieldSchema).max(100).parse(req.body.fields))));

router.get("/duplicates/:candidateId", wrap((req) => ops.findDuplicates(req.user!.empcloudOrgId, String(req.params.candidateId))));
router.post("/duplicates/merge", wrap((req) => { const b = z.object({ survivor_id: z.string().uuid(), merged_id: z.string().uuid() }).parse(req.body); return ops.mergeCandidates(req.user!.empcloudOrgId, b.survivor_id, b.merged_id, req.user!.empcloudUserId); }));

const ruleSchema = z.object({ name: z.string().min(1).max(200), trigger: z.enum(["application_created", "application_stage_changed", "offer_accepted"]), trigger_value: z.string().max(100).optional(), action_type: z.enum(["send_email", "assign_assessment", "create_task", "schedule_interview"]), action_config: z.record(z.any()).default({}), delay_minutes: z.number().int().min(0).max(525600).default(0), is_active: z.boolean().default(true) }).superRefine((value, ctx) => {
  const requiredText = (key: string, label: string) => {
    if (!String(value.action_config[key] || "").trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_config", key], message: `${label} is required` });
  };
  if (value.action_type === "send_email") { requiredText("subject", "Subject"); requiredText("body", "Description"); }
  if (value.action_type === "create_task") { requiredText("title", "Task title"); requiredText("description", "Description"); }
  if (value.action_type === "assign_assessment" && !z.string().uuid().safeParse(value.action_config.template_id).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_config", "template_id"], message: "An assessment template is required" });
  }
  if (value.action_type === "schedule_interview") {
    if (!z.number().int().min(15).max(480).safeParse(Number(value.action_config.duration_minutes)).success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_config", "duration_minutes"], message: "Interview duration must be 15–480 minutes" });
    if (!z.number().int().min(0).max(525600).safeParse(Number(value.action_config.schedule_after_minutes)).success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_config", "schedule_after_minutes"], message: "Interview schedule offset is invalid" });
  }
});
router.get("/automations", wrap((req) => ops.listAutomationRules(req.user!.empcloudOrgId)));
router.post("/automations", wrap((req) => ops.createAutomationRule(req.user!.empcloudOrgId, req.user!.empcloudUserId, ruleSchema.parse(req.body)), 201));
router.put("/automations/:id", wrap((req) => ops.updateAutomationRule(req.user!.empcloudOrgId, String(req.params.id), ruleSchema.parse(req.body))));
router.delete("/automations/:id", wrap((req) => ops.deleteAutomationRule(req.user!.empcloudOrgId, String(req.params.id))));
router.get("/automation-runs", wrap((req) => ops.listAutomationRuns(req.user!.empcloudOrgId, req.query.rule_id as string | undefined)));
router.post("/automations/run-due", wrap((req) => ops.processDueAutomationRuns(req.user!.empcloudOrgId)));

router.put("/recruiters/:userId", wrap((req) => ops.upsertRecruiterProfile(req.user!.empcloudOrgId, Number(req.params.userId), z.object({ function: z.enum(["RO", "SCM"]) }).parse(req.body).function)));
router.get("/recruiter-performance", wrap((req) => ops.recruiterPerformance(req.user!.empcloudOrgId, req.query.from as string, req.query.to as string)));

const campaignSchema = z.object({ name: z.string().min(1).max(200), template_id: z.string().uuid().optional(), subject: z.string().min(1).max(500), body: z.string().min(1), candidate_ids: z.array(z.string().uuid()).min(1).max(5000), scheduled_for: z.string().datetime().optional() });
router.post("/email-campaigns", wrap((req) => ops.createEmailCampaign(req.user!.empcloudOrgId, req.user!.empcloudUserId, campaignSchema.parse(req.body)), 201));
router.get("/email-campaigns", wrap((req) => ops.listEmailCampaigns(req.user!.empcloudOrgId)));
router.post("/email-campaigns/:id/send", wrap((req) => ops.sendCampaign(req.user!.empcloudOrgId, String(req.params.id))));
router.post("/email-campaigns/:id/cancel", wrap((req) => ops.cancelEmailCampaign(req.user!.empcloudOrgId, String(req.params.id))));
router.post("/email-campaigns/:id/retry-unknown", wrap((req) => ops.retryUnknownCampaignRecipients(req.user!.empcloudOrgId, String(req.params.id))));
router.post("/email-campaigns/run-due", wrap((req) => ops.processDueCampaigns(req.user!.empcloudOrgId)));

export { router as recruitmentOpsRoutes };
