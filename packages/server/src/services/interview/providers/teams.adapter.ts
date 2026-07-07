// ============================================================================
// MICROSOFT TEAMS PROVIDER (external)
// ============================================================================
// Creates a Teams online meeting via Microsoft Graph and returns its joinWebUrl.
// Uses a delegated token (the connected user hosts). Requires the org to have
// connected Microsoft (OAuth). Not embeddable; opens in Teams.
// ============================================================================

import type { CreatedMeeting, MeetingContext, MeetingProvider } from "./types";
import { getValidAccessToken, isConnected } from "./credentials.service";
import { postJson } from "./http";

const GRAPH_ONLINE_MEETINGS = "https://graph.microsoft.com/v1.0/me/onlineMeetings";

export const teamsProvider: MeetingProvider = {
  key: "teams",
  embeddable: false,

  isConfigured(orgId: number): Promise<boolean> {
    return isConnected(orgId, "teams");
  },

  async createMeeting(ctx: MeetingContext): Promise<CreatedMeeting> {
    const token = await getValidAccessToken(ctx.orgId, "teams");
    const end = new Date(ctx.scheduledAt.getTime() + ctx.durationMinutes * 60_000);

    const meeting = await postJson(GRAPH_ONLINE_MEETINGS, token, {
      subject: ctx.title,
      startDateTime: ctx.scheduledAt.toISOString(),
      endDateTime: end.toISOString(),
    });

    if (!meeting.joinWebUrl) {
      throw new Error("Teams did not return a join URL");
    }

    return {
      provider: "teams",
      joinUrl: meeting.joinWebUrl,
      externalId: meeting.id,
      embeddable: false,
    };
  },
};
