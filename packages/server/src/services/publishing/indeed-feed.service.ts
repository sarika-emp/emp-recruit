// ============================================================================
// INDEED XML FEED  —  live connector for the Indeed board
// ----------------------------------------------------------------------------
// Indeed publishes jobs by crawling a public XML feed you host (no API key, no
// paid account for organic listings). This service generates an Indeed-format
// feed of an org's jobs that have been "published to Indeed" (a job_publications
// row with board='indeed' and status='published'). Indeed's crawler fetches the
// feed URL periodically and lists / delists jobs based on what's present.
//
// Feed spec: https://docs.indeed.com/indeed-apply/xml-feed
// The feed is org-scoped by a token in the URL so each org has its own feed
// without exposing another org's jobs.
// ============================================================================

import { getDB } from "../../db/adapters";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { ensureFeedToken, resolveOrgByFeedToken as resolveOrgByFeedTokenShared } from "./feed-token.service";

interface JobRow {
  id: string;
  organization_id: number;
  title: string;
  description: string | null;
  requirements: string | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  updated_at: string;
}

interface CareerPageRow {
  slug: string;
}

/** XML-escape for attribute/text (CDATA handles the rest of the body). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wrap free text in CDATA, neutralizing any accidental "]]>" sequence. */
function cdata(s: string | null | undefined): string {
  const v = (s ?? "").replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${v}]]>`;
}

/** Map our employment_type to Indeed's jobtype vocabulary. */
function indeedJobType(t: string | null): string {
  switch ((t || "").toLowerCase()) {
    case "full_time":
      return "fulltime";
    case "part_time":
      return "parttime";
    case "contract":
      return "contract";
    case "internship":
      return "internship";
    case "temporary":
      return "temporary";
    default:
      return "fulltime";
  }
}

function formatSalary(row: JobRow): string {
  const cur = row.salary_currency || "INR";
  if (row.salary_min && row.salary_max) return `${cur} ${row.salary_min} - ${row.salary_max}`;
  if (row.salary_min) return `${cur} ${row.salary_min}+`;
  return "";
}

/**
 * Build the Indeed XML feed for one org — only the jobs currently published to
 * Indeed (job_publications.board='indeed', status='published'), joined to
 * job_postings, that are still open. Returns the full XML document.
 */
export async function buildIndeedFeed(orgId: number): Promise<string> {
  const db = getDB();

  // Jobs published to Indeed for this org, still open.
  const result = await db.findMany<{ job_id: string }>("job_publications", {
    filters: { organization_id: orgId, board: "indeed", status: "published" },
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

  // The org's public career-page slug drives each job's apply URL.
  const cp = (await db.findOne("career_pages", {
    organization_id: orgId,
  })) as CareerPageRow | null;
  const slug = cp?.slug || `org-${orgId}`;
  const site = config.publicUrls.siteBaseUrl.replace(/\/$/, "");

  const items = jobs
    .map((job) => {
      const applyUrl = `${site}/careers/${slug}/jobs/${job.id}`;
      const fullDesc =
        (job.description ?? "") + (job.requirements ? `\n\nRequirements:\n${job.requirements}` : "");
      const salary = formatSalary(job);
      return [
        "  <job>",
        `    <title>${cdata(job.title)}</title>`,
        `    <date>${xmlEscape(new Date(job.updated_at).toUTCString())}</date>`,
        `    <referencenumber>${cdata(job.id)}</referencenumber>`,
        `    <url>${cdata(applyUrl)}</url>`,
        `    <company>${cdata(cp?.slug ? cp.slug : "Company")}</company>`,
        `    <city>${cdata(job.location ?? "")}</city>`,
        `    <country>IN</country>`,
        `    <description>${cdata(fullDesc)}</description>`,
        job.department ? `    <category>${cdata(job.department)}</category>` : "",
        `    <jobtype>${cdata(indeedJobType(job.employment_type))}</jobtype>`,
        salary ? `    <salary>${cdata(salary)}</salary>` : "",
        "  </job>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const now = new Date().toUTCString();
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<source>\n` +
    `  <publisher>EMP Recruit</publisher>\n` +
    `  <publisherurl>${xmlEscape(site)}</publisherurl>\n` +
    `  <lastBuildDate>${xmlEscape(now)}</lastBuildDate>\n` +
    `${items}\n` +
    `</source>\n`;

  logger.info(`[indeed-feed] built feed for org=${orgId} jobs=${jobs.length}`);
  return xml;
}

/** The public URL of an org's Indeed feed (token-scoped). */
export function indeedFeedUrl(feedToken: string): string {
  const api = config.publicUrls.apiBaseUrl.replace(/\/$/, "");
  return `${api}/api/v1/public/feeds/indeed/${feedToken}.xml`;
}

/** Ensure the org's Indeed feed token (delegates to the shared helper). */
export async function ensureIndeedFeedToken(orgId: number): Promise<string> {
  return ensureFeedToken(orgId, "indeed");
}

/** Resolve an Indeed feed token back to its org, or null if unknown. */
export async function resolveOrgByFeedToken(token: string): Promise<number | null> {
  return resolveOrgByFeedTokenShared(token, "indeed");
}
