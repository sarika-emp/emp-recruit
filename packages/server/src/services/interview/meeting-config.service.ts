// ============================================================================
// MEETING PROVIDER CONFIG SERVICE
// ============================================================================
// Per-org selection of the default interview meeting provider, backed by
// meeting_provider_configs. Falls back to the global config default when an org
// has no row yet. Provider OAuth credentials are added here in Phase 2.
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import { getDB } from "../../db/adapters";
import { config } from "../../config";
import { ValidationError } from "../../utils/errors";
import { ALL_PROVIDER_KEYS, isProviderRegistered, getProvider } from "./providers";
import type { MeetingProviderKey } from "./providers/types";

export interface MeetingProviderConfig {
  organization_id: number;
  default_provider: MeetingProviderKey;
  /** Which providers have an adapter registered (jitsi + the externals). */
  available_providers: MeetingProviderKey[];
  /** Subset of available_providers that are actually usable for this org
   *  (jitsi is always ready; externals need credentials/OAuth). */
  configured_providers: MeetingProviderKey[];
  settings: Record<string, unknown> | null;
}

interface ConfigRow {
  id: string;
  organization_id: number;
  default_provider: string;
  settings: string | Record<string, unknown> | null;
}

function parseSettings(raw: ConfigRow["settings"]): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export async function getMeetingConfig(orgId: number): Promise<MeetingProviderConfig> {
  const db = getDB();
  const row = await db.findOne<ConfigRow>("meeting_provider_configs", {
    organization_id: orgId,
  });

  const defaultProvider = (row?.default_provider ||
    config.meeting.defaultProvider) as MeetingProviderKey;

  const available = ALL_PROVIDER_KEYS.filter(isProviderRegistered);
  const configured: MeetingProviderKey[] = [];
  for (const key of available) {
    const provider = getProvider(key);
    if (provider && (await provider.isConfigured(orgId))) configured.push(key);
  }

  return {
    organization_id: orgId,
    default_provider: defaultProvider,
    available_providers: available,
    configured_providers: configured,
    settings: parseSettings(row?.settings ?? null),
  };
}

/** The provider key an interview should use when none is explicitly requested. */
export async function getDefaultProviderKey(orgId: number): Promise<MeetingProviderKey> {
  const cfg = await getMeetingConfig(orgId);
  return cfg.default_provider;
}

export async function setMeetingConfig(
  orgId: number,
  input: { default_provider?: string; settings?: Record<string, unknown> | null },
): Promise<MeetingProviderConfig> {
  const db = getDB();

  if (input.default_provider !== undefined) {
    if (!ALL_PROVIDER_KEYS.includes(input.default_provider as MeetingProviderKey)) {
      throw new ValidationError(`Unknown meeting provider: ${input.default_provider}`);
    }
    if (!isProviderRegistered(input.default_provider)) {
      throw new ValidationError(
        `Provider "${input.default_provider}" is not available yet (no adapter configured)`,
      );
    }
  }

  const existing = await db.findOne<ConfigRow>("meeting_provider_configs", {
    organization_id: orgId,
  });

  const patch: Record<string, unknown> = {};
  if (input.default_provider !== undefined) patch.default_provider = input.default_provider;
  if (input.settings !== undefined) patch.settings = JSON.stringify(input.settings);

  if (existing) {
    await db.update("meeting_provider_configs", existing.id, patch);
  } else {
    await db.create("meeting_provider_configs", {
      id: uuidv4(),
      organization_id: orgId,
      default_provider: input.default_provider ?? config.meeting.defaultProvider,
      settings: input.settings !== undefined ? JSON.stringify(input.settings) : null,
    });
  }

  return getMeetingConfig(orgId);
}
