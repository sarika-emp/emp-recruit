// ============================================================================
// FEED TOKEN SERVICE  —  shared by feed-based board connectors (Indeed, LinkedIn)
// ----------------------------------------------------------------------------
// A per-org, per-board opaque token that scopes a public job-feed URL so the
// feed can be served without auth while resolving to exactly one org — and
// without exposing the numeric org id. Stored on board_publish_settings.feed_token.
// ============================================================================

import { randomBytes, randomUUID } from "crypto";
import { getDB } from "../../db/adapters";

interface SettingsRow {
  id: string;
  organization_id: number;
  board: string;
  feed_token: string | null;
}

/**
 * Ensure the org's settings row for `board` exists and has a feed token; return
 * it. Idempotent — reuses an existing token. `credentialsConfigured` seeds the
 * row on first create (feed-based boards need no credentials, so default false).
 */
export async function ensureFeedToken(orgId: number, board: string): Promise<string> {
  const db = getDB();
  const row = (await db.findOne("board_publish_settings", {
    organization_id: orgId,
    board,
  })) as SettingsRow | null;

  if (row?.feed_token) return row.feed_token;

  const token = randomBytes(18).toString("hex"); // 36-char opaque, non-guessable
  if (row) {
    await db.update("board_publish_settings", row.id, { feed_token: token });
  } else {
    await db.create("board_publish_settings", {
      id: randomUUID(),
      organization_id: orgId,
      board,
      enabled: true,
      credentials_configured: false, // organic feed needs no credentials
      feed_token: token,
    });
  }
  return token;
}

/** Resolve a feed token (for a given board) back to its org, or null. */
export async function resolveOrgByFeedToken(
  token: string,
  board: string,
): Promise<number | null> {
  if (!token) return null;
  const db = getDB();
  const row = (await db.findOne("board_publish_settings", {
    feed_token: token,
    board,
  })) as SettingsRow | null;
  return row ? row.organization_id : null;
}
