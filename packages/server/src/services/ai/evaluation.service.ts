// ============================================================================
// AI CANDIDATE EVALUATION
// ============================================================================
// Turns the stored interview communication (transcript) + interviewer feedback
// + job requirements into a structured, LLM-generated candidate evaluation with
// a 0-100 score. Provider-agnostic via the LLM adapter (Claude / OpenAI / any).
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { getLLM } from "./llm";
import type { Interview } from "@emp-recruit/shared";

export interface AiEvaluation {
  id: string;
  organization_id: number;
  interview_id: string;
  overall_score: number;
  technical_score: number | null;
  communication_score: number | null;
  cultural_fit_score: number | null;
  recommendation: string | null;
  strengths: string | null;
  weaknesses: string | null;
  summary: string | null;
  provider: string | null;
  model: string | null;
  created_at: Date;
  updated_at: Date;
}

const SYSTEM_PROMPT = `You are an expert technical recruiter and interview assessor.
You will be given an interview transcript, optional interviewer scorecards, and the job
requirements. Evaluate ONLY on the evidence in the transcript and feedback — do not invent
facts. Be fair, specific, and concise. Return your assessment as JSON with exactly these keys:
{
  "overall_score": integer 0-100,
  "technical_score": integer 0-100 or null,
  "communication_score": integer 0-100 or null,
  "cultural_fit_score": integer 0-100 or null,
  "recommendation": one of "strong_yes" | "yes" | "neutral" | "no" | "strong_no",
  "strengths": string (2-4 sentences),
  "weaknesses": string (2-4 sentences),
  "summary": string (3-5 sentences)
}`;

function clampScore(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Extract a JSON object from an LLM response that may include stray prose/fences. */
function parseJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new ValidationError("AI returned an unparseable evaluation");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function buildPrompt(orgId: number, interview: Interview): Promise<string> {
  const db = getDB();

  const transcript = await db.findOne<{ content: string }>("interview_transcripts", {
    organization_id: orgId,
    interview_id: interview.id,
  });
  if (!transcript?.content) {
    throw new ValidationError("Generate an interview transcript before running an AI evaluation");
  }

  // Job context (best-effort)
  let jobBlock = "";
  try {
    const app = await db.findById<{ job_id: string }>("applications", interview.application_id);
    if (app?.job_id) {
      const job = await db.findById<{ title?: string; description?: string; requirements?: string }>(
        "job_postings",
        app.job_id,
      );
      if (job) {
        jobBlock = `JOB: ${job.title ?? ""}\nDESCRIPTION: ${job.description ?? ""}\nREQUIREMENTS: ${job.requirements ?? ""}\n\n`;
      }
    }
  } catch {
    /* best-effort */
  }

  // Interviewer scorecards (best-effort)
  let feedbackBlock = "";
  try {
    const rows = await db.findMany<{
      recommendation?: string;
      overall_score?: number;
      strengths?: string;
      weaknesses?: string;
      notes?: string;
    }>("interview_feedback", {
      filters: { organization_id: orgId, interview_id: interview.id },
      limit: 20,
    });
    if (rows.data.length) {
      feedbackBlock =
        "INTERVIEWER FEEDBACK:\n" +
        rows.data
          .map(
            (f, i) =>
              `- Panelist ${i + 1}: recommendation=${f.recommendation ?? "?"}, overall=${f.overall_score ?? "?"}; strengths: ${f.strengths ?? "-"}; concerns: ${f.weaknesses ?? "-"}; notes: ${f.notes ?? "-"}`,
          )
          .join("\n") +
        "\n\n";
    }
  } catch {
    /* best-effort */
  }

  return `${jobBlock}${feedbackBlock}INTERVIEW TRANSCRIPT:\n${transcript.content}`;
}

/** Generate (and persist) an AI evaluation for an interview. Replaces any prior one. */
export async function generateEvaluation(orgId: number, interviewId: string): Promise<AiEvaluation> {
  const db = getDB();

  const interview = await db.findOne<Interview>("interviews", {
    id: interviewId,
    organization_id: orgId,
  });
  if (!interview) throw new NotFoundError("Interview", interviewId);

  const llm = getLLM();
  if (!llm) {
    throw new ValidationError(
      "No AI provider is configured. Set AI_PROVIDER and the matching API key (e.g. ANTHROPIC_API_KEY).",
    );
  }

  const prompt = await buildPrompt(orgId, interview);
  const raw = await llm.complete({ system: SYSTEM_PROMPT, prompt, json: true, maxTokens: 2048 });
  const parsed = parseJson(raw);

  const overall = clampScore(parsed.overall_score);
  if (overall == null) {
    throw new ValidationError("AI evaluation did not return a valid overall score");
  }

  // One current evaluation per interview.
  await db.deleteMany("ai_evaluations", { organization_id: orgId, interview_id: interviewId });

  const now = new Date();
  const evaluation = await db.create<AiEvaluation>("ai_evaluations", {
    id: uuidv4(),
    organization_id: orgId,
    interview_id: interviewId,
    overall_score: overall,
    technical_score: clampScore(parsed.technical_score),
    communication_score: clampScore(parsed.communication_score),
    cultural_fit_score: clampScore(parsed.cultural_fit_score),
    recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : null,
    strengths: parsed.strengths ?? null,
    weaknesses: parsed.weaknesses ?? null,
    summary: parsed.summary ?? null,
    provider: llm.key,
    model: llm.model(),
    created_at: now,
    updated_at: now,
  } as Partial<AiEvaluation>);

  logger.info(`AI evaluation generated for interview ${interviewId} via ${llm.key} (${overall}/100)`);
  return evaluation;
}

export async function getEvaluation(orgId: number, interviewId: string): Promise<AiEvaluation | null> {
  const db = getDB();
  return db.findOne<AiEvaluation>("ai_evaluations", {
    organization_id: orgId,
    interview_id: interviewId,
  });
}
