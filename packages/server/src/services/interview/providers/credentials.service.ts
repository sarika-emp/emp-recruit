// ============================================================================
// EXTERNAL MEETING PROVIDER CREDENTIALS + OAUTH
// ============================================================================
// Per-org credentials/tokens for Google Meet, Teams, Zoom, plus the OAuth
// helpers the connect flow and adapters use:
//   - Google Meet / Teams: authorization-code OAuth2 (+ refresh)
//   - Zoom: Server-to-Server OAuth (account credentials grant)
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import { getDB } from "../../../db/adapters";
import { config } from "../../../config";
import { logger } from "../../../utils/logger";
import { NotFoundError, ValidationError, AppError } from "../../../utils/errors";

export type ExternalProviderKey = "google_meet" | "teams" | "zoom";

export interface ProviderCredentials {
  id: string;
  organization_id: number;
  provider: ExternalProviderKey;
  client_id: string | null;
  client_secret: string | null;
  account_id: string | null;
  tenant_id: string | null;
  organizer_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | Date | null;
  status: "pending" | "connected" | "error";
  last_error: string | null;
  connected_by: number | null;
}

const TABLE = "meeting_provider_credentials";

// --- OAuth metadata --------------------------------------------------------

function redirectUri(provider: ExternalProviderKey): string {
  return `${config.publicUrl}/api/v1/meeting-providers/${provider}/callback`;
}

function teamsBase(creds: ProviderCredentials): string {
  const tenant = creds.tenant_id || "organizations";
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events";
const TEAMS_SCOPES = "offline_access https://graph.microsoft.com/OnlineMeetings.ReadWrite";

// --- CRUD ------------------------------------------------------------------

export async function getCredentials(
  orgId: number,
  provider: ExternalProviderKey,
): Promise<ProviderCredentials | null> {
  const db = getDB();
  return db.findOne<ProviderCredentials>(TABLE, { organization_id: orgId, provider });
}

export async function upsertCredentials(
  orgId: number,
  provider: ExternalProviderKey,
  patch: Partial<ProviderCredentials>,
  userId?: number,
): Promise<ProviderCredentials> {
  const db = getDB();
  const existing = await getCredentials(orgId, provider);
  if (existing) {
    await db.update(TABLE, existing.id, { ...patch });
  } else {
    await db.create(TABLE, {
      id: uuidv4(),
      organization_id: orgId,
      provider,
      connected_by: userId ?? null,
      ...patch,
    });
  }
  return (await getCredentials(orgId, provider))!;
}

export async function listConnections(
  orgId: number,
): Promise<{ provider: ExternalProviderKey; status: string; connected: boolean }[]> {
  const providers: ExternalProviderKey[] = ["google_meet", "teams", "zoom"];
  const out = [];
  for (const provider of providers) {
    const creds = await getCredentials(orgId, provider);
    out.push({
      provider,
      status: creds?.status ?? "not_configured",
      connected: creds?.status === "connected",
    });
  }
  return out;
}

export async function disconnect(orgId: number, provider: ExternalProviderKey): Promise<void> {
  const db = getDB();
  const creds = await getCredentials(orgId, provider);
  if (creds) await db.delete(TABLE, creds.id);
}

/** True if the provider is usable for this org (app creds present + authorized). */
export async function isConnected(orgId: number, provider: ExternalProviderKey): Promise<boolean> {
  const creds = await getCredentials(orgId, provider);
  if (!creds) return false;
  if (provider === "zoom") {
    return !!(creds.account_id && creds.client_id && creds.client_secret);
  }
  return creds.status === "connected" && !!creds.refresh_token;
}

// --- Connect flow (Google / Teams) -----------------------------------------

/** Signed, short-lived state param so the callback can trust orgId. */
function signState(orgId: number, provider: ExternalProviderKey): string {
  return jwt.sign({ orgId, provider, t: "meeting_oauth" }, config.jwt.secret, { expiresIn: "10m" });
}

export function verifyState(state: string): { orgId: number; provider: ExternalProviderKey } {
  try {
    const d = jwt.verify(state, config.jwt.secret) as any;
    if (d.t !== "meeting_oauth") throw new Error("bad state");
    return { orgId: Number(d.orgId), provider: d.provider };
  } catch {
    throw new ValidationError("Invalid or expired OAuth state");
  }
}

export async function buildAuthorizeUrl(
  orgId: number,
  provider: ExternalProviderKey,
): Promise<string> {
  if (provider === "zoom") {
    throw new ValidationError("Zoom uses Server-to-Server OAuth — save account credentials instead");
  }
  const creds = await getCredentials(orgId, provider);
  if (!creds?.client_id) {
    throw new ValidationError(`Save ${provider} app credentials (client id/secret) before connecting`);
  }
  const state = signState(orgId, provider);
  const params = new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    state,
  });
  if (provider === "google_meet") {
    params.set("scope", GOOGLE_SCOPES);
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  // teams
  params.set("scope", TEAMS_SCOPES);
  params.set("response_mode", "query");
  return `${teamsBase(creds)}/authorize?${params.toString()}`;
}

