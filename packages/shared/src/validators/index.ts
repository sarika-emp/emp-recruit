// ============================================================================
// EMP-RECRUIT SHARED VALIDATORS (Zod schemas)
// ============================================================================

import { z } from "zod";
import {
  JobStatus,
  ApplicationStage,
  InterviewType,
  InterviewStatus,
  OfferStatus,
  OnboardingStatus,
  ReferralStatus,
  Recommendation,
  CandidateSource,
} from "../types";

// ---------------------------------------------------------------------------
// Common / Reusable
// ---------------------------------------------------------------------------

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).optional(),
    per_page: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).default("desc"),
    search: z.string().optional(),
  })
  .transform((val) => ({
    ...val,
    perPage: val.perPage ?? val.per_page ?? 20,
  }));

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

// Base object (no refinements) — so both create and update can derive cleanly.
const jobBaseSchema = z.object({
  title: z.string().min(2).max(200),
  department: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  employment_type: z.string().max(50).default("full_time"),
  experience_min: z.number().int().min(0).optional(),
  experience_max: z.number().int().min(0).optional(),
  salary_min: z.number().int().min(0).optional(),
  salary_max: z.number().int().min(0).optional(),
  salary_currency: z.string().length(3).default("INR"),
  description: z.string().min(10),
  requirements: z.string().optional(),
  benefits: z.string().optional(),
  skills: z.array(z.string()).optional(),
  hiring_manager_id: z.number().int().optional(),
  max_applications: z.number().int().min(1).optional(),
  // #30 — remote policy (onsite / remote / hybrid). The frontend form has
  // always had this select; now it actually gets stored.
  remote_policy: z.enum(["onsite", "remote", "hybrid"]).default("onsite"),
  // Internal-only job — appears on Internal Jobs but not the public career page.
  is_internal: z.boolean().optional(),
  // #1354 — Accept both ISO datetime and YYYY-MM-DD date strings
  closes_at: z
    .string()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: "Invalid date format",
    })
    .optional(),
});

// Min must not exceed Max for the experience and salary ranges (checked only
// when both ends are present). Applied to both create and update.
const withRangeChecks = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine(
      (d: any) =>
        d.experience_min == null ||
        d.experience_max == null ||
        d.experience_min <= d.experience_max,
      { message: "Min experience cannot be greater than max experience", path: ["experience_max"] },
    )
    .refine(
      (d: any) => d.salary_min == null || d.salary_max == null || d.salary_min <= d.salary_max,
      { message: "Min salary cannot be greater than max salary", path: ["salary_max"] },
    );

export const createJobSchema = withRangeChecks(jobBaseSchema);
export const updateJobSchema = withRangeChecks(jobBaseSchema.partial());

