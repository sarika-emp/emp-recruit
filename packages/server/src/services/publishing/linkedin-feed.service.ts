// ============================================================================
// LINKEDIN XML FEED  —  live connector for the LinkedIn board
// ----------------------------------------------------------------------------
// LinkedIn ingests jobs via a hosted XML feed (the "Limited Listings" / free
// basic-listing path — no partner API required for basic jobs). This service
// generates a LinkedIn-format feed of an org's jobs published to LinkedIn
// (job_publications row with board='linkedin', status='published'). LinkedIn's
// crawler fetches the feed URL and lists / delists jobs based on its contents.
//
// Feed reference: LinkedIn "Job Postings" XML feed schema (<source>/<job>).
// Feed is org-scoped by an opaque token in the URL.
// ============================================================================

import { getDB } from "../../db/adapters";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { ensureFeedToken, resolveOrgByFeedToken as resolveShared } from "./feed-token.service";

interface JobRow {
  id: string;
  organization_id: number;
  title: string;
  description: string | null;
  requirements: string | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  experience_min: number | null;
  updated_at: string;
}

interface CareerPageRow {
  slug: string;
  title: string | null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cdata(s: string | null | undefined): string {
  const v = (s ?? "").replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${v}]]>`;
}

/** Map our employment_type to LinkedIn's <jobtype> vocabulary. */
function linkedinJobType(t: string | null): string {
  switch ((t || "").toLowerCase()) {
    case "full_time":
      return "FULL_TIME";
    case "part_time":
      return "PART_TIME";
    case "contract":
      return "CONTRACT";
    case "internship":
      return "INTERNSHIP";
    case "temporary":
      return "TEMPORARY";
    default:
      return "FULL_TIME";
  }
}

/** Rough experience-level bucket LinkedIn understands. */
function experienceLevel(min: number | null): string {
  if (min == null) return "NOT_APPLICABLE";
  if (min <= 1) return "ENTRY_LEVEL";
  if (min <= 4) return "ASSOCIATE";
  if (min <= 8) return "MID_SENIOR_LEVEL";
  return "DIRECTOR";
}

/** Build the LinkedIn XML feed for one org (jobs published to LinkedIn, open). */
export async function buildLinkedInFeed(orgId: number): Promise<string> {
  const db = getDB();

  const result = await db.findMany<{ job_id: string }>("job_publications", {
    filters: { organization_id: orgId, board: "linkedin", status: "published" },
    limit: 1000,
  });
  const jobIds = result.data.map((r) => r.job_id);

  const jobs: JobRow[] = [];
  for (const id of jobIds) {
    const job = (await db.findOne("job_postings", {
      id,
      organization_id: orgId,
      status: "open",
    })) as JobRow | null;
    if (job) jobs.push(job);
  }

  const cp = (await db.findOne("career_pages", {
    organization_id: orgId,
  })) as CareerPageRow | null;
  const slug = cp?.slug || `org-${orgId}`;
  const companyName = cp?.title || "Company";
  const site = config.publicUrls.siteBaseUrl.replace(/\/$/, "");

  const items = jobs
    .map((job) => {
      const applyUrl = `${site}/careers/${slug}/jobs/${job.id}`;
      const fullDesc =
        (job.description ?? "") + (job.requirements ? `\n\nRequirements:\n${job.requirements}` : "");
      return [
        "  <job>",
        `    <partnerJobId>${cdata(job.id)}</partnerJobId>`,
        `    <company>${cdata(companyName)}</company>`,
        `    <title>${cdata(job.title)}</title>`,
        `    <description>${cdata(fullDesc)}</description>`,
        `    <applyUrl>${cdata(applyUrl)}</applyUrl>`,
        `    <location>${cdata(job.location ?? "")}</location>`,
        `    <country>IN</country>`,
        job.department ? `    <industryCode>${cdata(job.department)}</industryCode>` : "",
        `    <jobtype>${cdata(linkedinJobType(job.employment_type))}</jobtype>`,
        `    <experienceLevel>${cdata(experienceLevel(job.experience_min))}</experienceLevel>`,
        `    <listDate>${xmlEscape(new Date(job.updated_at).toISOString())}</listDate>`,
        "  </job>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<source>\n` +
    `  <publisher>EMP Recruit</publisher>\n` +
    `  <publisherUrl>${xmlEscape(site)}</publisherUrl>\n` +
    `  <lastBuildDate>${xmlEscape(new Date().toUTCString())}</lastBuildDate>\n` +
    `${items}\n` +
    `</source>\n`;

  logger.info(`[linkedin-feed] built feed for org=${orgId} jobs=${jobs.length}`);
  return xml;
}

/** Ensure the org's LinkedIn feed token. */
export async function ensureLinkedInFeedToken(orgId: number): Promise<string> {
  return ensureFeedToken(orgId, "linkedin");
}

/** Resolve a LinkedIn feed token back to its org. */
export async function resolveOrgByLinkedInToken(token: string): Promise<number | null> {
  return resolveShared(token, "linkedin");
}

/** The public URL of an org's LinkedIn feed (token-scoped). */
export function linkedInFeedUrl(feedToken: string): string {
  const api = config.publicUrls.apiBaseUrl.replace(/\/$/, "");
  return `${api}/api/v1/public/feeds/linkedin/${feedToken}.xml`;
}
