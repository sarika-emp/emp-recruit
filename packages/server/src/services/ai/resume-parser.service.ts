// ============================================================================
// SHARED RESUME-PARSER SERVICE  —  foundation piece #2
// ----------------------------------------------------------------------------
// One place to turn an uploaded resume file into (a) raw text and (b) STRUCTURED
// candidate fields. Consumed by the scorer today and by the resume-autofill and
// search agents later, so they all parse resumes the same way.
//
// TEXT EXTRACTION is deterministic and keyless (best-effort regex over PDF/DOCX
// bytes — the same MVP approach the scoring service already ships, centralised
// here). STRUCTURING into fields uses the shared LLM service when a provider is
// configured, and falls back to a deterministic heuristic (regex for email/
// phone, dictionary match for skills) when there is no key — so the whole
// service runs today with no API key and upgrades automatically once one lands.
//
// Storage is unchanged: files live on local disk under /uploads and are
// referenced by the candidates.resume_path / applications.resume_path strings.
// ============================================================================

import fs from "fs/promises";
import path from "path";
import { ALL_SKILLS } from "@emp-recruit/shared";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Structured fields extracted from a resume — mirrors the candidate form
 *  fields (first_name/last_name/email/phone/current_company/current_title/
 *  experience_years/skills) so autofill can drop straight in. */
export interface ParsedResume {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  current_company?: string;
  current_title?: string;
  experience_years?: number;
  skills: string[];
  /** the raw extracted text, in case a caller wants it (e.g. embeddings). */
  raw_text: string;
  /** how the STRUCTURING was done — "ai" when the LLM produced the fields,
   *  "heuristic" when the deterministic fallback did. Text extraction is always
   *  local. Mirrors the JD generator's source contract. */
  source: "ai" | "heuristic";
}

// ---------------------------------------------------------------------------
// 1. Raw text extraction (deterministic, keyless — centralised from scorer)
// ---------------------------------------------------------------------------

/**
 * Extract raw text from a resume file on local disk.
 * - PDF: best-effort text between Tj/TJ operators.
 * - DOCX: text inside <w:t> tags.
 * - other: read as UTF-8.
 * Returns "" if the file is missing (never throws).
 */
export async function extractResumeText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  try {
    await fs.access(absolutePath);
  } catch {
    logger.warn(`[resume-parser] file not found: ${absolutePath}`);
    return "";
  }

  if (ext === ".pdf") return extractTextFromPDF(absolutePath);
  if (ext === ".docx") return extractTextFromDOCX(absolutePath);
  return fs.readFile(absolutePath, "utf-8");
}

async function extractTextFromPDF(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const raw = buffer.toString("latin1");
  const textParts: string[] = [];

  const textRegex = /\(([^)]*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(raw)) !== null) textParts.push(match[1]);

  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const inner = match[1];
    const innerTextRegex = /\(([^)]*)\)/g;
    let innerMatch: RegExpExecArray | null;
    while ((innerMatch = innerTextRegex.exec(inner)) !== null) textParts.push(innerMatch[1]);
  }

  const decoded = textParts
    .map((t) =>
      t
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\([()])/g, "$1"),
    )
    .join(" ");

  return decoded || raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ");
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const raw = buffer.toString("utf-8");
  const textParts: string[] = [];
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = wtRegex.exec(raw)) !== null) textParts.push(match[1]);
  if (textParts.length > 0) return textParts.join(" ");
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// 2. Structuring into fields (LLM when available, heuristic fallback)
// ---------------------------------------------------------------------------

/**
 * Parse a resume file into structured candidate fields.
 * @param filePath  relative or absolute path to the resume on local disk.
 * @param orgId     tenant tag for the LLM call (cost/audit attribution).
 */
export async function parseResume(filePath: string, orgId: number = 0): Promise<ParsedResume> {
  const raw_text = await extractResumeText(filePath);
  if (!raw_text.trim()) {
    return { skills: [], raw_text: "", source: "heuristic" };
  }

  const viaLlm = await structureWithLLM(raw_text, orgId);
  if (viaLlm) return { ...viaLlm, raw_text, source: "ai" };

  return { ...structureHeuristically(raw_text), raw_text, source: "heuristic" };
}

interface StructuredFields {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  current_company?: string;
  current_title?: string;
  experience_years?: number;
  skills: string[];
}

/**
 * Ask the shared LLM service to structure the resume. Returns null when no LLM
 * provider is configured or the call fails — the caller then uses the heuristic.
 * Imported lazily so this service has no hard dependency on the llm.service
 * module (keeps the two foundation pieces independently mergeable).
 */
async function structureWithLLM(text: string, orgId: number): Promise<StructuredFields | null> {
  let llm: typeof import("./llm.service").llmService | null = null;
  try {
    llm = (await import("./llm.service")).llmService;
  } catch {
    return null; // llm.service not present on this branch — heuristic only.
  }
  if (!llm.isEnabled()) return null;

  // Cap the text we send to keep tokens bounded; the top of a resume holds the
  // identity/summary/most-recent-role we care about.
  const snippet = text.slice(0, 8000);

  const result = await llm.completeJson<StructuredFields>(
    { organizationId: orgId, feature: "resume-parser" },
    [
      {
        role: "user",
        content:
          "Extract structured fields from this resume text. Return ONLY a JSON object with keys: " +
          "first_name, last_name, email, phone, current_company, current_title, " +
          "experience_years (number, total years of professional experience, best estimate), " +
          "skills (array of concise skill/technology strings). Omit any field you cannot find. " +
          "\n\nRESUME:\n" + snippet,
      },
    ],
    { tier: "balanced", system: "You are an expert technical recruiter extracting candidate data from resumes. Be accurate; do not invent details.", temperature: 0.1, maxTokens: 1000 },
  );
  if (!result) return null;

  const p = result.parsed || ({} as StructuredFields);
  return {
    first_name: clean(p.first_name),
    last_name: clean(p.last_name),
    email: clean(p.email),
    phone: clean(p.phone),
    current_company: clean(p.current_company),
    current_title: clean(p.current_title),
    experience_years: typeof p.experience_years === "number" ? p.experience_years : undefined,
    skills: Array.isArray(p.skills) ? p.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 50) : [],
  };
}

function clean(v?: string): string | undefined {
  if (!v) return undefined;
  const t = String(v).trim();
  return t && t.toLowerCase() !== "not specified" && t.toLowerCase() !== "n/a" ? t : undefined;
}

/**
 * Deterministic fallback — no LLM. Pulls email/phone via regex and skills via
 * the ALL_SKILLS dictionary (the same source the scorer uses), so autofill has
 * something useful even with no API key.
 */
export function structureHeuristically(text: string): StructuredFields {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)\d{3}[\s-]?\d{4}/);

  const lower = text.toLowerCase();
  const skills = ALL_SKILLS.filter((skill) => {
    const s = skill.toLowerCase();
    // word-boundary-ish match; escape regex metachars in the skill token.
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(lower);
  }).slice(0, 50);

  // Best-effort years of experience: look for "N years" phrasing.
  let experience_years: number | undefined;
  const yrs = lower.match(/(\d{1,2})\+?\s*(?:years|yrs)\b/);
  if (yrs) experience_years = parseInt(yrs[1], 10);

  return {
    email: emailMatch ? emailMatch[0] : undefined,
    phone: phoneMatch ? phoneMatch[0].trim() : undefined,
    experience_years,
    skills,
  };
}

export const resumeParserService = { parseResume, extractResumeText, structureHeuristically };
