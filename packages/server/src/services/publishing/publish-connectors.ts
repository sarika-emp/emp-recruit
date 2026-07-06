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
    key: "indeed",
    label: "Indeed",
    mechanism: "xml_feed",
    requirements:
      "Indeed crawls an Indeed-format XML feed (free organic listings; sponsored optional). " +
      "Publish generates the feed entry once the feed URL is set up. Not yet connected.",
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
          detail: `${spec.label} is not connected. ${spec.requirements}`,
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

export const PUBLISH_CONNECTORS: PublishConnector[] = BOARDS.map(makeStubConnector);

export function getPublishConnector(board: string): PublishConnector | undefined {
  return PUBLISH_CONNECTORS.find((c) => c.key === board);
}
