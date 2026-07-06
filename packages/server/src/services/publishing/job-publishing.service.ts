// ============================================================================
// JOB PUBLISHING SERVICE  —  scaffold
// ----------------------------------------------------------------------------
// Orchestrates publishing a job posting OUT to external boards. Reads per-org
// board settings, runs the (stubbed) connector for each requested board, and
// records the publication lifecycle in job_publications. All org-scoped; the
// org id always comes from the caller's token, never a request body.
//
// Because every connector is a stub, a "publish" here records intent as
// `pending` with a clear reason (what real setup the board needs) — it never
// claims a job went live on a board it cannot actually reach.
// ============================================================================

import { randomUUID } from "crypto";
import { getDB } from "../../db/adapters";
import { NotFoundError, ValidationError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import {
  PUBLISH_CONNECTORS,
  getPublishConnector,
  type BoardKey,
} from "./publish-connectors";

interface JobRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  employment_type: string | null;
}

interface SettingsRow {
  board: string;
  enabled: number | boolean;
  credentials_configured: number | boolean;
}

interface PublicationRow {
  id: string;
  organization_id: number;
  job_id: string;
  board: string;
  status: string;
  external_ref: string | null;
  external_url: string | null;
  status_detail: string | null;
  published_at: string | null;
  updated_at: string;
}

export interface BoardStatus {
  key: string;
  label: string;
  mechanism: string;
  requirements: string;
  enabled: boolean;
  configured: boolean;
  /** True only if the board could actually publish today (never true for stubs). */
  liveCapable: boolean;
}

/** List every board + its per-org settings for the publish UI. */
export async function getBoards(orgId: number): Promise<BoardStatus[]> {
  const db = getDB();
  const result = await db.findMany<SettingsRow>("board_publish_settings", {
    filters: { organization_id: orgId },
    limit: 100,
  });
  const byBoard = new Map(result.data.map((r) => [r.board, r]));

  return PUBLISH_CONNECTORS.map((c) => {
    const s = byBoard.get(c.key);
    const configured = Boolean(s?.credentials_configured);
    return {
      key: c.key,
      label: c.label,
      mechanism: c.mechanism,
      requirements: c.requirements,
      enabled: Boolean(s?.enabled),
      configured,
      // Stubs are never live-capable; this stays false until a real connector
      // replaces the stub. Kept explicit so the UI can be honest.
      liveCapable: false,
    };
  });
}

/** Read a job (org-scoped) into the connector's publish input. */
async function loadJob(orgId: number, jobId: string): Promise<JobRow> {
  const db = getDB();
  const job = (await db.findOne("job_postings", {
    id: jobId,
    organization_id: orgId,
  })) as JobRow | null;
  if (!job) throw new NotFoundError("Job", jobId);
  return job;
}

async function getConfigured(orgId: number, board: string): Promise<boolean> {
  const db = getDB();
  const s = (await db.findOne("board_publish_settings", {
    organization_id: orgId,
    board,
  })) as SettingsRow | null;
  return Boolean(s?.credentials_configured);
}

/** Upsert the job×board publication row. */
async function upsertPublication(
  orgId: number,
  jobId: string,
  board: string,
  fields: Record<string, unknown>,
): Promise<PublicationRow> {
  const db = getDB();
  const existing = (await db.findOne("job_publications", {
    organization_id: orgId,
    job_id: jobId,
    board,
  })) as PublicationRow | null;

  if (existing) {
    await db.update("job_publications", existing.id, { ...fields, updated_at: new Date() });
  } else {
    await db.create("job_publications", {
      id: randomUUID(),
      organization_id: orgId,
      job_id: jobId,
      board,
      ...fields,
    });
  }
  return (await db.findOne("job_publications", {
    organization_id: orgId,
    job_id: jobId,
    board,
  })) as PublicationRow;
}

export interface PublishResult {
  board: string;
  status: string;
  detail: string;
}

