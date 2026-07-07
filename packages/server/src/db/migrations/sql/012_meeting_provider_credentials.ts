// ============================================================================
// MIGRATION 012 — Per-org meeting provider credentials (Phase 2)
// ============================================================================
// Stores each org's connection to an external meeting provider:
//   - Google Meet / Teams: OAuth2 (client id/secret + access/refresh tokens)
//   - Zoom: Server-to-Server OAuth (account id + client id/secret)
// One row per (organization_id, provider). Secrets/tokens are stored here;
// in production these columns should be encrypted at rest.
// ============================================================================

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("meeting_provider_credentials");
  if (exists) return;

  await knex.schema.createTable("meeting_provider_credentials", (t) => {
    t.uuid("id").primary();
    t.bigInteger("organization_id").unsigned().notNullable();
    t.string("provider", 20).notNullable(); // google_meet | teams | zoom
    // App credentials (entered by the org admin)
    t.string("client_id", 255).nullable();
    t.string("client_secret", 512).nullable();
    t.string("account_id", 255).nullable(); // Zoom S2S
    t.string("tenant_id", 255).nullable(); // Azure AD tenant (Teams)
    t.string("organizer_email", 255).nullable(); // calendar/meeting owner
    // OAuth tokens (obtained via the connect flow)
    t.text("access_token").nullable();
    t.text("refresh_token").nullable();
    t.timestamp("token_expires_at").nullable();
    // pending (creds saved, not authorized) | connected | error
    t.string("status", 20).notNullable().defaultTo("pending");
    t.string("last_error", 500).nullable();
    t.bigInteger("connected_by").unsigned().nullable();
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("updated_at").defaultTo(knex.fn.now());

    t.unique(["organization_id", "provider"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("meeting_provider_credentials");
}
