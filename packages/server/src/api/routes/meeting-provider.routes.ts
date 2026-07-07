// ============================================================================
// MEETING PROVIDER ROUTES (Phase 2)
// Manage per-org connections to external meeting providers (Google Meet, Teams,
// Zoom): save app credentials, run the OAuth connect flow, check status.
// Mounted at /api/v1/meeting-providers.
// ============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { sendSuccess } from "../../utils/response";
import { ValidationError } from "../../utils/errors";
import { config } from "../../config";
import {
  listConnections,
  upsertCredentials,
  buildAuthorizeUrl,
  handleOAuthCallback,
  verifyState,
  disconnect,
  type ExternalProviderKey,
} from "../../services/interview/providers/credentials.service";

const router = Router();

const EXTERNAL: ExternalProviderKey[] = ["google_meet", "teams", "zoom"];
function assertProvider(p: string): ExternalProviderKey {
  if (!EXTERNAL.includes(p as ExternalProviderKey)) {
    throw new ValidationError(`Unknown external provider: ${p}`);
  }
  return p as ExternalProviderKey;
}

// GET / — connection status for all external providers
router.get(
  "/",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin", "hr_manager"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connections = await listConnections(req.user!.empcloudOrgId);
      return sendSuccess(res, { connections });
    } catch (err) {
      next(err);
    }
  },
);

// POST /:provider/credentials — save app credentials (client id/secret, etc.)
router.post(
  "/:provider/credentials",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = assertProvider(String(req.params.provider));
      const { client_id, client_secret, account_id, tenant_id, organizer_email } = req.body ?? {};
      if (!client_id || !client_secret) {
        throw new ValidationError("client_id and client_secret are required");
      }
      // Zoom S2S needs no browser consent — mark connected once account creds exist.
      const status = provider === "zoom" && account_id ? "connected" : "pending";
      const saved = await upsertCredentials(
        req.user!.empcloudOrgId,
        provider,
        { client_id, client_secret, account_id, tenant_id, organizer_email, status },
        req.user!.empcloudUserId,
      );
      // Never echo secrets back.
      return sendSuccess(res, { provider, status: saved.status });
    } catch (err) {
      next(err);
    }
  },
);

// GET /:provider/authorize-url — OAuth authorize URL for Google/Teams
router.get(
  "/:provider/authorize-url",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = assertProvider(String(req.params.provider));
      const url = await buildAuthorizeUrl(req.user!.empcloudOrgId, provider);
      return sendSuccess(res, { url });
    } catch (err) {
      next(err);
    }
  },
);

// GET /:provider/callback — OAuth redirect target (NO auth; trusts signed state)
router.get("/:provider/callback", async (req: Request, res: Response) => {
  const settings = `${config.clientUrl}/settings`;
  try {
    const provider = assertProvider(String(req.params.provider));
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (req.query.error) {
      return res.redirect(`${settings}?meeting_error=${encodeURIComponent(String(req.query.error))}`);
    }
    if (!code || !state) throw new ValidationError("Missing code or state");

    const decoded = verifyState(state);
    if (decoded.provider !== provider) throw new ValidationError("State/provider mismatch");

    await handleOAuthCallback(decoded.orgId, provider, code);
    return res.redirect(`${settings}?meeting_connected=${provider}`);
  } catch (err: any) {
    const msg = err?.message || "Connection failed";
    return res.redirect(`${settings}?meeting_error=${encodeURIComponent(msg)}`);
  }
});

// DELETE /:provider — disconnect
router.delete(
  "/:provider",
  authenticate,
  authorize("super_admin", "org_admin", "hr_admin"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provider = assertProvider(String(req.params.provider));
      await disconnect(req.user!.empcloudOrgId, provider);
      return sendSuccess(res, { provider, status: "not_configured" });
    } catch (err) {
      next(err);
    }
  },
);

export { router as meetingProviderRoutes };
