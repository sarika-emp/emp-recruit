// ============================================================================
// EMP-RECRUIT SHARED TYPES
// These types are the single source of truth for both server and client.
// ============================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum JobStatus {
  DRAFT = "draft",
  OPEN = "open",
  PAUSED = "paused",
  CLOSED = "closed",
  FILLED = "filled",
}

export enum ApplicationStage {
  APPLIED = "applied",
  SCREENED = "screened",
  INTERVIEW = "interview",
  OFFER = "offer",
  HIRED = "hired",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
}

export enum InterviewType {
  PHONE = "phone",
  VIDEO = "video",
  ONSITE = "onsite",
  ASSIGNMENT = "assignment",
  PANEL = "panel",
}

export enum InterviewStatus {
  SCHEDULED = "scheduled",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  NO_SHOW = "no_show",
}

export enum OfferStatus {
  DRAFT = "draft",
  PENDING_APPROVAL = "pending_approval",
  APPROVED = "approved",
  SENT = "sent",
  ACCEPTED = "accepted",
  DECLINED = "declined",
  EXPIRED = "expired",
  REVOKED = "revoked",
}

export enum OnboardingStatus {
  NOT_STARTED = "not_started",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
}

export enum ReferralStatus {
  SUBMITTED = "submitted",
  UNDER_REVIEW = "under_review",
  HIRED = "hired",
  REJECTED = "rejected",
  BONUS_ELIGIBLE = "bonus_eligible",
  BONUS_PAID = "bonus_paid",
}

export enum Recommendation {
  STRONG_YES = "strong_yes",
  YES = "yes",
  NEUTRAL = "neutral",
  NO = "no",
  STRONG_NO = "strong_no",
}

export enum ScoringRecommendation {
  STRONG_MATCH = "strong_match",
  GOOD_MATCH = "good_match",
  PARTIAL_MATCH = "partial_match",
  WEAK_MATCH = "weak_match",
}

export enum CandidateSource {
  DIRECT = "direct",
  REFERRAL = "referral",
  LINKEDIN = "linkedin",
  INDEED = "indeed",
  NAUKRI = "naukri",
  OTHER = "other",
}

// ---------------------------------------------------------------------------
// API Response envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

export interface JobPosting {
  id: string;
  organization_id: number;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  employment_type: string;
  experience_min: number | null;
  experience_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  description: string;
  requirements: string | null;
  benefits: string | null;
  skills: string | null; // JSON array
  status: JobStatus;
  published_at: string | null;
  closes_at: string | null;
  hiring_manager_id: number | null;
  max_applications: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  remote_policy: string; // onsite | remote | hybrid (#30, #32)
  is_internal: boolean; // internal-only job — hidden from the public career page
}

