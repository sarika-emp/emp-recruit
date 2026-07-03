import { v4 as uuidv4 } from "uuid";
import { extractResumeText } from "../ai/resume-parser.service";
import { getDB } from "../../db/adapters";
import { NotFoundError } from "../../utils/errors";
import { ALL_SKILLS } from "@emp-recruit/shared";
import type {
  CandidateScore,
  Candidate,
  JobPosting,
  Application,
  ScoringRecommendation,
} from "@emp-recruit/shared";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoreResult {
  overallScore: number;
  skillsScore: number;
  experienceScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  recommendation: ScoringRecommendation;
}

// ---------------------------------------------------------------------------
// Resume Text Extraction
// ---------------------------------------------------------------------------
// The PDF/DOCX/text extraction now lives in the shared resume-parser service
// (foundation piece #2) so the scorer, autofill, and search agents all parse
// resumes identically. This wrapper is kept for backward compatibility — the
// scorer and its tests call parseResumeText() unchanged.

/**
 * Extract raw text from a resume file. Delegates to the shared resume parser.
 * @deprecated prefer resumeParserService.extractResumeText / parseResume.
 */
export async function parseResumeText(filePath: string): Promise<string> {
  return extractResumeText(filePath);
}

// ---------------------------------------------------------------------------
// Skill Extraction
// ---------------------------------------------------------------------------

interface ExtractedSkill {
  skill: string;
  confidence: number; // 0.0 – 1.0
}

/**
 * Match resume text against the predefined skills dictionary.
 * Uses case-insensitive matching with word boundaries.
 */
