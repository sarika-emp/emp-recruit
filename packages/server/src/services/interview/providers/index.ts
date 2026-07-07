// ============================================================================
// MEETING PROVIDER REGISTRY
// ============================================================================
// Adapters register here; the interview service resolves one per interview.
// Resolution order: explicit request > org default > global default > jitsi
// (jitsi always works, so createMeeting can never be left without a provider).
// ============================================================================

import { config } from "../../../config";
import { logger } from "../../../utils/logger";
import type { MeetingProvider, MeetingProviderKey } from "./types";
import { jitsiProvider } from "./jitsi.adapter";
import { googleMeetProvider } from "./google-meet.adapter";
import { teamsProvider } from "./teams.adapter";
import { zoomProvider } from "./zoom.adapter";

/** Every provider we intend to support — drives the Settings picker even
 *  before an adapter is wired (external ones arrive in Phase 2). */
export const ALL_PROVIDER_KEYS: MeetingProviderKey[] = [
  "jitsi",
  "livekit",
  "google_meet",
  "teams",
  "zoom",
];

const registry = new Map<MeetingProviderKey, MeetingProvider>();

function register(provider: MeetingProvider): void {
  registry.set(provider.key, provider);
}

// --- Registrations ---------------------------------------------------------
register(jitsiProvider);
register(googleMeetProvider);
register(teamsProvider);
register(zoomProvider);

export function getProvider(key: MeetingProviderKey): MeetingProvider | undefined {
  return registry.get(key);
}

export function isProviderRegistered(key: string): key is MeetingProviderKey {
  return registry.has(key as MeetingProviderKey);
}

export function listRegisteredProviders(): MeetingProvider[] {
  return [...registry.values()];
}

/**
 * Resolve the adapter for a requested provider key, falling back to the
 * org/global default and finally to jitsi.
 */
export function resolveProvider(
  preferred?: MeetingProviderKey | string | null,
): MeetingProvider {
  const candidates = [preferred, config.meeting.defaultProvider, "jitsi"];
  for (const key of candidates) {
    if (key && registry.has(key as MeetingProviderKey)) {
      return registry.get(key as MeetingProviderKey)!;
    }
  }
  logger.warn(`No meeting provider registered for "${preferred}"; falling back to jitsi`);
  return jitsiProvider;
}
