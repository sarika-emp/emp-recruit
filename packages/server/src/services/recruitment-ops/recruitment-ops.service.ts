import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import type { IDBAdapter } from "../../db/adapters/interface";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { sendEmail, renderTemplate } from "../email/email.service";
import { inviteCandidate } from "../assessment/assessment.service";
import { scheduleInterview, sendInterviewInvitation } from "../interview/interview.service";
import { findUserById } from "../../db/empcloud";

type CandidateIdentity = { email?: string | null; phone?: string | null; linkedin_url?: string | null };
type AutomationEvent = { trigger: string; value?: string | null; applicationId?: string };

const normalizeEmail = (value?: string | null) => value?.trim().toLowerCase() || "";
const normalizePhone = (value?: string | null) => {
  const digits = value?.replace(/\D/g, "") || "";
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const normalizeLinkedIn = (value?: string | null) => (value || "")
  .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

export function candidateMatchSignals(a: CandidateIdentity, b: CandidateIdentity): string[] {
  const signals: string[] = [];
  if (normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email)) signals.push("email");
  if (normalizePhone(a.phone) && normalizePhone(a.phone) === normalizePhone(b.phone)) signals.push("phone");
  if (normalizeLinkedIn(a.linkedin_url) && normalizeLinkedIn(a.linkedin_url) === normalizeLinkedIn(b.linkedin_url)) signals.push("linkedin");
  return signals;
}

export function ruleMatches(rule: { trigger: string; trigger_value?: string | null }, event: AutomationEvent): boolean {
  return rule.trigger === event.trigger && (!rule.trigger_value || rule.trigger_value === event.value);
}

