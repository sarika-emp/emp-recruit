import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Briefcase,
  Users,
  FileText,
  TrendingUp,
  ChevronRight,
  Calendar,
  ArrowUpRight,
  Gift,
  CheckCircle2,
  Clock,
  Award,
} from "lucide-react";
import { apiGet } from "@/api/client";
import { getUser } from "@/lib/auth-store";
import type { JobPosting, Candidate, PaginatedResponse } from "@emp-recruit/shared";
import { cn, formatDate } from "@/lib/utils";

// Staff roles that get the recruiting overview. A plain `employee` cannot hit
// the admin APIs (jobs/candidates/applications all 403), so they get a
// referral-focused dashboard instead of admin stat tiles that always read 0.
const ADMIN_ROLES = ["super_admin", "org_admin", "hr_admin", "hr_manager"];

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  applied: { label: "Applied", color: "from-blue-400 to-blue-500" },
  screened: { label: "Screened", color: "from-indigo-400 to-indigo-500" },
  interview: { label: "Interview", color: "from-purple-400 to-purple-500" },
  offer: { label: "Offer", color: "from-amber-400 to-amber-500" },
  hired: { label: "Hired", color: "from-green-400 to-green-500" },
  rejected: { label: "Rejected", color: "from-red-400 to-red-500" },
};

const STAGE_BADGE: Record<string, string> = {
  applied: "bg-blue-100 text-blue-700",
  screened: "bg-indigo-100 text-indigo-700",
  interview: "bg-purple-100 text-purple-700",
  offer: "bg-amber-100 text-amber-700",
  hired: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  withdrawn: "bg-gray-100 text-gray-700",
};

export function DashboardPage() {
  const role = (getUser()?.role as string) || "employee";
  return ADMIN_ROLES.includes(role) ? <AdminDashboard /> : <EmployeeDashboard />;
}

