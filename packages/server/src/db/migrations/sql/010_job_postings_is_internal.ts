// ============================================================================
// MIGRATION 010 — Add is_internal to job_postings
// ============================================================================
// Lets a job be marked "internal only": it appears on the Internal Jobs page
// (for employee transfers/promotions) but is hidden from the public career
// page. Default false preserves the existing behavior (every open job is both
// public and internal).
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn("job_postings", "is_internal");
  if (!hasColumn) {
    await knex.schema.alterTable("job_postings", (t) => {
      t.boolean("is_internal").notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn("job_postings", "is_internal");
  if (hasColumn) {
    await knex.schema.alterTable("job_postings", (t) => {
      t.dropColumn("is_internal");
    });
  }
}