export function extractResumeIdentity(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || null;
  const nameLine = lines.find((line) => !line.includes("@") && !/resume|curriculum|phone|email|address/i.test(line) && /^[\p{L}][\p{L} .'-]{2,80}$/u.test(line)) || "";
  const names = nameLine.split(/\s+/);
  return { first_name: names[0] || "Unknown", last_name: names.slice(1).join(" ") || "Candidate", email, phone };
}

export async function findDuplicates(orgId: number, candidateId: string) {
  const db = getDB();
  const candidate = await db.findOne<any>("candidates", { id: candidateId, organization_id: orgId });
  if (!candidate) throw new NotFoundError("Candidate", candidateId);
  const email = normalizeEmail(candidate.email);
  const phone = normalizePhone(candidate.phone);
  const linkedin = normalizeLinkedIn(candidate.linkedin_url);
  if (!email && !phone && !linkedin) return [];
  const matches = await db.raw<any[][]>(`SELECT * FROM candidates
    WHERE organization_id=? AND id<>? AND (
      (?<>'' AND LOWER(TRIM(COALESCE(email,'')))=?) OR
      (?<>'' AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]',''),10)=?) OR
      (?<>'' AND LOWER(TRIM(TRAILING '/' FROM REPLACE(REPLACE(REPLACE(COALESCE(linkedin_url,''),'https://',''),'http://',''),'www.','')))=?)
    ) ORDER BY updated_at DESC LIMIT 200`, [orgId, candidateId, email, email, phone, phone, linkedin, linkedin]);
  return (matches[0] || [])
    .map((other) => ({ candidate: other, signals: candidateMatchSignals(candidate, other) }))
    .filter((match) => match.signals.length > 0)
    .sort((a, b) => b.signals.length - a.signals.length);
}

export async function mergeCandidates(orgId: number, survivorId: string, mergedId: string, userId: number) {
  if (survivorId === mergedId) throw new ValidationError("A candidate cannot be merged into itself");
  const db = getDB();
  return db.transaction(async (tx) => {
    const survivor = await tx.findOne<any>("candidates", { id: survivorId, organization_id: orgId });
    const merged = await tx.findOne<any>("candidates", { id: mergedId, organization_id: orgId });
    if (!survivor || !merged) throw new NotFoundError("Candidate");
    const signals = candidateMatchSignals(survivor, merged);
    if (!signals.length) throw new ValidationError("Candidates have no verified duplicate signal");
    const conflicts = await tx.raw<any[][]>(`SELECT m.id FROM applications m JOIN applications s
      ON s.organization_id=m.organization_id AND s.job_id=m.job_id AND s.candidate_id=?
      WHERE m.organization_id=? AND m.candidate_id=? LIMIT 1`, [survivorId, orgId, mergedId]);
    if (conflicts[0]?.length) throw new ConflictError("Both candidates have an application for the same job; resolve it before merging");
    // One set-based update transfers every application. The previous 1,000-row
    // page could leave later rows behind to be silently cascade-deleted.
    await tx.raw("UPDATE applications SET candidate_id=? WHERE organization_id=? AND candidate_id=?", [survivorId, orgId, mergedId]);
    for (const table of ["offers", "candidate_assessments", "background_checks", "candidate_surveys", "referrals", "onboarding_checklists", "candidate_scores", "ai_interviews"]) {
      await tx.updateMany(table, { organization_id: orgId, candidate_id: mergedId }, { candidate_id: survivorId });
    }
    // Preserve campaign history while respecting the campaign/candidate unique
    // key when both profiles were recipients of the same campaign.
    await tx.raw(`UPDATE email_campaign_recipients survivor JOIN email_campaign_recipients merged
      ON survivor.organization_id=merged.organization_id AND survivor.campaign_id=merged.campaign_id AND survivor.candidate_id=?
      SET survivor.status=IF(merged.status='sent','sent',survivor.status),
          survivor.sent_at=COALESCE(survivor.sent_at,merged.sent_at),
          survivor.attempts=GREATEST(survivor.attempts,merged.attempts)
      WHERE merged.organization_id=? AND merged.candidate_id=?`, [survivorId, orgId, mergedId]);
    await tx.raw(`DELETE merged FROM email_campaign_recipients merged JOIN email_campaign_recipients survivor
      ON survivor.organization_id=merged.organization_id AND survivor.campaign_id=merged.campaign_id AND survivor.candidate_id=?
      WHERE merged.organization_id=? AND merged.candidate_id=?`, [survivorId, orgId, mergedId]);
    await tx.raw("UPDATE email_campaign_recipients SET candidate_id=? WHERE organization_id=? AND candidate_id=?", [survivorId, orgId, mergedId]);
    await tx.create("candidate_merge_audit", { organization_id: orgId, survivor_candidate_id: survivorId, merged_candidate_id: mergedId, match_signals: JSON.stringify(signals), merged_by: userId });
    await tx.delete("candidates", mergedId);
    return { survivorId, mergedId, signals };
  });
}

export async function listFormFields(orgId: number, jobId: string) {
  const result = await getDB().findMany<any>("application_form_fields", { filters: { organization_id: orgId, job_id: jobId, is_active: true }, sort: { field: "sort_order", order: "asc" }, limit: 200 });
  return result.data.map((f) => ({ ...f, options: typeof f.options === "string" ? JSON.parse(f.options) : f.options }));
}

export async function replaceFormFields(orgId: number, jobId: string, fields: any[]) {
  const db = getDB();
  const job = await db.findOne<any>("job_postings", { id: jobId, organization_id: orgId });
  if (!job) throw new NotFoundError("Job", jobId);
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.field_key)) throw new ValidationError(`Duplicate field key: ${field.field_key}`);
    keys.add(field.field_key);
    if (["single_choice", "multi_choice"].includes(field.field_type) && (!field.options?.length || field.options.some((option: string) => !option.trim()))) {
      throw new ValidationError(`${field.label} requires at least one non-empty option`);
    }
    if (field.is_knockout && (field.knockout_value == null || String(field.knockout_value).trim() === "")) {
      throw new ValidationError(`${field.label} requires a knockout value`);
    }
  }
  for (const field of fields) {
    if (field.condition_field_key && (!keys.has(field.condition_field_key) || field.condition_field_key === field.field_key)) {
      throw new ValidationError(`${field.label} has an invalid conditional field`);
    }
    if (field.is_knockout && field.options?.length && !field.options.includes(field.knockout_value)) {
      throw new ValidationError(`${field.label} knockout value must be one of its options`);
    }
  }
  return db.transaction(async (tx) => {
    const existing = await tx.findMany<any>("application_form_fields", { filters: { organization_id: orgId, job_id: jobId }, limit: 500 });
    const retained = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const row = { label: f.label, field_key: f.field_key, field_type: f.field_type, options: f.options ? JSON.stringify(f.options) : null, required: !!f.required, condition_field_key: f.condition_field_key || null, condition_value: f.condition_value || null, is_knockout: !!f.is_knockout, knockout_value: f.is_knockout ? f.knockout_value ?? null : null, sort_order: i, is_active: true };
      const current = existing.data.find((item: any) => item.field_key === f.field_key);
      if (current) { retained.add(current.id); await tx.update("application_form_fields", current.id, row); }
      else { const created = await tx.create<any>("application_form_fields", { organization_id: orgId, job_id: jobId, ...row }); retained.add(created.id); }
    }
    for (const old of existing.data) if (!retained.has(old.id)) await tx.update("application_form_fields", old.id, { is_active: false });
    const result = await tx.findMany<any>("application_form_fields", { filters: { organization_id: orgId, job_id: jobId }, sort: { field: "sort_order", order: "asc" }, limit: 200 });
    return result.data;
  });
}