// ---------------------------------------------------------------------------
// Admin / HR dashboard — recruiting overview
// ---------------------------------------------------------------------------
function AdminDashboard() {
  // Fetch open jobs count
  const { data: jobsData } = useQuery({
    queryKey: ["dashboard-jobs"],
    queryFn: () => apiGet<PaginatedResponse<JobPosting>>("/jobs", { status: "open", perPage: 1 }),
  });

  // Fetch all jobs for total count
  const { data: allJobsData } = useQuery({
    queryKey: ["dashboard-all-jobs"],
    queryFn: () => apiGet<PaginatedResponse<JobPosting>>("/jobs", { perPage: 1 }),
  });

  // Fetch candidates count
  const { data: candidatesData } = useQuery({
    queryKey: ["dashboard-candidates"],
    queryFn: () => apiGet<PaginatedResponse<Candidate>>("/candidates", { perPage: 1 }),
  });

  // Fetch recent applications
  const { data: appsData } = useQuery({
    queryKey: ["dashboard-applications"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { perPage: 10, sort: "applied_at", order: "desc" }),
  });

  // Fetch application stage distribution via multiple stage queries
  const { data: appliedData } = useQuery({
    queryKey: ["dashboard-stage-applied"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "applied", perPage: 1 }),
  });
  const { data: screenedData } = useQuery({
    queryKey: ["dashboard-stage-screened"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "screened", perPage: 1 }),
  });
  const { data: interviewData } = useQuery({
    queryKey: ["dashboard-stage-interview"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "interview", perPage: 1 }),
  });
  const { data: offerData } = useQuery({
    queryKey: ["dashboard-stage-offer"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "offer", perPage: 1 }),
  });
  const { data: hiredData } = useQuery({
    queryKey: ["dashboard-stage-hired"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "hired", perPage: 1 }),
  });
  const { data: rejectedData } = useQuery({
    queryKey: ["dashboard-stage-rejected"],
    queryFn: () => apiGet<PaginatedResponse<any>>("/applications", { stage: "rejected", perPage: 1 }),
  });

  const openJobsCount = jobsData?.data?.total ?? 0;
  const totalJobs = allJobsData?.data?.total ?? 0;
  const totalCandidates = candidatesData?.data?.total ?? 0;
  const totalApplications = appsData?.data?.total ?? 0;
  const recentApps = appsData?.data?.data ?? [];

  const stageDistribution: Record<string, number> = {
    applied: appliedData?.data?.total ?? 0,
    screened: screenedData?.data?.total ?? 0,
    interview: interviewData?.data?.total ?? 0,
    offer: offerData?.data?.total ?? 0,
    hired: hiredData?.data?.total ?? 0,
    rejected: rejectedData?.data?.total ?? 0,
  };

  const maxStageCount = Math.max(...Object.values(stageDistribution), 1);

  const statCards = [
    {
      label: "Open Jobs",
      value: openJobsCount,
      icon: Briefcase,
      color: "bg-brand-50 text-brand-600",
      link: "/jobs?status=open",
    },
    {
      label: "Total Candidates",
      value: totalCandidates,
      icon: Users,
      color: "bg-purple-50 text-purple-600",
      link: "/candidates",
    },
    {
      label: "Total Applications",
      value: totalApplications,
      icon: FileText,
      color: "bg-blue-50 text-blue-600",
      // #10 — was `/jobs`, which dropped the user on the Job Posting tab.
      // Applications are browsed through candidates until a dedicated
      // /applications list page ships.
      link: "/candidates",
    },
    {
      label: "Total Jobs",
      value: totalJobs,
      icon: TrendingUp,
      color: "bg-green-50 text-green-600",
      link: "/jobs",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Recruitment overview and pipeline metrics.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            to={stat.link}
            className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className={cn("rounded-xl p-3", stat.color)}>
                <stat.icon className="h-5 w-5" />
              </div>
              <ArrowUpRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-brand-500" />
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-gray-900">{stat.value}</p>
            <p className="mt-0.5 text-sm font-medium text-gray-500">{stat.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pipeline Stage Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Pipeline Distribution</h2>
            <span className="text-xs font-medium text-gray-400">
              {Object.values(stageDistribution).reduce((a, b) => a + b, 0)} total
            </span>
          </div>
          <div className="space-y-4">
            {Object.entries(STAGE_LABELS).map(([key, { label, color }]) => {
              const count = stageDistribution[key] ?? 0;
              const percentage = maxStageCount > 0 ? (count / maxStageCount) * 100 : 0;
              return (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{label}</span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={cn(
                        "h-full rounded-full bg-gradient-to-r transition-all duration-500",
                        color,
                      )}
                      style={{ width: `${count > 0 ? Math.max(percentage, 3) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Applications */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Applications</h2>
            {/* #11 — was `/jobs`; Candidates is the closest list view for
                applications until a dedicated `/applications` page exists. */}
            <Link
              to="/candidates"
              className="text-sm text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
            >
              View all <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          {recentApps.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No applications yet.</p>
          ) : (
            <div className="space-y-3">
              {/* #28 — each row now links to the candidate's detail page.
                  Falls back to the job detail if candidate_id is somehow
                  missing on legacy rows. */}
              {recentApps.map((app: any) => (
                <Link
                  key={app.id}
                  to={app.candidate_id ? `/candidates/${app.candidate_id}` : `/jobs/${app.job_id}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 p-3 transition-colors hover:border-brand-200 hover:bg-gray-50"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                      {`${app.candidate_first_name?.[0] ?? ""}${app.candidate_last_name?.[0] ?? ""}`.toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {app.candidate_first_name} {app.candidate_last_name}
                      </p>
                      <p className="truncate text-xs text-gray-500">{app.job_title}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                        STAGE_BADGE[app.stage] ?? "bg-gray-100 text-gray-700",
                      )}
                    >
                      {app.stage}
                    </span>
                    <span className="text-xs text-gray-400 inline-flex items-center gap-1 whitespace-nowrap">
                      <Calendar className="h-3 w-3" />
                      {formatDate(app.applied_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee dashboard — referral-focused, no admin APIs
// ---------------------------------------------------------------------------
interface ReferralRow {
  id: string;
  status: string;
  candidate_name: string;
  job_title: string;
  created_at: string;
  bonus_amount: number | null;
}

const REF_STATUS_BADGE: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  hired: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  bonus_eligible: "bg-purple-100 text-purple-700",
  bonus_paid: "bg-emerald-100 text-emerald-700",
};

function EmployeeDashboard() {
  const user = getUser();
  const firstName = user?.firstName || "there";

  const { data: refData, isLoading } = useQuery({
    queryKey: ["my-referrals"],
    queryFn: async () => {
      const res = await apiGet<any>("/referrals");
      return res.data;
    },
  });

  const referrals: ReferralRow[] = refData?.data ?? [];
  const total = referrals.length;
  const inReview = referrals.filter((r) => ["submitted", "under_review"].includes(r.status)).length;
  const hired = referrals.filter((r) => r.status === "hired").length;
  const rewarded = referrals.filter((r) => ["bonus_eligible", "bonus_paid"].includes(r.status)).length;

  const stats = [
    { label: "My Referrals", value: total, icon: Gift, color: "bg-brand-50 text-brand-600" },
    { label: "In Review", value: inReview, icon: Clock, color: "bg-yellow-50 text-yellow-600" },
    { label: "Hired", value: hired, icon: CheckCircle2, color: "bg-green-50 text-green-600" },
    { label: "Bonus", value: rewarded, icon: Award, color: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome, {firstName}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse internal openings and refer great people to your team.
        </p>
      </div>

      {/* Referral stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className={cn("inline-flex rounded-xl p-3", stat.color)}>
              <stat.icon className="h-5 w-5" />
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-gray-900">{stat.value}</p>
            <p className="mt-0.5 text-sm font-medium text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/internal-jobs"
          className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand-50 p-3 text-brand-600">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Browse Internal Jobs</p>
              <p className="text-xs text-gray-500">See openings for employees</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-brand-500" />
        </Link>
        <Link
          to="/referrals"
          className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-50 p-3 text-purple-600">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">Refer Someone</p>
              <p className="text-xs text-gray-500">Recommend a candidate</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-brand-500" />
        </Link>
      </div>

      {/* My recent referrals */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">My Referrals</h2>
          <Link
            to="/referrals"
            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
          >
            View all <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : referrals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Gift className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              You haven't referred anyone yet.{" "}
              <Link to="/referrals" className="font-medium text-brand-600 hover:text-brand-700">
                Refer someone
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {referrals.slice(0, 5).map((ref) => (
              <div
                key={ref.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{ref.candidate_name}</p>
                  <p className="truncate text-xs text-gray-500">{ref.job_title}</p>
                </div>
                <div className="ml-4 flex items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                      REF_STATUS_BADGE[ref.status] ?? "bg-gray-100 text-gray-700",
                    )}
                  >
                    {ref.status.replace(/_/g, " ")}
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-gray-400">
                    <Calendar className="h-3 w-3" />
                    {formatDate(ref.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
