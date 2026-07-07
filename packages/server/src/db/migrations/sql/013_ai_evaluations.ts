// ============================================================================
// MIGRATION 013 — AI candidate evaluations
// ============================================================================
// Stores an LLM-generated evaluation of an interview, derived from the stored
// transcript (the "communication") plus interviewer feedback and the job
// requirements. One current evaluation per interview (regenerated on demand).
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("ai_evaluations");
  if (exists) return;

  await knex.schema.createTable("ai_evaluations", (t) => {
    t.uuid("id").primary();
    t.bigInteger("organization_id").unsigned().notNullable();
    t.uuid("interview_id").notNullable().references("id").inTable("interviews").onDelete("CASCADE");
    t.integer("overall_score").notNullable(); // 0-100
    t.integer("technical_score").nullable();
    t.integer("communication_score").nullable();
    t.integer("cultural_fit_score").nullable();
    t.string("recommendation", 20).nullable(); // strong_yes … strong_no
    t.text("strengths").nullable();
    t.text("weaknesses").nullable();
    t.text("summary").nullable();
    t.string("provider", 20).nullable();
    t.string("model", 100).nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());

    t.index(["organization_id", "interview_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ai_evaluations");
}
