import { Suspense, useEffect, useState } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { Routes, Route, Navigate, useSearchParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { isLoggedIn, useAuthStore, extractSSOToken } from "@/lib/auth-store";
import { apiPost } from "@/api/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Layouts (eagerly loaded)
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { RequireRole } from "@/components/RequireRole";
import { ADMIN_ROLES } from "@/lib/roles";

// Route config imports
import { jobRoutes } from "./routes/jobs.routes";
import { candidateRoutes } from "./routes/candidates.routes";
import { interviewRoutes } from "./routes/interviews.routes";
import { offerRoutes } from "./routes/offers.routes";
import { onboardingRoutes } from "./routes/onboarding.routes";
import { portalRoutes } from "./routes/portal.routes";
import { careerRoutes } from "./routes/careers.routes";

// Lazy-loaded pages (kept in App for single-route modules)
const LoginPage = lazyWithRetry(() =>
  import("@/pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const DashboardPage = lazyWithRetry(() =>
  import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ReferralListPage = lazyWithRetry(() =>
  import("@/pages/referrals/ReferralListPage").then((m) => ({ default: m.ReferralListPage })),
);
const AnalyticsPage = lazyWithRetry(() =>
  import("@/pages/analytics/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
const SettingsPage = lazyWithRetry(() =>
  import("@/pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const ScoreReportPage = lazyWithRetry(() =>
  import("@/pages/scoring/ScoreReportPage").then((m) => ({ default: m.ScoreReportPage })),
);
const ScoringPage = lazyWithRetry(() =>
  import("@/pages/scoring/ScoringPage").then((m) => ({ default: m.ScoringPage })),
);
const InternalJobsPage = lazyWithRetry(() =>
  import("@/pages/internal-jobs/InternalJobsPage").then((m) => ({ default: m.InternalJobsPage })),
);

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
    </div>
  );
}

function AuthRedirect() {
  return isLoggedIn() ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />;
}

function SSOGate({ children }: { children: React.ReactNode }) {
  const login = useAuthStore((s) => s.login);
  const [ssoToken] = useState(() => extractSSOToken());
  const [ready, setReady] = useState(!ssoToken); // ready immediately if no SSO token
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ssoToken) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiPost<{
          user: any;
          tokens: { accessToken: string; refreshToken: string };
        }>("/auth/sso", { token: ssoToken });

        if (cancelled) return;

        const { user, tokens } = res.data!;
        login(user, tokens);

        // Redirect to dashboard after SSO login
        if (window.location.pathname === "/" || window.location.pathname === "/login") {
          window.location.replace("/dashboard");
          return; // Page is redirecting, don't setReady
        }
        setReady(true);
      } catch (err: any) {
        if (cancelled) return;
        console.error("SSO exchange failed:", err);
        setError("SSO login failed. Please try logging in manually.");
        setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [ssoToken, login]);

  if (!ready) return <PageLoader />;
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/login" className="text-brand-600 underline">Go to login</a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <SSOGate>
    <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public auth */}
        <Route path="/login" element={<LoginPage />} />

        {/* Root redirect */}
        <Route path="/" element={<AuthRedirect />} />

        {/* Protected routes inside DashboardLayout */}
        <Route element={<DashboardLayout />}>
          {/* Available to every signed-in user, including employees */}
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Internal Job Board (employee self-service) */}
          <Route path="/internal-jobs" element={<InternalJobsPage />} />
          {/* Referrals */}
          <Route path="/referrals" element={<ReferralListPage />} />

          {/* Staff-only workspace — employees are redirected to /dashboard.
              Mirrors the server's authorize() role checks so admin pages can't
              be reached by URL. */}
          <Route element={<RequireRole roles={ADMIN_ROLES} />}>
            {jobRoutes}
            {candidateRoutes}
            {interviewRoutes}
            {offerRoutes}
            {onboardingRoutes}

            {/* Scoring / AI Resume */}
            <Route path="/scoring" element={<ScoringPage />} />
            <Route path="/scoring/:appId" element={<ScoreReportPage />} />

            {/* Analytics */}
            <Route path="/analytics" element={<AnalyticsPage />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        {/* Candidate Portal (no employee auth — uses portal tokens) */}
        <Route path="/portal" element={<PortalLayout />}>
          {portalRoutes}
        </Route>

        {/* Public career pages (no auth) */}
        <Route path="/careers/:slug" element={<PublicLayout />}>
          {careerRoutes}
        </Route>

        {/* 404 */}
        <Route path="*" element={<div className="p-8"><h1 className="text-2xl font-bold text-gray-900">Page Not Found</h1></div>} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
    </SSOGate>
  );
}
