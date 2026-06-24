import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import { NotFoundError, ConflictError } from "../../utils/errors";
import type { Candidate, Application } from "@emp-recruit/shared";

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