export const changeJobStatusSchema = z.object({
  status: z.nativeEnum(JobStatus),
});

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const createCandidateSchema = z.object({
  first_name: z.string().min(1).max(64),
  last_name: z.string().min(1).max(64),
  email: z.string().email().max(128),
  phone: z.string().max(20).optional(),
  source: z.nativeEnum(CandidateSource).default(CandidateSource.DIRECT),
  linkedin_url: z.string().url().optional(),
  portfolio_url: z.string().url().optional(),
  current_company: z.string().max(200).optional(),
  current_title: z.string().max(200).optional(),
  experience_years: z.number().min(0).max(50).optional(),
  skills: z.array(z.string()).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateCandidateSchema = createCandidateSchema.partial();

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const createApplicationSchema = z.object({
  job_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  source: z.nativeEnum(CandidateSource).default(CandidateSource.DIRECT),
  cover_letter: z.string().optional(),
});

export const moveStageSchema = z.object({
  stage: z.nativeEnum(ApplicationStage),
  notes: z.string().optional(),
  rejection_reason: z.string().optional(),
});

export const addNoteSchema = z.object({
  notes: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

export const scheduleInterviewSchema = z.object({
  application_id: z.string().uuid(),
  type: z.nativeEnum(InterviewType),
  round: z.number().int().min(1).default(1),
  title: z.string().min(2).max(200),
  scheduled_at: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(480).default(60),
  location: z.string().max(500).optional(),
  meeting_link: z.string().url().optional(),
  panelist_ids: z.array(z.number().int()).min(1),
  notes: z.string().optional(),
});

export const submitFeedbackSchema = z.object({
  recommendation: z.nativeEnum(Recommendation),
  technical_score: z.number().int().min(1).max(5).optional(),
  communication_score: z.number().int().min(1).max(5).optional(),
  cultural_fit_score: z.number().int().min(1).max(5).optional(),
  overall_score: z.number().int().min(1).max(5).optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export const createOfferSchema = z.object({
  application_id: z.string().uuid(),
  salary_amount: z.number().int().min(0),
  salary_currency: z.string().length(3).default("INR"),
  joining_date: z.string(),
  expiry_date: z.string(),
  job_title: z.string().min(2).max(200),
  department: z.string().max(100).optional(),
  benefits: z.string().optional(),
  notes: z.string().optional(),
  approver_ids: z.array(z.number().int()).optional(),
});

export const updateOfferSchema = z.object({
  salary_amount: z.number().int().min(0).optional(),
  salary_currency: z.string().length(3).optional(),
  joining_date: z.string().optional(),
  expiry_date: z.string().optional(),
  job_title: z.string().min(2).max(200).optional(),
  department: z.string().max(100).optional(),
  benefits: z.string().optional(),
  notes: z.string().optional(),
  status: z.nativeEnum(OfferStatus).optional(),
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const createOnboardingTemplateSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  department: z.string().max(100).optional(),
  is_default: z.boolean().default(false),
});

export const addTemplateTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  category: z.string().min(1).max(50),
  assignee_role: z.string().max(50).optional(),
  due_days: z.number().int().min(0).default(0),
  order: z.number().int().min(0).default(0),
  is_required: z.boolean().default(true),
});

export const updateTaskStatusSchema = z.object({
  status: z.nativeEnum(OnboardingStatus),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export const createReferralSchema = z.object({
  job_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  relationship: z.string().max(200).optional(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

export const createEmailTemplateSchema = z.object({
  name: z.string().min(2).max(200),
  trigger: z.string().min(1).max(50),
  subject: z.string().min(2).max(500),
  body: z.string().min(10),
  is_active: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Career Page
// ---------------------------------------------------------------------------

export const updateCareerPageSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  logo_url: z.string().url().optional().nullable(),
  banner_url: z.string().url().optional().nullable(),
  primary_color: z.string().max(7).optional(),
  is_active: z.boolean().optional(),
  custom_css: z.string().optional().nullable(),
});

// ---------------------------------------------------------------------------
// Public Application (Career Page — no auth)
// ---------------------------------------------------------------------------

export const publicApplicationSchema = z.object({
  job_id: z.string().uuid(),
  first_name: z.string().min(1).max(64),
  last_name: z.string().min(1).max(64),
  email: z.string().email().max(128),
  phone: z.string().max(20).optional(),
  cover_letter: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  portfolio_url: z.string().url().optional(),
  source: z.nativeEnum(CandidateSource).default(CandidateSource.DIRECT),
});

// ---------------------------------------------------------------------------
// Background Checks
// ---------------------------------------------------------------------------

const BackgroundCheckProvider = z.enum(["checkr", "sterling", "hireright", "manual"]);
const BackgroundCheckType = z.enum(["criminal", "employment", "education", "credit", "reference", "identity"]);
const BackgroundCheckResult = z.enum(["clear", "consider", "adverse", "pending"]);

export const initiateBackgroundCheckSchema = z.object({
  candidate_id: z.string().uuid(),
  provider: BackgroundCheckProvider,
  check_type: BackgroundCheckType,
});

export const createBackgroundCheckPackageSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  checks_included: z.array(BackgroundCheckType).min(1),
  provider: BackgroundCheckProvider,
  estimated_days: z.number().int().min(1).optional(),
  cost: z.number().int().min(0).optional(),
  is_default: z.boolean().default(false),
});

export const updateBackgroundCheckResultSchema = z.object({
  result: BackgroundCheckResult,
  result_details: z.record(z.any()).optional(),
  report_url: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// AI Job Description Generator
// ---------------------------------------------------------------------------

export const generateJobDescriptionSchema = z.object({
  title: z.string().min(2).max(200),
  department: z.string().max(100).optional(),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "director", "vp", "c_level"]),
  skills: z.array(z.string()).min(1),
  location: z.string().max(200).optional(),
  employment_type: z.string().max(50).optional(),
  salary_range: z.string().max(100).optional(),
  company_description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Candidate Surveys / NPS
// ---------------------------------------------------------------------------

const SurveyType = z.enum(["post_interview", "post_offer", "post_rejection"]);

export const sendSurveySchema = z.object({
  candidate_id: z.string().uuid(),
  application_id: z.string().uuid(),
  survey_type: SurveyType,
});

export const submitSurveyResponseSchema = z.object({
  responses: z.array(
    z.object({
      question_key: z.string().min(1).max(100),
      rating: z.number().int().min(1).max(10).optional(),
      text_response: z.string().optional(),
    }),
  ).min(1),
});

// ---------------------------------------------------------------------------
// Psychometric Assessments
// ---------------------------------------------------------------------------

const AssessmentType = z.enum(["behavioral", "cognitive", "personality", "situational"]);
const QuestionType = z.enum(["multiple_choice", "true_false", "text", "scale"]);

export const createAssessmentTemplateSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  assessment_type: AssessmentType,
  time_limit_minutes: z.number().int().min(1).max(480).optional(),
  questions: z.array(
    z.object({
      question: z.string().min(1),
      options: z.array(z.string()).default([]),
      type: QuestionType,
      correct_answer: z.string().nullable().optional(),
    }),
  ).min(1),
});

export const inviteCandidateAssessmentSchema = z.object({
  candidate_id: z.string().uuid(),
  template_id: z.string().uuid(),
});

export const submitAssessmentSchema = z.object({
  answers: z.array(
    z.object({
      question_index: z.number().int().min(0),
      answer: z.string().min(1),
      time_taken_seconds: z.number().int().min(0).optional(),
    }),
  ).min(1),
});