export async function prepareFormValues(orgId: number, jobId: string, values: Record<string, unknown>) {
  const fields = await listFormFields(orgId, jobId);
  const rows: any[] = [];
  let knockoutFailed = false;
  const errors: Record<string, string[]> = {};
  for (const field of fields) {
    if (field.condition_field_key && String(values[field.condition_field_key] ?? "") !== String(field.condition_value ?? "")) continue;
    const raw = values[field.field_key];
    const options: string[] = typeof field.options === "string" ? JSON.parse(field.options || "[]") : (field.options || []);
    if (raw != null && raw !== "") {
      if (field.field_type === "number" && !Number.isFinite(Number(raw))) errors[field.field_key] = ["Enter a valid number"];
      if (field.field_type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[field.field_key] = ["Enter a valid date"];
      if (field.field_type === "yes_no" && !["yes", "no"].includes(String(raw).toLowerCase())) errors[field.field_key] = ["Select yes or no"];
      if (field.field_type === "single_choice" && !options.includes(String(raw))) errors[field.field_key] = ["Select a valid option"];
      if (field.field_type === "multi_choice" && (!Array.isArray(raw) || raw.some((item) => !options.includes(String(item))))) errors[field.field_key] = ["Select valid options"];
    }
    const value = Array.isArray(raw) ? JSON.stringify(raw) : String(raw ?? "").trim();
    if (field.required && !value) errors[field.field_key] = ["This field is required"];
    const knockout = String(field.knockout_value ?? "").trim().toLowerCase();
    const failed = !!field.is_knockout && field.knockout_value != null && (Array.isArray(raw)
      ? raw.some((item) => String(item).trim().toLowerCase() === knockout)
      : value.toLowerCase() === knockout);
    knockoutFailed ||= failed;
    rows.push({ field_id: field.id, value: value || null, knockout_failed: failed });
  }
  if (Object.keys(errors).length) throw new ValidationError("Required application fields are missing", errors);
  return { rows, knockoutFailed };
}

export async function storeFormValues(orgId: number, applicationId: string, rows: any[], database?: IDBAdapter) {
  if (!rows.length) return;
  await (database ?? getDB()).createMany("application_form_values", rows.map((row) => ({ organization_id: orgId, application_id: applicationId, ...row })));
}

export async function listAutomationRules(orgId: number) {
  const result = await getDB().findMany<any>("recruitment_automation_rules", { filters: { organization_id: orgId, archived_at: null }, limit: 200 });
  return result.data.map((r) => ({ ...r, action_config: typeof r.action_config === "string" ? JSON.parse(r.action_config) : r.action_config }));
}

export async function createAutomationRule(orgId: number, userId: number, data: any) {
  const db = getDB();
  const duplicate = await db.raw<any[][]>("SELECT id FROM recruitment_automation_rules WHERE organization_id=? AND archived_at IS NULL AND LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1", [orgId, data.name]);
  if ((duplicate[0] || []).length) throw new ValidationError("An automation rule with this name already exists");
  return db.create<any>("recruitment_automation_rules", { organization_id: orgId, name: data.name.trim(), trigger: data.trigger, trigger_value: data.trigger_value || null, action_type: data.action_type, action_config: JSON.stringify(data.action_config || {}), delay_minutes: data.delay_minutes || 0, is_active: data.is_active !== false, created_by: userId });
}

export async function updateAutomationRule(orgId: number, id: string, data: any) {
  const db = getDB();
  const existing = await db.findOne<any>("recruitment_automation_rules", { id, organization_id: orgId });
  if (!existing) throw new NotFoundError("Automation rule", id);
  const duplicate = await db.raw<any[][]>("SELECT id FROM recruitment_automation_rules WHERE organization_id=? AND id<>? AND archived_at IS NULL AND LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1", [orgId, id, data.name]);
  if ((duplicate[0] || []).length) throw new ValidationError("An automation rule with this name already exists");
  return db.update<any>("recruitment_automation_rules", id, {
    name: data.name, trigger: data.trigger, trigger_value: data.trigger_value || null,
    action_type: data.action_type, action_config: JSON.stringify(data.action_config || {}),
    delay_minutes: data.delay_minutes || 0, is_active: data.is_active !== false,
  });
}

export async function deleteAutomationRule(orgId: number, id: string) {
  const db = getDB();
  const existing = await db.findOne<any>("recruitment_automation_rules", { id, organization_id: orgId });
  if (!existing) throw new NotFoundError("Automation rule", id);
  await db.update("recruitment_automation_rules", id, { is_active: false, archived_at: new Date() });
  return { deleted: true };
}

export async function listAutomationRuns(orgId: number, ruleId?: string) {
  const filters: Record<string, any> = { organization_id: orgId };
  if (ruleId) filters.rule_id = ruleId;
  const result = await getDB().findMany<any>("recruitment_automation_runs", {
    filters, sort: { field: "created_at", order: "desc" }, limit: 200,
  });
  return result.data;
}

export async function dispatchAutomationEvent(orgId: number, event: AutomationEvent) {
  const db = getDB();
  const rules = await listAutomationRules(orgId);
  const matching = rules.filter((rule) => rule.is_active && ruleMatches(rule, event));
  let occurrence = "";
  if (event.applicationId && event.trigger === "application_stage_changed") {
    const history = await db.findMany<any>("application_stage_history", { filters: { application_id: event.applicationId, to_stage: event.value }, sort: { field: "created_at", order: "desc" }, limit: 1 });
    occurrence = history.data[0]?.id || history.data[0]?.created_at || "";
  }
  for (const rule of matching) {
    const eventKey = `${event.trigger}:${event.value || ""}:${event.applicationId || ""}:${occurrence}`;
    const existing = await db.findOne<any>("recruitment_automation_runs", { rule_id: rule.id, event_key: eventKey });
    if (existing) continue;
    await db.create("recruitment_automation_runs", { organization_id: orgId, rule_id: rule.id, application_id: event.applicationId || null, event_key: eventKey, status: "pending", scheduled_for: new Date(Date.now() + Number(rule.delay_minutes || 0) * 60000) });
  }
  if (matching.some((rule) => Number(rule.delay_minutes || 0) === 0)) await processDueAutomationRuns(orgId);
  return { scheduled: matching.length };
}

export async function processDueAutomationRuns(orgId: number) {
  const db = getDB();
  await db.raw(`UPDATE recruitment_automation_runs
    SET status='failed', processing_at=NULL,
        error='Worker stopped during an action; outcome requires review before rerun'
    WHERE organization_id=? AND status='processing' AND processing_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`, [orgId]);
  const rows = await db.raw<any[][]>(`SELECT ar.*, r.action_type, r.action_config, r.created_by
    FROM recruitment_automation_runs ar JOIN recruitment_automation_rules r ON r.id=ar.rule_id
    WHERE ar.organization_id=? AND ar.status='pending' AND ar.scheduled_for<=NOW() ORDER BY ar.scheduled_for LIMIT 100`, [orgId]);
  let completed = 0, failed = 0;
  for (const run of rows[0] || []) {
    const claim = await db.raw<any[]>("UPDATE recruitment_automation_runs SET status='processing', processing_at=NOW(), attempts=attempts+1 WHERE id=? AND organization_id=? AND status='pending' AND attempts < max_attempts", [run.id, orgId]);
    if (Number((claim as any)?.[0]?.affectedRows || 0) !== 1) continue;
    try {
      const config = typeof run.action_config === "string" ? JSON.parse(run.action_config) : run.action_config;
      const app = run.application_id ? await db.findOne<any>("applications", { id: run.application_id, organization_id: orgId }) : null;
      const candidate = app ? await db.findOne<any>("candidates", { id: app.candidate_id, organization_id: orgId }) : null;
      if (run.action_type === "send_email") {
        if (!candidate?.email) throw new ValidationError("Automation application has no candidate email");
        await sendEmail(candidate.email, renderTemplate(config.subject || "Recruitment update", { candidate, application: app }), renderTemplate(config.body || "Your application has been updated.", { candidate, application: app }));
      } else if (run.action_type === "assign_assessment") {
        if (!candidate || !config.template_id) throw new ValidationError("Assessment automation requires a candidate and template_id");
        await inviteCandidate(orgId, { candidate_id: candidate.id, template_id: config.template_id });
      } else if (run.action_type === "create_task") {
        await db.create("recruitment_tasks", { organization_id: orgId, job_id: app?.job_id || null, application_id: app?.id || null, title: config.title || "Recruitment follow-up", description: config.description || null, assigned_to: app?.assigned_to || null, due_date: config.due_date || null, status: "todo", created_by: null });
      } else if (run.action_type === "schedule_interview") {
        if (!app) throw new ValidationError("Interview automation requires an application");
        const marker = `automation_run:${run.id}`;
        let interview = await db.findOne<any>("interviews", { organization_id: orgId, application_id: app.id, notes: marker });
        if (!interview) {
          const scheduledAt = new Date(Date.now() + Number(config.schedule_after_minutes ?? 1440) * 60_000);
          interview = await scheduleInterview(orgId, {
            application_id: app.id,
            type: config.type || "video",
            round: Number(config.round || 1),
            title: config.title || "Candidate interview",
            scheduled_at: scheduledAt.toISOString(),
            duration_minutes: Number(config.duration_minutes || 60),
            notes: marker,
            created_by: Number(run.created_by || 0),
            panelists: Array.isArray(config.panelists) ? config.panelists : [],
          });
        }
        await sendInterviewInvitation(orgId, interview.id);
      } else throw new ValidationError(`Unsupported automation action: ${run.action_type}`);
      await db.update("recruitment_automation_runs", run.id, { status: "completed", completed_at: new Date(), processing_at: null, error: null });
      completed++;
    } catch (err: any) {
      const attempts = Number(run.attempts || 0) + 1;
      const maxAttempts = Number(run.max_attempts || 3);
      await db.update<any>("recruitment_automation_runs", run.id, attempts < maxAttempts
        ? { status: "pending", processing_at: null, scheduled_for: new Date(Date.now() + Math.min(30, 2 ** attempts) * 60_000), error: String(err?.message || err).slice(0, 2000) }
        : { status: "failed", processing_at: null, error: String(err?.message || err).slice(0, 2000) });
      failed++;
    }
  }
  return { completed, failed };
}

export async function upsertRecruiterProfile(orgId: number, userId: number, fn: "RO" | "SCM") {
  const db = getDB();
  const user = await findUserById(userId);
  if (!user || Number(user.organization_id) !== Number(orgId)) throw new NotFoundError("Organization user", String(userId));
  const existing = await db.findOne<any>("recruiter_profiles", { organization_id: orgId, user_id: userId });
  return existing ? db.update("recruiter_profiles", existing.id, { function: fn, is_active: true }) : db.create("recruiter_profiles", { organization_id: orgId, user_id: userId, function: fn, is_active: true });
}

export async function createEmailCampaign(orgId: number, userId: number, data: any) {
  const db = getDB();
  return db.transaction(async (tx) => {
    if (data.template_id) {
      const template = await tx.findOne<any>("email_templates", { id: data.template_id, organization_id: orgId });
      if (!template) throw new NotFoundError("Email template", data.template_id);
    }
    const campaign = await tx.create<any>("email_campaigns", { organization_id: orgId, name: data.name, template_id: data.template_id || null, subject: data.subject, body: data.body, status: data.scheduled_for ? "scheduled" : "draft", scheduled_for: data.scheduled_for || null, created_by: userId });
    const candidates = await Promise.all(data.candidate_ids.map((id: string) => tx.findOne<any>("candidates", { id, organization_id: orgId })));
    const valid = candidates.filter(Boolean);
    if (valid.length !== data.candidate_ids.length) throw new ValidationError("One or more candidate recipients are invalid");
    await tx.createMany("email_campaign_recipients", valid.map((c: any) => ({ organization_id: orgId, campaign_id: campaign.id, candidate_id: c.id, email: c.email, status: "pending", attempts: 0 })));
    return { ...campaign, recipient_count: valid.length };
  });
}

export async function listEmailCampaigns(orgId: number) {
  const rows = await getDB().raw<any[][]>(`SELECT c.*,
    COUNT(r.id) AS recipient_count,
    SUM(r.status='sent') AS sent_count,
    SUM(r.status='failed') AS failed_count,
    SUM(r.status='delivery_unknown') AS delivery_unknown_count
    FROM email_campaigns c
    LEFT JOIN email_campaign_recipients r ON r.campaign_id=c.id AND r.organization_id=c.organization_id
    WHERE c.organization_id=? GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`, [orgId]);
  return rows[0] || [];
}

export async function cancelEmailCampaign(orgId: number, campaignId: string) {
  const db = getDB();
  const campaign = await db.findOne<any>("email_campaigns", { id: campaignId, organization_id: orgId });
  if (!campaign) throw new NotFoundError("Email campaign", campaignId);
  if (!["draft", "scheduled", "partial"].includes(campaign.status)) {
    throw new ValidationError("Only draft, scheduled, or partially-sent campaigns can be cancelled");
  }
  return db.update<any>("email_campaigns", campaignId, { status: "cancelled", scheduled_for: null });
}

export async function processDueCampaigns(orgId?: number) {
  const params: any[] = [];
  const orgClause = orgId == null ? "" : " AND organization_id=?";
  if (orgId != null) params.push(orgId);
  await getDB().raw(`UPDATE email_campaign_recipients r JOIN email_campaigns c ON c.id=r.campaign_id AND c.organization_id=r.organization_id
    SET r.status='delivery_unknown', r.last_error='Worker stopped after delivery began; review before retrying'
    WHERE r.status='sending' AND c.status='processing' AND c.updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)${orgId == null ? "" : " AND c.organization_id=?"}`, params);
  await getDB().raw(`UPDATE email_campaigns SET status='partial' WHERE status='processing' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)${orgClause}`, params);
  const rows = await getDB().raw<any[][]>(`SELECT id, organization_id FROM email_campaigns
    WHERE ((status='scheduled' AND scheduled_for<=NOW()) OR (status='partial' AND updated_at < DATE_SUB(NOW(), INTERVAL 30 SECOND)
      AND EXISTS(SELECT 1 FROM email_campaign_recipients retryable WHERE retryable.campaign_id=email_campaigns.id AND retryable.organization_id=email_campaigns.organization_id AND retryable.status IN ('pending','failed') AND retryable.attempts<3)))${orgClause}
    ORDER BY COALESCE(scheduled_for, updated_at) LIMIT 20`, params);
  const results = [];
  for (const campaign of rows[0] || []) results.push({ id: campaign.id, ...(await sendCampaign(Number(campaign.organization_id), campaign.id)) });
  return results;
}

export async function sendCampaign(orgId: number, campaignId: string) {
  const db = getDB();
  const claim = await db.raw<any[]>("UPDATE email_campaigns SET status='processing', updated_at=NOW() WHERE id=? AND organization_id=? AND status IN ('draft','scheduled','partial')", [campaignId, orgId]);
  if (Number((claim as any)?.[0]?.affectedRows || 0) !== 1) throw new ConflictError("Campaign is already being processed or is no longer sendable");
  const campaign = await db.findOne<any>("email_campaigns", { id: campaignId, organization_id: orgId });
  if (!campaign) throw new NotFoundError("Email campaign", campaignId);
  // Bound each worker claim so large campaigns never monopolize an HTTP request
  // or scheduler tick. Partial campaigns are picked up again after 30 seconds.
  const recipients = await db.raw<any[][]>("SELECT * FROM email_campaign_recipients WHERE organization_id=? AND campaign_id=? AND status IN ('pending','failed') AND attempts < 3 ORDER BY created_at LIMIT 100", [orgId, campaignId]);
  let sent = 0, failed = 0;
  for (const recipient of recipients[0] || []) {
    const recipientClaim = await db.raw<any[]>("UPDATE email_campaign_recipients SET status='sending', attempts=attempts+1 WHERE id=? AND organization_id=? AND status IN ('pending','failed') AND attempts < 3", [recipient.id, orgId]);
    if (Number((recipientClaim as any)?.[0]?.affectedRows || 0) !== 1) continue;
    const candidate = await db.findOne<any>("candidates", { id: recipient.candidate_id, organization_id: orgId });
    try {
      await sendEmail(recipient.email, renderTemplate(campaign.subject, { candidate }), renderTemplate(campaign.body, { candidate }));
      await db.update("email_campaign_recipients", recipient.id, { status: "sent", sent_at: new Date(), last_error: null });
      sent++;
    } catch (err: any) {
      await db.update("email_campaign_recipients", recipient.id, { status: "failed", last_error: String(err?.message || err).slice(0, 2000) });
      failed++;
    }
  }
  const outstanding = await db.raw<any[][]>("SELECT COUNT(*) AS total FROM email_campaign_recipients WHERE organization_id=? AND campaign_id=? AND status IN ('pending','sending')", [orgId, campaignId]);
  const exhausted = await db.raw<any[][]>("SELECT COUNT(*) AS total FROM email_campaign_recipients WHERE organization_id=? AND campaign_id=? AND status='failed' AND attempts >= 3", [orgId, campaignId]);
  const unknown = await db.raw<any[][]>("SELECT COUNT(*) AS total FROM email_campaign_recipients WHERE organization_id=? AND campaign_id=? AND status='delivery_unknown'", [orgId, campaignId]);
  const outstandingCount = Number(outstanding[0]?.[0]?.total || 0);
  const exhaustedCount = Number(exhausted[0]?.[0]?.total || 0);
  const unknownCount = Number(unknown[0]?.[0]?.total || 0);
  await db.update("email_campaigns", campaignId, { status: outstandingCount || failed || unknownCount ? "partial" : exhaustedCount ? "failed" : "sent" });
  return { sent, failed, exhausted: exhaustedCount, delivery_unknown: unknownCount, total: (recipients[0] || []).length };
}

export async function retryUnknownCampaignRecipients(orgId: number, campaignId: string) {
  const campaign = await getDB().findOne<any>("email_campaigns", { id: campaignId, organization_id: orgId });
  if (!campaign) throw new NotFoundError("Email campaign", campaignId);
  const changed = await getDB().updateMany("email_campaign_recipients", { organization_id: orgId, campaign_id: campaignId, status: "delivery_unknown" }, { status: "failed", last_error: "Manual retry requested after unknown delivery outcome" });
  if (changed) await getDB().update("email_campaigns", campaignId, { status: "partial" });
  return { queued: changed };
}

export async function recruiterPerformance(orgId: number, from?: string, to?: string) {
  const params: any[] = [orgId];
  let dateClause = "";
  if (from) { dateClause += " AND a.applied_at >= ?"; params.push(from); }
  if (to) { dateClause += " AND a.applied_at < DATE_ADD(?, INTERVAL 1 DAY)"; params.push(to); }
  const rows = await getDB().raw<any[][]>(`SELECT a.assigned_to AS user_id, COALESCE(rp.function, 'RO') AS \`function\`,
    COUNT(*) AS applications,
    SUM(EXISTS(SELECT 1 FROM application_stage_history h WHERE h.application_id=a.id AND h.to_stage='interview')) AS interviews,
    SUM(EXISTS(SELECT 1 FROM application_stage_history h WHERE h.application_id=a.id AND h.to_stage='offer')) AS offers,
    SUM(a.stage='hired') AS hires, SUM(a.stage='rejected') AS rejected,
    SUM(a.sla_due_date IS NOT NULL AND a.sla_due_date < CURDATE() AND a.stage NOT IN ('hired','rejected','withdrawn')) AS sla_breaches,
    ROUND(AVG(DATEDIFF(COALESCE(a.updated_at, NOW()), a.applied_at)), 1) AS avg_turnaround_days
    FROM applications a LEFT JOIN recruiter_profiles rp ON rp.organization_id=a.organization_id AND rp.user_id=a.assigned_to
    WHERE a.organization_id=? AND a.assigned_to IS NOT NULL${dateClause} GROUP BY a.assigned_to, rp.function ORDER BY hires DESC, applications DESC`, params);
  return Promise.all((rows[0] || []).map(async (r: any) => {
    const user = await findUserById(Number(r.user_id)).catch(() => null);
    return { ...r, user_name: user ? `${user.first_name} ${user.last_name}`.trim() : null, applications: Number(r.applications), interviews: Number(r.interviews), offers: Number(r.offers), hires: Number(r.hires), rejected: Number(r.rejected), sla_breaches: Number(r.sla_breaches), conversion_rate: Number(r.applications) ? Math.round(Number(r.hires) / Number(r.applications) * 100) : 0 };
  }));
}
