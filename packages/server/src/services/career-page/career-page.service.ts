// ============================================================================
// CAREER PAGE SERVICE
// Manages career page configuration, public job listings, and applications.
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import { findOrgById } from "../../db/empcloud";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import type { CareerPage, JobPosting, Candidate, Application } from "@emp-recruit/shared";

// ---------------------------------------------------------------------------
// Admin: Career page configuration
// ---------------------------------------------------------------------------

export async function getConfig(orgId: number): Promise<CareerPage | null> {
  const db = getDB();
  return db.findOne<CareerPage>("career_pages", { organization_id: orgId });
}

export async function updateConfig(
  orgId: number,
  data: Partial<Pick<CareerPage, "title" | "description" | "logo_url" | "banner_url" | "primary_color" | "custom_css" | "slug">>,
): Promise<CareerPage> {
  const db = getDB();
  let page = await db.findOne<CareerPage>("career_pages", { organization_id: orgId });

  if (!page) {
    // Create default career page for this org
    const slug = data.slug || `org-${orgId}`;
    page = await db.create<CareerPage>("career_pages", {
      organization_id: orgId,
      slug,
      title: data.title || "Careers",
      description: data.description || null,
      logo_url: data.logo_url || null,
      banner_url: data.banner_url || null,
      primary_color: data.primary_color || "#4F46E5",
      is_active: true,
      custom_css: data.custom_css || null,
    } as Partial<CareerPage>);
    return page;
  }

  return db.update<CareerPage>("career_pages", page.id, data as Partial<CareerPage>);
}

export async function publishCareerPage(orgId: number): Promise<CareerPage> {
  const db = getDB();
  const page = await db.findOne<CareerPage>("career_pages", { organization_id: orgId });
  if (!page) {
    throw new NotFoundError("Career page");
  }
  return db.update<CareerPage>("career_pages", page.id, { is_active: true } as Partial<CareerPage>);
}

// ---------------------------------------------------------------------------
// Public: Career page access (NO auth)
// ---------------------------------------------------------------------------

export async function getPublicCareerPage(slug: string): Promise<{
  careerPage: CareerPage;
  orgName: string;
  orgLogo: string | null;
}> {
  const db = getDB();
  const page = await db.findOne<CareerPage>("career_pages", { slug, is_active: true });
  if (!page) {
    throw new NotFoundError("Career page", slug);
  }

  const org = await findOrgById(page.organization_id);
  if (!org || !org.is_active) {
    throw new NotFoundError("Organization");
  }

  return {
    careerPage: page,
    orgName: org.name,
    orgLogo: (org as any).logo || null,
  };
}

export async function getPublicJobs(slug: string): Promise<JobPosting[]> {
  const db = getDB();
  const page = await db.findOne<CareerPage>("career_pages", { slug, is_active: true });
  if (!page) {
    throw new NotFoundError("Career page", slug);
  }

  const result = await db.findMany<JobPosting>("job_postings", {
    filters: {
      organization_id: page.organization_id,
      status: "open",
      is_internal: false, // internal-only jobs are hidden from the public career page
    },
    sort: { field: "published_at", order: "desc" },
    limit: 100,
  });

  return result.data;
}

export async function getPublicJobDetail(slug: string, jobId: string): Promise<JobPosting> {
  const db = getDB();
  const page = await db.findOne<CareerPage>("career_pages", { slug, is_active: true });
  if (!page) {
    throw new NotFoundError("Career page", slug);
  }

  const job = await db.findOne<JobPosting>("job_postings", {
    id: jobId,
    organization_id: page.organization_id,
    status: "open",
    is_internal: false, // can't deep-link to an internal job from the public page
  });
  if (!job) {
    throw new NotFoundError("Job posting", jobId);
  }

  return job;
}

export async function submitPublicApplication(
  slug: string,
  jobId: string,
  data: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    cover_letter?: string;
    current_company?: string;
    experience_years?: number;
    expected_salary?: number;
  },
  resumePath?: string,
): Promise<{ candidate: Candidate; application: Application }> {
  const db = getDB();

  // Validate career page
  const page = await db.findOne<CareerPage>("career_pages", { slug, is_active: true });
  if (!page) {
    throw new NotFoundError("Career page", slug);
  }

  // Validate job exists, is open, and isn't internal-only
  const job = await db.findOne<JobPosting>("job_postings", {
    id: jobId,
    organization_id: page.organization_id,
    status: "open",
    is_internal: false, // can't apply to an internal job via the public form
  });
  if (!job) {
    throw new NotFoundError("Job posting", jobId);
  }

  // Check max applications
  if (job.max_applications) {
    const appCount = await db.count("applications", {
      job_id: jobId,
      organization_id: page.organization_id,
    });
    if (appCount >= job.max_applications) {
      throw new ValidationError("This position is no longer accepting applications");
    }
  }

  // Check if candidate already applied to this job
  const existingCandidate = await db.findOne<Candidate>("candidates", {
    organization_id: page.organization_id,
    email: data.email,
  });

  let candidate: Candidate;
  if (existingCandidate) {
    candidate = existingCandidate;
    // Check for duplicate application
    const existingApp = await db.findOne<Application>("applications", {
      job_id: jobId,
      candidate_id: existingCandidate.id,
    });
    if (existingApp) {
      throw new ValidationError("You have already applied for this position");
    }
  } else {
    candidate = await db.create<Candidate>("candidates", {
      organization_id: page.organization_id,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone || null,
      source: "direct",
      resume_path: resumePath || null,
      current_company: data.current_company || null,
      experience_years: data.experience_years ?? null,
    } as Partial<Candidate>);
  }

  // Create application
  const application = await db.create<Application>("applications", {
    organization_id: page.organization_id,
    job_id: jobId,
    candidate_id: candidate.id,
    stage: "applied",
    source: "direct",
    cover_letter: data.cover_letter || null,
    resume_path: resumePath || candidate.resume_path || null,
  } as Partial<Application>);

  // Log stage history
  await db.create("application_stage_history", {
    application_id: application.id,
    from_stage: null,
    to_stage: "applied",
    changed_by: 0, // system
    notes: "Applied via career page",
  });

  logger.info(`Public application submitted: ${data.email} for job ${job.title} (org: ${page.organization_id})`);

  return { candidate, application };
}
