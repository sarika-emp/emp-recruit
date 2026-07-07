// ============================================================================
// JOB-BOARD PUBLISH CONNECTORS  —  scaffold (stubbed)
// ----------------------------------------------------------------------------
// The outbound counterpart to the candidate-source connectors: publish a job
// posting OUT to an external board. Publishing to Naukri / LinkedIn / Apna /
// Indeed is credentialed and ToS-restricted — there is no universal "post
// everywhere" API — so every connector here is a STUB. A stub records the
// operator's intent (a job_publications row) but never actually posts; it
// reports what real setup each board needs. This keeps the framework honest:
// it never claims a job was published to a board it cannot reach.
//
// To make a board go live later, replace its `publish()` body with the board's
// real feed generation (Indeed/LinkedIn crawl an XML feed) or employer API call
// (Naukri/Apna), gated on board_publish_settings.credentials_configured.
// ============================================================================

export type BoardKey = "naukri" | "linkedin" | "apna" | "indeed" | "feed";

/** How a board legally accepts a posting — drives the UI's setup guidance. */
export type PublishMechanism = "employer_api" | "xml_feed";

export interface PublishInput {
  jobId: string;
  title: string;
  description: string | null;
  location: string | null;
  employmentType: string | null;
}

export interface PublishOutcome {
  // A stub can never reach "published"; it returns "pending" (queued for the
  // operator to complete the real integration) with a clear reason.
  status: "pending" | "published" | "failed";
  externalRef?: string | null;
  externalUrl?: string | null;
  detail: string;
}

export interface PublishConnector {
  key: BoardKey;
  label: string;
  mechanism: PublishMechanism;
  /** One-line description of what real publishing to this board requires. */
  requirements: string;
  /** True only when this org has wired real credentials/feed for the board. */
  isConfigured(configured: boolean): boolean;
  /** Publish a job. Stubs never post — they return "pending" + guidance. */
  publish(input: PublishInput, configured: boolean): Promise<PublishOutcome>;
  /** Remove a live posting. Stubs are a no-op. */
  unpublish(externalRef: string | null, configured: boolean): Promise<{ ok: boolean; detail: string }>;
}

interface BoardSpec {
  key: BoardKey;
  label: string;
  mechanism: PublishMechanism;
  requirements: string;
}

// Stubbed boards (still credential-gated / not implemented). Indeed is NOT here
// — it has a real connector below.
const BOARDS: BoardSpec[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    mechanism: "xml_feed",
    requirements:
      "LinkedIn crawls an XML job feed (free basic listing) or via the Job Posting API " +
      "with a LinkedIn Talent partner agreement. Not yet connected.",
  },
  {
    key: "naukri",
    label: "Naukri",
    mechanism: "employer_api",
    requirements:
      "Requires a Naukri employer/RMS subscription + employer API key. Not yet connected.",
  },
  {
    key: "apna",
    label: "Apna",
    mechanism: "employer_api",
    requirements: "Requires an Apna enterprise account + employer API access. Not yet connected.",
  },
];

// --- LIVE: Indeed --- publishes by adding the job to a public XML feed Indeed
// crawls (no paid account / API key for organic listings). "publish" marks the
// job present in the feed; the service attaches the org's feed URL + ensures the
// feed token. "unpublish" removes it from the feed (delists on the next crawl).
const indeedConnector: PublishConnector = {
  key: "indeed",
  label: "Indeed",
  mechanism: "xml_feed",
  requirements:
    "Live. Indeed crawls this org's public XML job feed (free organic listings). " +
    "Submit the feed URL below to Indeed once, then published jobs appear automatically.",

  // Indeed's organic feed needs no credentials — it's always capable.
  isConfigured(): boolean {
    return true;
  },

  async publish(): Promise<PublishOutcome> {
    // The job is added to the feed by marking status='published'; the feed URL
    // is attached by the service (which has org context). Indeed picks it up on
    // its next crawl.
    return {
      status: "published",
      externalRef: null, // set by the service to the feed URL
      externalUrl: null,
      detail: "Added to your Indeed XML feed. Indeed lists it on its next crawl.",
    };
  },

  async unpublish(): Promise<{ ok: boolean; detail: string }> {
    // Removing the publication row (status='removed') drops it from the feed;
    // Indeed delists it on the next crawl.
    return { ok: true, detail: "Removed from your Indeed feed. Indeed delists it on its next crawl." };
  },
};

function makeStubConnector(spec: BoardSpec): PublishConnector {
  return {
    key: spec.key,
    label: spec.label,
    mechanism: spec.mechanism,
    requirements: spec.requirements,

    isConfigured(configured: boolean): boolean {
      return configured;
    },

    async publish(_input: PublishInput, configured: boolean): Promise<PublishOutcome> {
      // STUB: no network call, no post. Record intent as pending with the exact
      // reason. When credentials/feed are wired, this is where the real feed
      // entry / employer-API call goes — gated on `configured`.
      if (!configured) {
        return {
          status: "pending",
          externalRef: null,
          externalUrl: null,
          // Concise — the board's full setup requirements are shown separately
          // in the UI, so don't repeat them here.
          detail: "Queued — connect this board to publish (see setup requirements).",
        };
      }
      return {
        status: "pending",
        externalRef: null,
        externalUrl: null,
        detail:
          `${spec.label} credentials are marked configured, but live publishing is not ` +
          `implemented in this build. Wire the ${spec.mechanism === "xml_feed" ? "XML feed" : "employer API"} to go live.`,
      };
    },

    async unpublish(): Promise<{ ok: boolean; detail: string }> {
      // STUB: nothing was actually posted, so removal is a local state change.
      return { ok: true, detail: `${spec.label}: marked removed (no live posting existed).` };
    },
  };
}

// Order for the UI: LinkedIn, Indeed (live), Naukri, Apna.
export const PUBLISH_CONNECTORS: PublishConnector[] = [
  makeStubConnector(BOARDS[0]), // linkedin
  indeedConnector, // LIVE
  makeStubConnector(BOARDS[1]), // naukri
  makeStubConnector(BOARDS[2]), // apna
];

export function getPublishConnector(board: string): PublishConnector | undefined {
  return PUBLISH_CONNECTORS.find((c) => c.key === board);
}