async function postForm(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError(502, "OAUTH_ERROR", json.error_description || json.error || `Token request failed (${res.status})`);
  }
  return json;
}

/** Exchange the callback code for tokens and mark the provider connected. */
export async function handleOAuthCallback(
  orgId: number,
  provider: ExternalProviderKey,
  code: string,
): Promise<void> {
  const creds = await getCredentials(orgId, provider);
  if (!creds?.client_id || !creds.client_secret) {
    throw new NotFoundError("Provider credentials", provider);
  }
  const tokenUrl =
    provider === "google_meet" ? "https://oauth2.googleapis.com/token" : `${teamsBase(creds)}/token`;

  const body: Record<string, string> = {
    code,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: redirectUri(provider),
    grant_type: "authorization_code",
  };
  if (provider === "teams") body.scope = TEAMS_SCOPES;

  const tok = await postForm(tokenUrl, body);
  await upsertCredentials(orgId, provider, {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? creds.refresh_token,
    token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
    status: "connected",
    last_error: null,
  });
  logger.info(`Meeting provider connected: org ${orgId} -> ${provider}`);
}

// --- Access tokens for adapters --------------------------------------------

/** Return a valid access token, refreshing / fetching as needed. */
export async function getValidAccessToken(
  orgId: number,
  provider: ExternalProviderKey,
): Promise<string> {
  const creds = await getCredentials(orgId, provider);
  if (!creds) throw new ValidationError(`${provider} is not connected for this organization`);

  if (provider === "zoom") {
    if (!creds.account_id || !creds.client_id || !creds.client_secret) {
      throw new ValidationError("Zoom account credentials are incomplete");
    }
    const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64");
    const tok = await postForm(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(creds.account_id)}`,
      {},
      { Authorization: `Basic ${basic}` },
    );
    return tok.access_token;
  }

  // Google / Teams — reuse a still-valid access token, else refresh.
  const exp = creds.token_expires_at ? new Date(creds.token_expires_at).getTime() : 0;
  if (creds.access_token && exp > Date.now() + 60_000) {
    return creds.access_token;
  }
  if (!creds.refresh_token) {
    throw new ValidationError(`${provider} needs to be reconnected (no refresh token)`);
  }
  const tokenUrl =
    provider === "google_meet" ? "https://oauth2.googleapis.com/token" : `${teamsBase(creds)}/token`;
  const body: Record<string, string> = {
    client_id: creds.client_id!,
    client_secret: creds.client_secret!,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  };
  if (provider === "teams") body.scope = TEAMS_SCOPES;

  const tok = await postForm(tokenUrl, body);
  await upsertCredentials(orgId, provider, {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? creds.refresh_token,
    token_expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
  });
  return tok.access_token;
}
