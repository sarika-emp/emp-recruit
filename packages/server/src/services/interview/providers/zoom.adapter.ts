// ============================================================================
// ZOOM PROVIDER (external)
// ============================================================================
// Creates a scheduled Zoom meeting via the Zoom API using a Server-to-Server
// OAuth token (account credentials grant). Requires the org to have saved Zoom
// account credentials. Not embeddable; opens in Zoom.
// ============================================================================

import type { CreatedMeeting, MeetingContext, MeetingProvider } from "./types";
import { getValidAccessToken, isConnected } from "./credentials.service";
import { postJson } from "./http";

const ZOOM_CREATE_MEETING = "https://api.zoom.us/v2/users/me/meetings";

export const zoomProvider: MeetingProvider = {
  key: "zoom",
  embeddable: false,

  isConfigured(orgId: number): Promise<boolean> {
    return isConnected(orgId, "zoom");
  },

  async createMeeting(ctx: MeetingContext): Promise<CreatedMeeting> {
    const token = await getValidAccessToken(ctx.orgId, "zoom");

    const meeting = await postJson(ZOOM_CREATE_MEETING, token, {
      topic: ctx.title,
      type: 2, // scheduled
      start_time: ctx.scheduledAt.toISOString(),
      duration: ctx.durationMinutes,
      timezone: "UTC",
      settings: { join_before_host: true, waiting_room: false },
    });

    if (!meeting.join_url) {
      throw new Error("Zoom did not return a join URL");
    }

    return {
      provider: "zoom",
      joinUrl: meeting.join_url,
      externalId: String(meeting.id),
      hostUrl: meeting.start_url,
      embeddable: false,
      passcode: meeting.password,
    };
  },
};
