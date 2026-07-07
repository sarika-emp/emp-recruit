// ============================================================================
// GOOGLE MEET PROVIDER (external)
// ============================================================================
// Creates a Google Calendar event with a Meet conference attached and returns
// its hangoutLink. Requires the org to have connected Google (OAuth) — see
// credentials.service. Not embeddable; opens in Google Meet.
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import type { CreatedMeeting, MeetingContext, MeetingProvider } from "./types";
import { getValidAccessToken, isConnected } from "./credentials.service";
import { postJson } from "./http";

const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1";

export const googleMeetProvider: MeetingProvider = {
  key: "google_meet",
  embeddable: false,

  isConfigured(orgId: number): Promise<boolean> {
    return isConnected(orgId, "google_meet");
  },

  async createMeeting(ctx: MeetingContext): Promise<CreatedMeeting> {
    const token = await getValidAccessToken(ctx.orgId, "google_meet");
    const end = new Date(ctx.scheduledAt.getTime() + ctx.durationMinutes * 60_000);

    const event = await postJson(CALENDAR_EVENTS_URL, token, {
      summary: ctx.title,
      start: { dateTime: ctx.scheduledAt.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: ctx.participants.filter((p) => p.email).map((p) => ({ email: p.email })),
      conferenceData: {
        createRequest: {
          requestId: uuidv4(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    });

    const joinUrl =
      event.hangoutLink ||
      event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri;
    if (!joinUrl) {
      throw new Error("Google did not return a Meet link for the event");
    }

    return {
      provider: "google_meet",
      joinUrl,
      externalId: event.id,
      hostUrl: event.htmlLink,
      embeddable: false,
    };
  },
};
