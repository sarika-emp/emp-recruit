// ============================================================================
// MIGRATION 011 — Multi-provider interview meetings
// ============================================================================
// Turns the single `interviews.meeting_link` string into a proper meeting
// record so a meeting can come from any provider (embedded Jitsi/JaaS, Google
// Meet, Teams, Zoom) behind one adapter interface:
//   - meeting_provider    which adapter produced the meeting
//   - meeting_external_id  the provider's meeting/room id (or our room name)
//   - meeting_host_url     provider "start/host" URL when it differs from join
//   - meeting_embeddable   true => can be rendered inside our <InterviewRoom>
// `meeting_link` is kept as the participant join URL for backward compatibility.
//
// Also adds `meeting_provider_configs` — one row per org selecting the default
// provider (per-provider OAuth credentials land here in Phase 2).
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const hasProvider = await knex.schema.hasColumn("interviews", "meeting_provider");
  if (!hasProvider) {
    await knex.schema.alterTable("interviews", (t) => {
      t.string("meeting_provider", 20).nullable();
      t.string("meeting_external_id", 255).nullable();
      t.string("meeting_host_url", 500).nullable();
      t.boolean("meeting_embeddable").notNullable().defaultTo(false);
    });
  }

  const hasConfigTable = await knex.schema.hasTable("meeting_provider_configs");
  if (!hasConfigTable) {
    await knex.schema.createTable("meeting_provider_configs", (t) => {
      t.uuid("id").primary();
      t.bigInteger("organization_id").unsigned().notNullable();
      // 'jitsi' | 'livekit' | 'google_meet' | 'teams' | 'zoom'
      t.string("default_provider", 20).notNullable().defaultTo("jitsi");
      // Non-secret, per-provider overrides (e.g. jitsi mode/domain). Secrets and
      // OAuth refresh tokens are stored separately in Phase 2.
      t.json("settings").nullable();
      t.timestamp("created_at").defaultTo(knex.fn.now());
      t.timestamp("updated_at").defaultTo(knex.fn.now());

      t.unique(["organization_id"]);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("meeting_provider_configs");

  const hasProvider = await knex.schema.hasColumn("interviews", "meeting_provider");
  if (hasProvider) {
    await knex.schema.alterTable("interviews", (t) => {
      t.dropColumn("meeting_provider");
      t.dropColumn("meeting_external_id");
      t.dropColumn("meeting_host_url");
      t.dropColumn("meeting_embeddable");
    });
  }
}
