// ============================================================================
// MEETING PROVIDER — adapter interface
// ============================================================================
// One interface, many adapters. An "embedded" provider (Jitsi/JaaS, LiveKit)
// renders inside our own <InterviewRoom>; an "external" provider (Google Meet,
// Teams, Zoom) hands back a link that opens in that vendor's app. Every adapter
// exposes the same createMeeting() so interview.service stays provider-agnostic.
// ============================================================================

export type MeetingProviderKey =
  | "jitsi"
  | "livekit"
  | "google_meet"
  | "teams"
  | "zoom";

export type ParticipantRole = "candidate" | "panelist" | "host";

export interface MeetingParticipant {
  /** EmpCloud user id for internal panelists; omitted for external candidates. */
  userId?: number;
  name: string;
  email: string;
  role: ParticipantRole;
}

/** Everything an adapter needs to provision a meeting for one interview. */
export interface MeetingContext {
  orgId: number;
  interviewId: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  organizer: { userId: number; name: string; email: string };
  participants: MeetingParticipant[];
}

/** The meeting an adapter provisioned — persisted onto the interview row. */
export interface CreatedMeeting {
  provider: MeetingProviderKey;
  /** URL a participant opens (external vendor URL, or our embedded room route). */
  joinUrl: string;
  /** Provider's meeting/room id, or our room name for embedded rooms. */
  externalId: string;
  /** Distinct host/start URL when the provider separates it from join. */
  hostUrl?: string;
  /** True => renderable inside <InterviewRoom> via issueRoomToken(). */
  embeddable: boolean;
  passcode?: string;
}

/** Short-lived credentials the client SDK consumes to join an embedded room. */
export interface RoomToken {
  /** Signed token for the SDK (JaaS JWT / LiveKit access token). Empty for
   *  anonymous public rooms that need no token. */
  token: string;
  roomName: string;
  /** SDK connection host, e.g. "8x8.vc" or "meet.jit.si". */
  serverUrl: string;
  /** Domain to load the external_api / SDK from. */
  domain: string;
  expiresAt: Date | null;
}

export interface IssueTokenContext {
  orgId: number;
  interviewId: string;
  roomName: string;
  participant: {
    userId?: number;
    name: string;
    email: string;
    /** Panelists/hosts are moderators; candidates are not. */
    moderator: boolean;
  };
}

export interface MeetingProvider {
  key: MeetingProviderKey;
  /** Whether joining happens inside our app (true) or the vendor's (false). */
  embeddable: boolean;
  /** Cheap check that this provider has the credentials/config it needs. */
  isConfigured(orgId: number): Promise<boolean>;
  /** Provision a meeting for the interview. */
  createMeeting(ctx: MeetingContext): Promise<CreatedMeeting>;
  /** Mint join credentials for an embedded room. Undefined on external providers. */
  issueRoomToken?(ctx: IssueTokenContext): Promise<RoomToken>;
}
