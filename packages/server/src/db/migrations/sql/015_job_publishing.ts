// ============================================================================
// MIGRATION 015 — Job publishing (outbound to job boards)
// ----------------------------------------------------------------------------
// Storage for publishing job postings OUT to external boards (Naukri, LinkedIn,
// Apna, Indeed, ...). This is the scaffold for the publishing framework; the
// actual board connectors are stubs until real employer credentials / feeds are
// wired (each board's publish path is credentialed and ToS-restricted, so we
// never fake a post).
//
//   board_publish_settings — per-org: which boards are enabled + whether the
//                            operator has supplied credentials (gating flag).
//   job_publications       — one row per (job, board): the publish lifecycle
//                            (draft/pending/published/failed/removed), the
//                            board's external posting ref, and timestamps.
//
// Conventions: UUID PKs, organization_id bigint lead column, JSON for structured
// payloads, idempotent hasTable guards, down() drops in reverse order.
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // --- per-org board settings ------------------------------------------------
  const hasSettings = await knex.schema.hasTable("board_publish_settings");
  if (!hasSettings) {
    await knex.schema.createTable("board_publish_settings", (t) => {
      t.uuid("id").primary();
      t.bigInteger("organization_id").unsigned().notNullable();
      t.string("board", 24).notNullable(); // naukri | linkedin | apna | indeed | feed
      t.boolean("enabled").notNullable().defaultTo(false);
      // Opaque credential presence — actual secrets live out of band. When false,
      // the connector is inert (reports "not configured") and can't post.
      t.boolean("credentials_configured").notNullable().defaultTo(false);
      // Free-form connector config (feed URL, account id, ...) — never secrets.
      t.json("config").nullable();
      t.bigInteger("updated_by").nullable();
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());

      t.unique(["organization_id", "board"]);
    });
  }

  // --- per (job, board) publication lifecycle --------------------------------
  const hasPubs = await knex.schema.hasTable("job_publications");
  if (!hasPubs) {
    await knex.schema.createTable("job_publications", (t) => {
      t.uuid("id").primary();
      t.bigInteger("organization_id").unsigned().notNullable();
      t.uuid("job_id")
        .notNullable()
        .references("id")
        .inTable("job_postings")
        .onDelete("CASCADE");
      t.string("board", 24).notNullable();
      // lifecycle: draft -> pending -> published | failed | removed
      t.enum("status", ["draft", "pending", "published", "failed", "removed"])
        .notNullable()
        .defaultTo("draft");
      // the board's own posting id / URL once live (null until published).
      t.string("external_ref", 512).nullable();
      t.string("external_url", 512).nullable();
      // why a publish is pending or failed (e.g. "board not configured").
      t.string("status_detail", 255).nullable();
      t.bigInteger("published_by").nullable();
      t.timestamp("published_at").nullable();
      t.timestamp("removed_at").nullable();
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());

      t.unique(["organization_id", "job_id", "board"]); // one publication per job×board
      t.index(["organization_id", "job_id"]);
      t.index(["organization_id", "board", "status"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("job_publications");
  await knex.schema.dropTableIfExists("board_publish_settings");
}