/**
 * Publish a job to the requested boards. Each board runs its connector (stub)
 * and its publication row is upserted with the outcome. Returns per-board
 * results. Boards that don't exist are reported, not thrown.
 */
export async function publishToBoards(
  orgId: number,
  jobId: string,
  boards: string[],
  actorId: number,
): Promise<PublishResult[]> {
  if (!Array.isArray(boards) || boards.length === 0) {
    throw new ValidationError("Select at least one board to publish to");
  }
  const job = await loadJob(orgId, jobId);

  const results: PublishResult[] = [];
  for (const board of boards) {
    const connector = getPublishConnector(board);
    if (!connector) {
      results.push({ board, status: "failed", detail: `Unknown board: ${board}` });
      continue;
    }
    const configured = await getConfigured(orgId, board);
    const outcome = await connector.publish(
      {
        jobId: job.id,
        title: job.title,
        description: job.description,
        location: job.location,
        employmentType: job.employment_type,
      },
      configured,
    );

    await upsertPublication(orgId, jobId, board, {
      status: outcome.status,
      external_ref: outcome.externalRef ?? null,
      external_url: outcome.externalUrl ?? null,
      status_detail: outcome.detail,
      published_by: actorId,
      published_at: outcome.status === "published" ? new Date() : null,
    });

    results.push({ board, status: outcome.status, detail: outcome.detail });
    logger.info(
      `[publishing] job=${jobId} board=${board} -> ${outcome.status} org=${orgId} (${outcome.detail.slice(0, 80)})`,
    );
  }
  return results;
}

/** List a job's publications across all boards. */
export async function getPublications(orgId: number, jobId: string): Promise<PublicationRow[]> {
  const db = getDB();
  const result = await db.findMany<PublicationRow>("job_publications", {
    filters: { organization_id: orgId, job_id: jobId },
    limit: 100,
  });
  return result.data;
}

/** Remove a job's posting from a board (stub: local state change). */
export async function unpublishFromBoard(
  orgId: number,
  jobId: string,
  board: string,
): Promise<{ ok: boolean; detail: string }> {
  const connector = getPublishConnector(board);
  if (!connector) throw new ValidationError(`Unknown board: ${board}`);

  const db = getDB();
  const existing = (await db.findOne("job_publications", {
    organization_id: orgId,
    job_id: jobId,
    board,
  })) as PublicationRow | null;
  if (!existing) throw new NotFoundError("Publication", `${jobId}/${board}`);

  const configured = await getConfigured(orgId, board);
  const res = await connector.unpublish(existing.external_ref, configured);

  await db.update("job_publications", existing.id, {
    status: "removed",
    status_detail: res.detail,
    removed_at: new Date(),
    updated_at: new Date(),
  });
  return res;
}

/** Enable/disable a board or mark its credentials configured (per org). */
export async function updateBoardSettings(
  orgId: number,
  board: string,
  patch: { enabled?: boolean; credentialsConfigured?: boolean },
  actorId: number,
): Promise<BoardStatus[]> {
  if (!getPublishConnector(board)) throw new ValidationError(`Unknown board: ${board}`);
  const db = getDB();
  const existing = (await db.findOne("board_publish_settings", {
    organization_id: orgId,
    board,
  })) as { id: string } | null;

  const fields = {
    enabled: patch.enabled,
    credentials_configured: patch.credentialsConfigured,
    updated_by: actorId,
    updated_at: new Date(),
  };
  // Drop undefined so we only update provided fields.
  Object.keys(fields).forEach(
    (k) => (fields as Record<string, unknown>)[k] === undefined && delete (fields as Record<string, unknown>)[k],
  );

  if (existing) {
    await db.update("board_publish_settings", existing.id, fields);
  } else {
    await db.create("board_publish_settings", {
      id: randomUUID(),
      organization_id: orgId,
      board,
      enabled: patch.enabled ?? false,
      credentials_configured: patch.credentialsConfigured ?? false,
      updated_by: actorId,
    });
  }
  return getBoards(orgId);
}
