import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import { NotFoundError, ConflictError } from "../../utils/errors";
import type { Candidate, Application } from "@emp-recruit/shared";
import * as applicationService from "../application/application.service";

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createCandidate(
  orgId: number,
  data: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    source?: string;
    linkedin_url?: string;
    portfolio_url?: string;
    current_company?: string;
    current_title?: string;
    experience_years?: number;
    skills?: string[];
    notes?: string;
    tags?: string[];
  },
): Promise<Candidate> {
  const db = getDB();

  // Dedup by email per org
  const existing = await db.findOne<Candidate>("candidates", {
    organization_id: orgId,
    email: data.email,
  });
  if (existing) {
    throw new ConflictError(`A candidate with email '${data.email}' already exists in this organization`);
  }

  const record: Record<string, any> = {
    id: uuidv4(),
    organization_id: orgId,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone ?? null,
    source: data.source ?? "direct",
    linkedin_url: data.linkedin_url ?? null,
    portfolio_url: data.portfolio_url ?? null,
    current_company: data.current_company ?? null,
    current_title: data.current_title ?? null,
    experience_years: data.experience_years ?? null,
    skills: data.skills ? JSON.stringify(data.skills) : null,
    notes: data.notes ?? null,
    tags: data.tags ? JSON.stringify(data.tags) : null,
  };

  return db.create<Candidate>("candidates", record as any);
}

export interface BulkImportResult {
  createdNew: number; // brand-new candidates created and applied to the job
  linkedExisting: number; // existing candidate (by email) linked to the job
  skipped: number; // candidate already had an application for this job
  failed: { row: number; name: string; email: string; reason: string }[];
}

/**
 * Import many candidates into one job's pipeline in a single request.
 *
 * For each row: find-or-create the candidate by email (dedup per org), then
 * create an application for the job unless the candidate already applied.
 * Processing is per-row resilient — a bad row is recorded in `failed` and the
 * rest continue — so the caller gets one complete report instead of the client
 * firing N requests and failing partway.
 */
export async function bulkImportCandidates(
  orgId: number,
  jobId: string,
  rows: Array<{
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    source?: string;
    current_company?: string;
    current_title?: string;
    experience_years?: number;
    skills?: string[];
  }>,
): Promise<BulkImportResult> {
  const db = getDB();

  // Validate the job up-front — fail the whole request if it isn't this org's.
  const job = await db.findOne<any>("job_postings", { id: jobId, organization_id: orgId });
  if (!job) throw new NotFoundError("Job", jobId);

  const result: BulkImportResult = { createdNew: 0, linkedExisting: 0, skipped: 0, failed: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = `${row.first_name} ${row.last_name}`.trim();
    try {
      let candidate = await db.findOne<Candidate>("candidates", {
        organization_id: orgId,
        email: row.email,
      });
      let isNew = false;
      if (!candidate) {
        candidate = await createCandidate(orgId, {
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          phone: row.phone,
          source: row.source,
          current_company: row.current_company,
          current_title: row.current_title,
          experience_years: row.experience_years,
          skills: row.skills,
        });
        isNew = true;
      }

      const existingApp = await db.findOne<Application>("applications", {
        organization_id: orgId,
        job_id: jobId,
        candidate_id: candidate.id,
      });
      if (existingApp) {
        result.skipped++;
        continue;
      }

      await applicationService.createApplication(orgId, {
        job_id: jobId,
        candidate_id: candidate.id,
        source: row.source ?? "direct",
      });

      if (isNew) result.createdNew++;
      else result.linkedExisting++;
    } catch (err: any) {
      result.failed.push({
        row: i + 1,
        name,
        email: row.email,
        reason: err?.message ?? "Unknown error",
      });
    }
  }

  return result;
}

export async function updateCandidate(
  orgId: number,
  id: string,
  data: Record<string, any>,
): Promise<Candidate> {
  const db = getDB();
  const existing = await db.findOne<Candidate>("candidates", { id, organization_id: orgId });
  if (!existing) throw new NotFoundError("Candidate", id);

  const updates: Record<string, any> = { ...data };
  if (data.skills && Array.isArray(data.skills)) {
    updates.skills = JSON.stringify(data.skills);
  }
  if (data.tags && Array.isArray(data.tags)) {
    updates.tags = JSON.stringify(data.tags);
  }

  // If email changed, check dedup
  if (data.email && data.email !== existing.email) {
    const dup = await db.findOne<Candidate>("candidates", {
      organization_id: orgId,
      email: data.email,
    });
    if (dup) {
      throw new ConflictError(`A candidate with email '${data.email}' already exists in this organization`);
    }
  }

  return db.update<Candidate>("candidates", id, updates);
}

export async function listCandidates(
  orgId: number,
  params: { page?: number; perPage?: number; search?: string; sort?: string; order?: "asc" | "desc" },
): Promise<{ data: Candidate[]; total: number; page: number; perPage: number }> {
  const db = getDB();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  if (params.search) {
    const search = `%${params.search}%`;
    const offset = (page - 1) * perPage;

    const countRows = await db.raw<any[][]>(
      "SELECT COUNT(*) as total FROM candidates WHERE organization_id = ? AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR current_company LIKE ?)",
      [orgId, search, search, search, search],
    );
    const total = Number(countRows[0]?.[0]?.total ?? 0);

    const dataRows = await db.raw<any[][]>(
      `SELECT * FROM candidates WHERE organization_id = ? AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR current_company LIKE ?) ORDER BY ${params.sort ?? "created_at"} ${params.order ?? "desc"} LIMIT ? OFFSET ?`,
      [orgId, search, search, search, search, perPage, offset],
    );

    return { data: dataRows[0] as Candidate[], total, page, perPage };
  }

  const result = await db.findMany<Candidate>("candidates", {
    page,
    limit: perPage,
    filters: { organization_id: orgId },
    sort: params.sort
      ? { field: params.sort, order: params.order ?? "desc" }
      : { field: "created_at", order: "desc" },
  });

  return { data: result.data, total: result.total, page, perPage };
}

export async function getCandidate(orgId: number, id: string): Promise<Candidate> {
  const db = getDB();
  const candidate = await db.findOne<Candidate>("candidates", { id, organization_id: orgId });
  if (!candidate) throw new NotFoundError("Candidate", id);
  return candidate;
}

export async function getCandidateApplications(
  orgId: number,
  candidateId: string,
): Promise<Application[]> {
  const db = getDB();
  const candidate = await db.findOne<Candidate>("candidates", { id: candidateId, organization_id: orgId });
  if (!candidate) throw new NotFoundError("Candidate", candidateId);

  // Join job_postings so each application carries the job title + department —
  // a plain findMany returns only the raw applications columns, so the UI fell
  // back to the literal label "Job".
  const rows = await db.raw<any[][]>(
    `SELECT a.*, j.title AS job_title, j.department AS job_department
     FROM applications a
     LEFT JOIN job_postings j ON j.id = a.job_id
     WHERE a.organization_id = ? AND a.candidate_id = ?
     ORDER BY a.applied_at DESC
     LIMIT 100`,
    [orgId, candidateId],
  );

  return (rows[0] ?? []) as Application[];
}

export async function updateResumePath(
  orgId: number,
  id: string,
  resumePath: string,
): Promise<Candidate> {
  const db = getDB();
  const existing = await db.findOne<Candidate>("candidates", { id, organization_id: orgId });
  if (!existing) throw new NotFoundError("Candidate", id);

  return db.update<Candidate>("candidates", id, { resume_path: resumePath } as any);
}
