import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit,
  MapPin,
  Briefcase,
  Clock,
  DollarSign,
  Users,
  Star,
  Calendar,
  Brain,
  Sparkles,
  BarChart,
  Target,
  X,
  Loader2,
  GitCompareArrows,
  Trash2,
  Globe,
  Send,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/api/client";
import type { JobPosting, PaginatedResponse, ApplicationStage, CandidateScore } from "@emp-recruit/shared";
import { cn, formatDate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import toast from "react-hot-toast";

interface PipelineStage {
  id: string;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  open: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  closed: "bg-red-100 text-red-700",
  filled: "bg-blue-100 text-blue-700",
};

const STAGE_ORDER: ApplicationStage[] = [
  "applied" as any,
  "screened" as any,
  "interview" as any,
  "offer" as any,
  "hired" as any,
  "rejected" as any,
  "withdrawn" as any,
];

const STAGE_COLORS: Record<string, string> = {
  applied: "bg-blue-50 border-blue-200",
  screened: "bg-indigo-50 border-indigo-200",
  interview: "bg-purple-50 border-purple-200",
  offer: "bg-amber-50 border-amber-200",
  hired: "bg-green-50 border-green-200",
  rejected: "bg-red-50 border-red-200",
  withdrawn: "bg-gray-50 border-gray-200",
};

const STAGE_HEADER: Record<string, string> = {
  applied: "bg-blue-100 text-blue-800",
  screened: "bg-indigo-100 text-indigo-800",
  interview: "bg-purple-100 text-purple-800",
  offer: "bg-amber-100 text-amber-800",
  hired: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  withdrawn: "bg-gray-100 text-gray-800",
};

const RECOMMENDATION_BADGE: Record<string, { label: string; className: string }> = {
  strong_match: { label: "Strong Match", className: "bg-green-100 text-green-800" },
  good_match: { label: "Good Match", className: "bg-blue-100 text-blue-800" },
  partial_match: { label: "Partial Match", className: "bg-yellow-100 text-yellow-800" },
  weak_match: { label: "Weak Match", className: "bg-red-100 text-red-800" },
};

interface AppWithCandidate {
  id: string;
  stage: string;
  rating: number | null;
  applied_at: string;
  candidate_first_name: string;
  candidate_last_name: string;
  candidate_email: string;
}

interface RankedCandidate {
  id: string;
  application_id: string;
  candidate_id: string;
  candidate_first_name: string;
  candidate_last_name: string;
  candidate_email: string;
  application_stage: string;
  overall_score: number;
  skills_score: number;
  experience_score: number;
  matched_skills: string;
  missing_skills: string;
  recommendation: string;
}

function ScoreBadge({ score }: { score: number }) {
  const colorClass =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 50
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
        colorClass,
      )}
    >
      <Brain className="h-3 w-3" />
      {score}
    </span>
  );
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showRankings, setShowRankings] = useState(false);
  const [scoringAppId, setScoringAppId] = useState<string | null>(null);
  const [appScores, setAppScores] = useState<Record<string, number>>({});
  const [compareSelection, setCompareSelection] = useState<Set<string>>(new Set());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch custom pipeline stages
  const { data: stagesData } = useQuery({
    queryKey: ["pipeline-stages"],
    queryFn: () => apiGet<PipelineStage[]>("/pipeline/stages"),
  });

  const { data: jobData, isLoading: loadingJob } = useQuery({
    queryKey: ["job", id],
    queryFn: () => apiGet<JobPosting>(`/jobs/${id}`),
    enabled: Boolean(id),
  });

  const { data: appsData, isLoading: loadingApps } = useQuery({
    queryKey: ["job-applications", id],
    queryFn: () =>
      apiGet<PaginatedResponse<AppWithCandidate>>(`/jobs/${id}/applications`, { perPage: 100 }),
    enabled: Boolean(id),
  });

  const { data: rankingsData, isLoading: loadingRankings, refetch: refetchRankings } = useQuery({
    queryKey: ["job-rankings", id],
    queryFn: () => apiGet<RankedCandidate[]>(`/scoring/jobs/${id}/rankings`),
    enabled: Boolean(id) && showRankings,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiPatch<JobPosting>(`/jobs/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Job status updated");
      queryClient.invalidateQueries({ queryKey: ["job", id] });
    },
    onError: () => toast.error("Failed to update status"),
  });

  // Closing a job stops accepting applications and (unlike Pause) is a final
  // state — confirm via a styled dialog before doing it.
  const handleClose = () => setShowCloseConfirm(true);
  const confirmClose = () => {
    statusMutation.mutate("closed", { onSettled: () => setShowCloseConfirm(false) });
  };

  // Deleting permanently removes the job. The server blocks deletion when the
  // job has applications (to preserve candidate history) — surface that message
  // and steer the user to Close instead.
  const deleteMutation = useMutation({
    mutationFn: () => apiDelete(`/jobs/${id}`),
    onSuccess: () => {
      toast.success("Job posting deleted");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate("/jobs");
    },
    onError: (err: any) => {
      setShowDeleteConfirm(false);
      toast.error(
        err?.response?.data?.error?.message ||
          "Could not delete this job. Close it instead if it has applicants.",
      );
    },
  });

  const scoreAppMutation = useMutation({
    mutationFn: (appId: string) => apiPost<any>(`/scoring/applications/${appId}/score`),
    onSuccess: (data, appId) => {
      const score = data?.data?.overallScore;
      if (score !== undefined) {
        setAppScores((prev) => ({ ...prev, [appId]: score }));
      }
      toast.success("Candidate scored successfully");
      queryClient.invalidateQueries({ queryKey: ["job-rankings", id] });
      setScoringAppId(null);
    },
    onError: () => {
      toast.error("Failed to score candidate");
      setScoringAppId(null);
    },
  });

  const batchScoreMutation = useMutation({
    mutationFn: () => apiPost<any>(`/scoring/jobs/${id}/batch-score`),
    onSuccess: (data) => {
      const results = data?.data?.results ?? [];
      const newScores: Record<string, number> = {};
      for (const r of results) {
        newScores[r.applicationId] = r.overallScore;
      }
      setAppScores((prev) => ({ ...prev, ...newScores }));
      toast.success(`Scored ${data?.data?.scored ?? 0} candidates`);
      queryClient.invalidateQueries({ queryKey: ["job-rankings", id] });
    },
    onError: () => toast.error("Failed to batch score candidates"),
  });

  const job = jobData?.data;
  const applications = appsData?.data?.data ?? [];
  const rankings = rankingsData?.data ?? [];
  const customStages = stagesData?.data ?? [];

  // Use custom pipeline stages if available, otherwise fall back to hardcoded
  const activePipelineStages: Array<{ slug: string; name: string; color: string }> = customStages.length > 0
    ? customStages.map((s) => ({ slug: s.slug, name: s.name, color: s.color }))
    : STAGE_ORDER.map((s) => ({ slug: s, name: s, color: "" }));

  // Group applications by stage
  const grouped: Record<string, AppWithCandidate[]> = {};
  for (const stage of activePipelineStages) {
    grouped[stage.slug] = [];
  }
  for (const app of applications) {
    if (grouped[app.stage]) {
      grouped[app.stage].push(app);
    }
  }

  // Compare toggle
  function toggleCompare(appId: string) {
    setCompareSelection((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else if (next.size < 3) {
        next.add(appId);
      } else {
        toast.error("Maximum 3 candidates can be compared");
      }
      return next;
    });
  }

  if (loadingJob) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Job not found.</p>
      </div>
    );
  }

  let skills: string[] = [];
  if (job.skills) {
    if (Array.isArray(job.skills)) {
      skills = job.skills;
    } else if (typeof job.skills === "string") {
      try {
        const parsed = JSON.parse(job.skills);
        skills = Array.isArray(parsed) ? parsed : [job.skills];
      } catch {
        skills = job.skills.split(",").map((s: string) => s.trim()).filter(Boolean);
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate("/jobs")}
            className="mt-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{job.title}</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                  STATUS_BADGE[job.status] ?? "bg-gray-100 text-gray-700",
                )}
              >
                {job.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
              {job.department && (
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="h-4 w-4" /> {job.department}
                </span>
              )}
              {job.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> {job.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1 capitalize">
                <Clock className="h-4 w-4" /> {job.employment_type.replace(/_/g, " ")}
              </span>
              {/* #32 — remote policy chip next to employment type */}
              {(job as any).remote_policy && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">
                  {(job as any).remote_policy === "onsite" ? "On-site" : (job as any).remote_policy}
                </span>
              )}
              {(job.salary_min || job.salary_max) && (
                <span className="inline-flex items-center gap-1">
                  {/* #1359 — Show the currency's actual symbol, not always $ */}
                  <span className="text-base font-semibold">
                    {job.salary_currency === "INR"
                      ? "₹"
                      : job.salary_currency === "EUR"
                      ? "€"
                      : job.salary_currency === "GBP"
                      ? "£"
                      : "$"}
                  </span>
                  {job.salary_min?.toLocaleString()} - {job.salary_max?.toLocaleString()} {job.salary_currency}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {job.status === "draft" && (
            <button
              onClick={() => statusMutation.mutate("open")}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Publish
            </button>
          )}
          {job.status === "open" && (
            <>
              <button
                onClick={() => statusMutation.mutate("paused")}
                className="rounded-lg bg-yellow-600 px-3 py-2 text-sm font-medium text-white hover:bg-yellow-700"
              >
                Pause
              </button>
              <button
                onClick={handleClose}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Close
              </button>
            </>
          )}
          {job.status === "paused" && (
            <>
              <button
                onClick={() => statusMutation.mutate("open")}
                className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Resume
              </button>
              <button
                onClick={handleClose}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Close
              </button>
            </>
          )}
          <Link
            to={`/jobs/${job.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
            Edit
          </Link>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Job details card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Description</h2>
          <p className="mt-2 text-gray-700 whitespace-pre-line">{job.description}</p>
        </div>
        {job.requirements && (
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Requirements</h2>
            <p className="mt-2 text-gray-700 whitespace-pre-line">{job.requirements}</p>
          </div>
        )}
        {skills.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Skills</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {skills.map((skill: string) => (
                <span
                  key={skill}
                  className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
        {(job.experience_min !== null || job.experience_max !== null) && (
          <div>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Experience</h2>
            <p className="mt-2 text-gray-700">
              {job.experience_min ?? 0} - {job.experience_max ?? "any"} years
            </p>
          </div>
        )}
        <div className="flex gap-6 text-sm text-gray-500">
          <span>Created: {formatDate(job.created_at)}</span>
          {job.published_at && <span>Published: {formatDate(job.published_at)}</span>}
          {job.closes_at && <span>Closes: {formatDate(job.closes_at)}</span>}
        </div>
      </div>

      {/* Publish to job boards */}
      <JobPublishingPanel jobId={job.id} />

      {/* Kanban Pipeline */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Application Pipeline ({applications.length} applicant{applications.length !== 1 ? "s" : ""})
          </h2>

          <div className="flex gap-2">
            <Link
              to={`/candidates/new?job_id=${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              <Users className="h-4 w-4" />
              Add Candidate
            </Link>
            {applications.length > 0 && compareSelection.size >= 2 && (
              <Link
                to={`/candidates/compare?ids=${Array.from(compareSelection).join(",")}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <GitCompareArrows className="h-4 w-4" />
                Compare ({compareSelection.size})
              </Link>
            )}
            {applications.length > 0 && (
              <>
                <button
                  onClick={() => batchScoreMutation.mutate()}
                  disabled={batchScoreMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {batchScoreMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Batch Score All
                </button>
                <button
                  onClick={() => {
                    setShowRankings(true);
                    refetchRankings();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
                >
                  <BarChart className="h-4 w-4" />
                  Rankings
                </button>
              </>
            )}
          </div>
        </div>

        {loadingApps ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
          </div>
        ) : applications.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No applications yet for this job.</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {activePipelineStages.map((stage) => {
              const cards = grouped[stage.slug] ?? [];
              if (stage.slug === "withdrawn" && cards.length === 0) return null;
              const stageColor = stage.color || "#6B7280";
              return (
                <div
                  key={stage.slug}
                  className="flex-shrink-0 w-64"
                >
                  {/* Stage header */}
                  <div
                    className={cn(
                      "rounded-t-lg px-3 py-2 text-sm font-semibold capitalize",
                      STAGE_HEADER[stage.slug] ?? "",
                    )}
                    style={!STAGE_HEADER[stage.slug] ? { backgroundColor: stageColor + "22", color: stageColor, borderLeft: `3px solid ${stageColor}` } : undefined}
                  >
                    {stage.name} ({cards.length})
                  </div>

                  {/* Cards */}
                  <div
                    className={cn(
                      "min-h-[120px] rounded-b-lg border p-2 space-y-2",
                      STAGE_COLORS[stage.slug] ?? "bg-gray-50 border-gray-200",
                    )}
                  >
                    {cards.length === 0 ? (
                      <p className="py-4 text-center text-xs text-gray-400">No applicants</p>
                    ) : (
                      cards.map((app) => (
                        <div
                          key={app.id}
                          className={cn(
                            "rounded-lg bg-white border p-3 shadow-sm hover:shadow-md transition-shadow",
                            compareSelection.has(app.id) ? "border-indigo-400 ring-1 ring-indigo-200" : "border-gray-200",
                          )}
                        >
                          <div className="flex items-start justify-between">
                            <Link to={`/candidates/${app.id}`} className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900">
                                {app.candidate_first_name} {app.candidate_last_name}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{app.candidate_email}</p>
                            </Link>
                            <input
                              type="checkbox"
                              checked={compareSelection.has(app.id)}
                              onChange={() => toggleCompare(app.id)}
                              className="ml-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              title="Select for comparison"
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-gray-400 inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(app.applied_at)}
                            </span>
                            <div className="flex items-center gap-1">
                              {app.rating !== null && (
                                <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                                  <Star className="h-3 w-3 fill-amber-400" />
                                  {app.rating}
                                </span>
                              )}
                              {appScores[app.id] !== undefined && (
                                <ScoreBadge score={appScores[app.id]} />
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                setScoringAppId(app.id);
                                scoreAppMutation.mutate(app.id);
                              }}
                              disabled={scoringAppId === app.id}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50"
                              title="AI Score this candidate"
                            >
                              {scoringAppId === app.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Brain className="h-3 w-3" />
                              )}
                              AI Score
                            </button>
                            <Link
                              to={`/scoring/${app.id}`}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100"
                              title="View score report"
                            >
                              <Target className="h-3 w-3" />
                              Report
                            </Link>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rankings Sidebar/Modal */}
      {showRankings && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowRankings(false)}
          />
          <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
                <BarChart className="h-5 w-5 text-purple-600" />
                AI Score Rankings
              </h3>
              <button
                onClick={() => setShowRankings(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {loadingRankings ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                </div>
              ) : rankings.length === 0 ? (
                <div className="py-8 text-center">
                  <Brain className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    No candidates have been scored yet. Use "Batch Score All" to score all candidates.
                  </p>
                </div>
              ) : (
                rankings.map((r: RankedCandidate, idx: number) => {
                  let matchedSkills: string[] = [];
                  try {
                    matchedSkills = r.matched_skills
                      ? Array.isArray(r.matched_skills)
                        ? r.matched_skills
                        : JSON.parse(r.matched_skills)
                      : [];
                  } catch { matchedSkills = []; }
                  let missingSkills: string[] = [];
                  try {
                    missingSkills = r.missing_skills
                      ? Array.isArray(r.missing_skills)
                        ? r.missing_skills
                        : JSON.parse(r.missing_skills)
                      : [];
                  } catch { missingSkills = []; }
                  const recBadge = RECOMMENDATION_BADGE[r.recommendation];

                  return (
                    <div
                      key={r.id}
                      className="rounded-lg border border-gray-200 p-4 hover:border-purple-200 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                            {idx + 1}
                          </span>
                          <div>
                            <Link
                              to={`/scoring/${r.application_id}`}
                              className="text-sm font-medium text-gray-900 hover:text-purple-700"
                            >
                              {r.candidate_first_name} {r.candidate_last_name}
                            </Link>
                            <p className="text-xs text-gray-500">{r.candidate_email}</p>
                          </div>
                        </div>
                        <ScoreBadge score={r.overall_score} />
                      </div>

                      <div className="mt-3 flex gap-4 text-xs">
                        <div>
                          <span className="text-gray-500">Skills:</span>{" "}
                          <span className="font-medium">{r.skills_score}/100</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Experience:</span>{" "}
                          <span className="font-medium">{r.experience_score}/100</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Stage:</span>{" "}
                          <span className="font-medium capitalize">{r.application_stage}</span>
                        </div>
                      </div>

                      {recBadge && (
                        <div className="mt-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                              recBadge.className,
                            )}
                          >
                            {recBadge.label}
                          </span>
                        </div>
                      )}

                      {(matchedSkills.length > 0 || missingSkills.length > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {matchedSkills.slice(0, 5).map((s) => (
                            <span
                              key={s}
                              className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
                            >
                              {s}
                            </span>
                          ))}
                          {missingSkills.slice(0, 3).map((s) => (
                            <span
                              key={s}
                              className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600"
                            >
                              {s}
                            </span>
                          ))}
                          {matchedSkills.length + missingSkills.length > 8 && (
                            <span className="text-xs text-gray-400">
                              +{matchedSkills.length + missingSkills.length - 8} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showCloseConfirm}
        variant="danger"
        title="Close this job posting?"
        message="It will stop accepting applications. You can reopen it by editing the job, but it won't auto-resume like Pause."
        confirmLabel="Close job"
        cancelLabel="Cancel"
        loading={statusMutation.isPending}
        onConfirm={confirmClose}
        onCancel={() => setShowCloseConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        variant="danger"
        title="Delete this job posting?"
        message="This permanently deletes the job. This cannot be undone. Jobs that already have applicants can't be deleted — close them instead to keep candidate history."
        confirmLabel="Delete job"
        cancelLabel="Cancel"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publish to job boards (outbound publishing scaffold)
// ---------------------------------------------------------------------------

interface BoardStatus {
  key: string;
  label: string;
  mechanism: string;
  requirements: string;
  enabled: boolean;
  configured: boolean;
  liveCapable: boolean;
}
interface Publication {
  board: string;
  status: string;
  external_url: string | null;
  status_detail: string | null;
  updated_at: string;
}

const PUB_STATUS_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  removed: "bg-gray-100 text-gray-500",
  draft: "bg-gray-100 text-gray-500",
};

function JobPublishingPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const boardsQuery = useQuery({
    queryKey: ["publish-boards"],
    queryFn: () => apiGet<BoardStatus[]>("/job-publishing/boards"),
  });
  const boards = boardsQuery.data?.data ?? [];

  const pubsQuery = useQuery({
    queryKey: ["publications", jobId],
    queryFn: () => apiGet<Publication[]>(`/job-publishing/jobs/${jobId}/publications`),
  });
  const pubs = pubsQuery.data?.data ?? [];
  const pubByBoard = new Map(pubs.map((p) => [p.board, p]));

  const publish = useMutation({
    mutationFn: (targets: string[]) =>
      apiPost(`/job-publishing/jobs/${jobId}/publish`, { boards: targets }),
    onSuccess: (res) => {
      const results = (res.data as { board: string; status: string }[]) ?? [];
      const sent = results.length;
      const pending = results.filter((r) => r.status === "pending").length;
      toast.success(
        pending
          ? `Queued ${sent} board(s) — ${pending} awaiting connection setup`
          : `Published to ${sent} board(s)`,
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["publications", jobId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || "Publish failed"),
  });

  const unpublish = useMutation({
    mutationFn: (board: string) =>
      apiPost(`/job-publishing/jobs/${jobId}/unpublish`, { board }),
    onSuccess: () => {
      toast.success("Removed from board");
      qc.invalidateQueries({ queryKey: ["publications", jobId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || "Could not remove"),
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Globe className="h-5 w-5 text-brand-600" /> Publish to job boards
        </h2>
        <button
          onClick={() => publish.mutate([...selected])}
          disabled={publish.isPending || selected.size === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publish selected
        </button>
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Board connectors are scaffolded but not yet live. Publishing records intent per board;
          each board goes live once its feed or employer-API credentials are wired. We never post
          to a board we can't reach.
        </span>
      </div>

      {boardsQuery.isLoading ? (
        <div className="mt-4 flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {boards.map((b) => {
            const pub = pubByBoard.get(b.key);
            const checked = selected.has(b.key);
            return (
              <div
                key={b.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
              >
                <label className="flex flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(b.key)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{b.label}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        {b.mechanism === "xml_feed" ? "XML feed" : "Employer API"}
                      </span>
                      {b.configured ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> credentials set
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <Lock className="h-3.5 w-3.5" /> not connected
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">{b.requirements}</span>
                    {pub?.status_detail && pub.status !== "published" && (
                      <span className="mt-1 block text-xs text-amber-600">{pub.status_detail}</span>
                    )}
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  {pub && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        PUB_STATUS_CLS[pub.status] ?? "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {pub.status}
                    </span>
                  )}
                  {pub && pub.status !== "removed" && (
                    <button
                      onClick={() => unpublish.mutate(b.key)}
                      disabled={unpublish.isPending}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
