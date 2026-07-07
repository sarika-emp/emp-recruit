// ============================================================================
// MIGRATION 016 — Indeed feed token
// ----------------------------------------------------------------------------
// A per-org, per-board opaque token that scopes the public Indeed XML feed URL
// (/public/feeds/indeed/<token>.xml). Lets the feed be served without auth while
// resolving to exactly one org — and without exposing the numeric org id. Only
// used by the Indeed connector today; harmless for other boards.
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("board_publish_settings", "feed_token");
  if (!has) {
    await knex.schema.alterTable("board_publish_settings", (t) => {
      t.string("feed_token", 64).nullable();
      t.index(["feed_token"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn("board_publish_settings", "feed_token");
  if (has) {
    await knex.schema.alterTable("board_publish_settings", (t) => {
      t.dropIndex(["feed_token"]);
      t.dropColumn("feed_token");
    });
  }
}
