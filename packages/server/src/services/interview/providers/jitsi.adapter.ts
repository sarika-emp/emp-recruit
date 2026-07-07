// ============================================================================
// JITSI MEETING PROVIDER (embedded)
// ============================================================================
// Two modes, chosen by config.meeting.jitsi.mode:
//   - "public"  meet.jit.si, anonymous rooms, no token. Works with zero setup.
//   - "jaas"    8x8.vc (Jitsi-as-a-Service): private, JWT-gated rooms with
//               recording/transcription. Requires JAAS_APP_ID / JAAS_KEY_ID /
//               JAAS_PRIVATE_KEY.
//
// Room names use the full interview UUID (122 bits of entropy) instead of the
// old `interviewId.split("-")[0]` 8-hex-char slug, which was guessable — anyone
// who could enumerate interviews could join the call. See the previous
// generateMeetingLink implementation.
// ============================================================================

import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { config } from "../../../config";
import type {
  CreatedMeeting,
  IssueTokenContext,
  MeetingContext,
  MeetingProvider,
  RoomToken,
} from "./types";

const jitsiCfg = config.meeting.jitsi;

/** Base room name for an interview — full UUID, not a guessable slug. */
function roomFor(interviewId: string): string {
  return `${jitsiCfg.roomPrefix}-${interviewId}`;
}

function isJaas(): boolean {
  return (
    jitsiCfg.mode === "jaas" &&
    !!jitsiCfg.jaas.appId &&
    !!jitsiCfg.jaas.keyId &&
    !!jitsiCfg.jaas.privateKey
  );
}

export const jitsiProvider: MeetingProvider = {
  key: "jitsi",
  embeddable: true,

  async isConfigured(): Promise<boolean> {
    // Public mode always works; JaaS mode needs its credentials.
    return jitsiCfg.mode !== "jaas" || isJaas();
  },

  async createMeeting(ctx: MeetingContext): Promise<CreatedMeeting> {
    const room = roomFor(ctx.interviewId);

    if (isJaas()) {
      // JaaS rooms are namespaced under the app id and require a token to join,
      // so participants must come through our embedded <InterviewRoom> page.
      return {
        provider: "jitsi",
        joinUrl: `${config.clientUrl}/interviews/${ctx.interviewId}/room`,
        externalId: `${jitsiCfg.jaas.appId}/${room}`,
        embeddable: true,
      };
    }

    // Public mode: the meet.jit.si URL is joinable directly (no token), which
    // keeps things working before the embedded client page ships.
    return {
      provider: "jitsi",
      joinUrl: `https://${jitsiCfg.domain}/${room}`,
      externalId: room,
      embeddable: true,
    };
  },

  async issueRoomToken(ctx: IssueTokenContext): Promise<RoomToken> {
    const room = roomFor(ctx.interviewId);

    if (!isJaas()) {
      // Anonymous public room — the SDK joins without a token.
      return {
        token: "",
        roomName: room,
        serverUrl: jitsiCfg.domain,
        domain: jitsiCfg.domain,
        expiresAt: null,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 60 * 60 * 4; // valid for the interview window (4h)
    const expSeconds = now + ttlSeconds;

    const payload = {
      aud: "jitsi",
      iss: "chat",
      sub: jitsiCfg.jaas.appId,
      room: room, // scope the token to this interview's room only
      context: {
        user: {
          id: ctx.participant.userId?.toString() ?? uuidv4(),
          name: ctx.participant.name,
          email: ctx.participant.email,
          moderator: ctx.participant.moderator ? "true" : "false",
          avatar: "",
        },
        features: {
          recording: ctx.participant.moderator ? "true" : "false",
          livestreaming: "false",
          transcription: "true",
          "outbound-call": "false",
        },
      },
    };

    const token = jwt.sign(payload, jitsiCfg.jaas.privateKey, {
      algorithm: "RS256",
      keyid: jitsiCfg.jaas.keyId,
      expiresIn: ttlSeconds,
      notBefore: 0,
    });

    return {
      token,
      roomName: `${jitsiCfg.jaas.appId}/${room}`,
      serverUrl: jitsiCfg.jaas.domain,
      domain: jitsiCfg.jaas.domain,
      expiresAt: new Date(expSeconds * 1000),
    };
  },
};