export function extractSkills(resumeText: string): ExtractedSkill[] {
  if (!resumeText || resumeText.trim().length === 0) {
    return [];
  }

  const lowerText = resumeText.toLowerCase();
  const found: ExtractedSkill[] = [];

  for (const skill of ALL_SKILLS) {
    const skillLower = skill.toLowerCase();
    // Escape regex special characters in the skill name
    const escaped = skillLower.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

    // Try exact word boundary match first
    const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, "i");
    if (wordBoundaryRegex.test(lowerText)) {
      // Higher confidence for longer skill names (more specific)
      const confidence = Math.min(0.6 + skill.length * 0.03, 1.0);
      found.push({ skill, confidence });
      continue;
    }

    // Try partial match (e.g., "react" in "reactjs")
    if (lowerText.includes(skillLower)) {
      found.push({ skill, confidence: 0.5 });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Scoring Logic
// ---------------------------------------------------------------------------

/**
 * Score a single candidate against a job posting.
 * Returns the computed score and persists it to the database.
 */
export async function scoreCandidate(
  orgId: number,
  candidateId: string,
  jobId: string,
  applicationId: string,
): Promise<ScoreResult & { id: string }> {
  const db = getDB();

  // Fetch candidate
  const candidate = await db.findOne<Candidate>("candidates", {
    id: candidateId,
    organization_id: orgId,
  });
  if (!candidate) throw new NotFoundError("Candidate", candidateId);

  // Fetch job
  const job = await db.findOne<JobPosting>("job_postings", {
    id: jobId,
    organization_id: orgId,
  });
  if (!job) throw new NotFoundError("Job", jobId);

  // Fetch application to verify it exists
  const application = await db.findOne<Application>("applications", {
    id: applicationId,
    organization_id: orgId,
  });
  if (!application) throw new NotFoundError("Application", applicationId);

  // Gather candidate skills from profile + resume
  // Handle both string (raw JSON) and already-parsed array from MySQL JSON column
  const candidateSkills: string[] = candidate.skills
    ? (typeof candidate.skills === "string" ? JSON.parse(candidate.skills) : candidate.skills)
    : [];

  // If candidate has a resume, extract skills from it too
  let resumeSkills: string[] = [];
  if (candidate.resume_path) {
    try {
      const resumeText = await parseResumeText(candidate.resume_path);
      const extracted = extractSkills(resumeText);
      resumeSkills = extracted.map((e) => e.skill);
    } catch (err) {
      logger.warn(`Failed to parse resume for candidate ${candidateId}:`, err);
    }
  }

  // Merge all candidate skills (deduplicated, lowercased for comparison)
  const allCandidateSkills = [
    ...new Set([
      ...candidateSkills.map((s) => s.toLowerCase()),
      ...resumeSkills.map((s) => s.toLowerCase()),
    ]),
  ];

  // Parse job required skills (handle both string and already-parsed array)
  const jobSkills: string[] = job.skills
    ? (typeof job.skills === "string" ? JSON.parse(job.skills) : job.skills)
    : [];
  const jobSkillsLower = jobSkills.map((s) => s.toLowerCase());

  // Calculate skills score
  const { skillsScore, matchedSkills, missingSkills } = calculateSkillsScore(
    allCandidateSkills,
    jobSkillsLower,
    jobSkills,
  );

  // Calculate experience score
  const experienceScore = calculateExperienceScore(
    candidate.experience_years,
    job.experience_min,
    job.experience_max,
  );

  // Overall score: 60% skills + 40% experience
  const overallScore = Math.round(skillsScore * 0.6 + experienceScore * 0.4);

  // Determine recommendation
  const recommendation = getRecommendation(overallScore);

  // Upsert score record (delete existing if any, then create new)
  const existingScore = await db.findOne<CandidateScore>("candidate_scores", {
    application_id: applicationId,
    organization_id: orgId,
  });

  const scoreId = existingScore ? existingScore.id : uuidv4();

  if (existingScore) {
    await db.update<CandidateScore>("candidate_scores", existingScore.id, {
      overall_score: overallScore,
      skills_score: skillsScore,
      experience_score: experienceScore,
      matched_skills: JSON.stringify(matchedSkills),
      missing_skills: JSON.stringify(missingSkills),
      recommendation,
      scored_at: new Date(),
    } as any);
  } else {
    await db.create<CandidateScore>("candidate_scores", {
      id: scoreId,
      organization_id: orgId,
      application_id: applicationId,
      candidate_id: candidateId,
      job_id: jobId,
      overall_score: overallScore,
      skills_score: skillsScore,
      experience_score: experienceScore,
      matched_skills: JSON.stringify(matchedSkills),
      missing_skills: JSON.stringify(missingSkills),
      recommendation,
      scored_at: new Date(),
    } as any);
  }

  return {
    id: scoreId,
    overallScore,
    skillsScore,
    experienceScore,
    matchedSkills,
    missingSkills,
    recommendation,
  };
}

function calculateSkillsScore(
  candidateSkills: string[],
  jobSkillsLower: string[],
  jobSkillsOriginal: string[],
): { skillsScore: number; matchedSkills: string[]; missingSkills: string[] } {
  if (jobSkillsLower.length === 0) {
    // No required skills means a perfect match on skills
    return { skillsScore: 100, matchedSkills: candidateSkills, missingSkills: [] };
  }

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (let i = 0; i < jobSkillsLower.length; i++) {
    const jobSkill = jobSkillsLower[i];
    const hasSkill = candidateSkills.some(
      (cs) => cs === jobSkill || cs.includes(jobSkill) || jobSkill.includes(cs),
    );

    if (hasSkill) {
      matchedSkills.push(jobSkillsOriginal[i]);
    } else {
      missingSkills.push(jobSkillsOriginal[i]);
    }
  }

  const skillsScore = Math.round((matchedSkills.length / jobSkillsLower.length) * 100);
  return { skillsScore, matchedSkills, missingSkills };
}

function calculateExperienceScore(
  candidateYears: number | null,
  minYears: number | null,
  maxYears: number | null,
): number {
  // If job has no experience requirements, give full score
  if (minYears === null && maxYears === null) {
    return 100;
  }

  // If candidate has no experience info, give partial score
  if (candidateYears === null) {
    return 40;
  }

  const min = minYears ?? 0;
  const max = maxYears ?? min + 10;

  // Candidate within range = 100
  if (candidateYears >= min && candidateYears <= max) {
    return 100;
  }

  // Candidate slightly below minimum (within 2 years)
  if (candidateYears < min) {
    const deficit = min - candidateYears;
    if (deficit <= 1) return 75;
    if (deficit <= 2) return 50;
    if (deficit <= 3) return 30;
    return 10;
  }

  // Candidate above maximum (overqualified) — slight penalty
  const excess = candidateYears - max;
  if (excess <= 2) return 85;
  if (excess <= 5) return 70;
  return 60;
}

function getRecommendation(overallScore: number): ScoringRecommendation {
  if (overallScore >= 80) return "strong_match" as ScoringRecommendation;
  if (overallScore >= 60) return "good_match" as ScoringRecommendation;
  if (overallScore >= 40) return "partial_match" as ScoringRecommendation;
  return "weak_match" as ScoringRecommendation;
}

// ---------------------------------------------------------------------------
// Batch Scoring
// ---------------------------------------------------------------------------

/**
 * Score all candidates who applied to a given job.
 */
export async function batchScoreCandidates(
  orgId: number,
  jobId: string,
): Promise<{
  scored: number;
  total: number;
  skipped: number;
  results: Array<ScoreResult & { id: string; applicationId: string; candidateId: string }>;
}> {
  const db = getDB();

  // Verify job exists
  const job = await db.findOne<JobPosting>("job_postings", {
    id: jobId,
    organization_id: orgId,
  });
  if (!job) throw new NotFoundError("Job", jobId);

  // Get all applications for this job
  const applicationsResult = await db.findMany<Application>("applications", {
    filters: { job_id: jobId, organization_id: orgId },
    limit: 1000,
  });

  const results: Array<ScoreResult & { id: string; applicationId: string; candidateId: string }> = [];

  for (const app of applicationsResult.data) {
    try {
      const result = await scoreCandidate(orgId, app.candidate_id, jobId, app.id);
      results.push({
        ...result,
        applicationId: app.id,
        candidateId: app.candidate_id,
      });
    } catch (err) {
      logger.warn(`Failed to score candidate ${app.candidate_id} for job ${jobId}:`, err);
    }
  }

  const total = applicationsResult.data.length;
  return { scored: results.length, total, skipped: total - results.length, results };
}

// ---------------------------------------------------------------------------
// Score Report
// ---------------------------------------------------------------------------

/**
 * Get the stored score report for an application.
 */
export async function getScoreReport(
  orgId: number,
  applicationId: string,
): Promise<CandidateScore | null> {
  const db = getDB();

  const score = await db.findOne<CandidateScore>("candidate_scores", {
    application_id: applicationId,
    organization_id: orgId,
  });

  return score;
}

/**
 * Get all scored applications for a job, ranked by overall score descending.
 */
export async function getJobRankings(
  orgId: number,
  jobId: string,
): Promise<any[]> {
  const db = getDB();

  // Verify job exists
  const job = await db.findOne<JobPosting>("job_postings", {
    id: jobId,
    organization_id: orgId,
  });
  if (!job) throw new NotFoundError("Job", jobId);

  const rows = await db.raw<any[][]>(
    `SELECT cs.*,
            c.first_name as candidate_first_name,
            c.last_name as candidate_last_name,
            TRIM(CONCAT(COALESCE(c.first_name,''), ' ', COALESCE(c.last_name,''))) as candidate_name,
            c.email as candidate_email,
            j.title as job_title,
            a.stage as application_stage
     FROM candidate_scores cs
     LEFT JOIN candidates c ON c.id = cs.candidate_id
     LEFT JOIN applications a ON a.id = cs.application_id
     LEFT JOIN job_postings j ON j.id = cs.job_id
     WHERE cs.organization_id = ? AND cs.job_id = ?
     ORDER BY cs.overall_score DESC`,
    [orgId, jobId],
  );

  return rows[0] as any[];
}