export interface Candidate {
  id: string;
  organization_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  source: CandidateSource;
  resume_path: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  current_company: string | null;
  current_title: string | null;
  experience_years: number | null;
  skills: string | null; // JSON array
  notes: string | null;
  tags: string | null; // JSON array
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: string;
  organization_id: number;
  job_id: string;
  candidate_id: string;
  stage: ApplicationStage;
  source: CandidateSource;
  cover_letter: string | null;
  resume_path: string | null;
  rating: number | null;
  notes: string | null;
  rejection_reason: string | null;
  applied_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApplicationStageHistory {
  id: string;
  application_id: string;
  from_stage: ApplicationStage | null;
  to_stage: ApplicationStage;
  changed_by: number;
  notes: string | null;
  created_at: string;
}

export interface Interview {
  id: string;
  organization_id: number;
  application_id: string;
  type: InterviewType;
  round: number;
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  location: string | null;
  meeting_link: string | null;
  // Multi-provider meeting fields (migration 011). `meeting_link` remains the
  // participant join URL; these describe which provider produced it.
  meeting_provider: string | null;
  meeting_external_id: string | null;
  meeting_host_url: string | null;
  meeting_embeddable: boolean;
  status: InterviewStatus;
  notes: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface InterviewPanelist {
  id: string;
  interview_id: string;
  user_id: number;
  role: string; // interviewer, observer, lead
  created_at: string;
}

export interface InterviewFeedback {
  id: string;
  interview_id: string;
  panelist_id: number;
  recommendation: Recommendation;
  technical_score: number | null;
  communication_score: number | null;
  cultural_fit_score: number | null;
  overall_score: number | null;
  strengths: string | null;
  weaknesses: string | null;
  notes: string | null;
  submitted_at: string;
  created_at: string;
}

export interface Offer {
  id: string;
  organization_id: number;
  application_id: string;
  candidate_id: string;
  job_id: string;
  status: OfferStatus;
  salary_amount: number; // BIGINT smallest currency unit
  salary_currency: string;
  joining_date: string;
  expiry_date: string;
  job_title: string;
  department: string | null;
  benefits: string | null;
  notes: string | null;
  offer_letter_path: string | null;
  created_by: number;
  approved_by: number | null;
  approved_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfferApprover {
  id: string;
  offer_id: string;
  user_id: number;
  order: number;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  acted_at: string | null;
  created_at: string;
}

export interface OnboardingTemplate {
  id: string;
  organization_id: number;
  name: string;
  description: string | null;
  department: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface OnboardingTemplateTask {
  id: string;
  template_id: string;
  title: string;
  description: string | null;
  category: string;
  assignee_role: string | null;
  due_days: number;
  order: number;
  is_required: boolean;
  created_at: string;
}

export interface OnboardingChecklist {
  id: string;
  organization_id: number;
  application_id: string;
  candidate_id: string;
  template_id: string;
  status: OnboardingStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingTask {
  id: string;
  checklist_id: string;
  template_task_id: string | null;
  title: string;
  description: string | null;
  category: string;
  assignee_id: number | null;
  due_date: string | null;
  status: OnboardingStatus;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Referral {
  id: string;
  organization_id: number;
  job_id: string;
  referrer_id: number;
  candidate_id: string;
  application_id: string | null;
  status: ReferralStatus;
  relationship: string | null;
  notes: string | null;
  bonus_amount: number | null;
  bonus_paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplate {
  id: string;
  organization_id: number;
  name: string;
  trigger: string;
  subject: string;
  body: string; // Handlebars template
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CareerPage {
  id: string;
  organization_id: number;
  slug: string;
  title: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  primary_color: string;
  is_active: boolean;
  custom_css: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecruitmentEvent {
  id: string;
  organization_id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: number;
  metadata: string | null; // JSON
  created_at: string;
}

export interface AuditLog {
  id: string;
  organization_id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: string | null; // JSON
  new_values: string | null; // JSON
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface CandidateScore {
  id: string;
  organization_id: number;
  application_id: string;
  candidate_id: string;
  job_id: string;
  overall_score: number;
  skills_score: number;
  experience_score: number;
  matched_skills: string; // JSON array
  missing_skills: string; // JSON array
  recommendation: ScoringRecommendation;
  scored_at: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Background Check Enums & Interfaces
// ---------------------------------------------------------------------------

export type BackgroundCheckProvider = "checkr" | "sterling" | "hireright" | "manual";
export type BackgroundCheckType = "criminal" | "employment" | "education" | "credit" | "reference" | "identity";
export type BackgroundCheckStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";
export type BackgroundCheckResult = "clear" | "consider" | "adverse" | "pending";

export interface BackgroundCheck {
  id: string;
  organization_id: number;
  candidate_id: string;
  provider: BackgroundCheckProvider;
  check_type: BackgroundCheckType;
  status: BackgroundCheckStatus;
  request_id: string | null;
  result: BackgroundCheckResult | null;
  result_details: string | null; // JSON
  initiated_by: number;
  requested_at: string;
  completed_at: string | null;
  report_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackgroundCheckPackage {
  id: string;
  organization_id: number;
  name: string;
  description: string | null;
  checks_included: string; // JSON array of BackgroundCheckType
  provider: BackgroundCheckProvider;
  estimated_days: number | null;
  cost: number | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Candidate Survey / NPS Enums & Interfaces
// ---------------------------------------------------------------------------

export type SurveyType = "post_interview" | "post_offer" | "post_rejection";
export type SurveyStatus = "sent" | "completed" | "expired";

export interface CandidateSurvey {
  id: string;
  organization_id: number;
  candidate_id: string;
  application_id: string;
  survey_type: SurveyType;
  status: SurveyStatus;
  sent_at: string;
  completed_at: string | null;
  token: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateSurveyResponse {
  id: string;
  survey_id: string;
  organization_id: number;
  question_key: string;
  rating: number | null;
  text_response: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Psychometric Assessment Enums & Interfaces
// ---------------------------------------------------------------------------

export type AssessmentType = "behavioral" | "cognitive" | "personality" | "situational";
export type AssessmentStatus = "invited" | "started" | "completed" | "expired";

export interface AssessmentQuestion {
  question: string;
  options: string[];
  type: "multiple_choice" | "true_false" | "text" | "scale";
  correct_answer?: string | null;
}

export interface AssessmentTemplate {
  id: string;
  organization_id: number;
  name: string;
  description: string | null;
  assessment_type: AssessmentType;
  time_limit_minutes: number | null;
  questions: string | AssessmentQuestion[]; // JSON array
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CandidateAssessment {
  id: string;
  organization_id: number;
  candidate_id: string;
  template_id: string;
  status: AssessmentStatus;
  token: string;
  started_at: string | null;
  completed_at: string | null;
  score: number | null;
  max_score: number | null;
  percentile: number | null;
  result_summary: string | null; // JSON
  created_at: string;
  updated_at: string;
}

export interface AssessmentResponse {
  id: string;
  assessment_id: string;
  organization_id: number;
  question_index: number;
  answer: string;
  is_correct: boolean | null;
  time_taken_seconds: number | null;
  created_at: string;
}
