import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Gift, Plus, X, Pencil, Search } from "lucide-react";
import { api, apiGet, apiPost } from "@/api/client";
import { usePaginatedList } from "@/lib/usePaginatedList";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/Pagination";
import { ExportButtons } from "@/components/ExportButtons";
import { fetchAllRows, type ExportColumn } from "@/lib/export";
import { formatDate } from "@/lib/utils";
import { getUser } from "@/lib/auth-store";
import { canAccessRecruit } from "@/lib/roles";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { JobPosting, PaginatedResponse } from "@emp-recruit/shared";


const REFERRAL_COLUMNS: ExportColumn<ReferralRow>[] = [
  { header: "Candidate", value: (r) => r.candidate_name },
  { header: "Job", value: (r) => r.job_title },
  { header: "Status", value: (r) => r.status },
  { header: "Relationship", value: (r) => r.relationship },
  { header: "Bonus Amount", value: (r) => r.bonus_amount },
  { header: "Bonus Paid", value: (r) => (r.bonus_paid_at ? formatDate(r.bonus_paid_at) : "") },
  { header: "Referred", value: (r) => (r.created_at ? formatDate(r.created_at) : "") },
];

const STATUS_OPTIONS = [
  { value: "submitted", labelKey: "referrals.statusSubmitted" },
  { value: "under_review", labelKey: "referrals.statusUnderReview" },
  { value: "hired", labelKey: "referrals.statusHired" },
  { value: "rejected", labelKey: "referrals.statusRejected" },
  { value: "bonus_eligible", labelKey: "referrals.statusBonusEligible" },
  { value: "bonus_paid", labelKey: "referrals.statusBonusPaid" },
];

interface ReferralRow {
  id: string;
  job_id: string;
  referrer_id: number;
  candidate_id: string;
  application_id: string | null;
  status: string;
  relationship: string | null;
  notes: string | null;
  bonus_amount: number | null;
  bonus_paid_at: string | null;
  created_at: string;
  candidate_name: string;
  job_title: string;
}

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  hired: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  bonus_eligible: "bg-purple-100 text-purple-700",
  bonus_paid: "bg-emerald-100 text-emerald-700",
};

function formatStatusFilter(value: string): string {
  return value
    .split(",")
    .map((v) => v.trim().replace(/_/g, " "))
    .filter(Boolean)
    .join(" + ");
}

export function ReferralListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRef, setEditingRef] = useState<ReferralRow | null>(null);
  const [editForm, setEditForm] = useState({ status: "", bonus_amount: "" });
  const user = getUser();
  const isAdmin = canAccessRecruit(user);

  // List controls: search (candidate/job), status filter, pagination.
  // The status filter honours ?status= so dashboard cards can deep-link here.
  const [searchParams, setSearchParams] = useSearchParams();
  const [listPage, setListPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "");
  const initialListSearch = searchParams.get("search") ?? "";
  const [listSearchInput, setListSearchInput] = useState(initialListSearch);
  const [listSearch, setListSearch] = useState(initialListSearch);

  useEffect(() => {
    const t = setTimeout(() => {
      const value = listSearchInput.trim();
      setListSearch(value);
      setListPage(1);
      const next = new URLSearchParams(searchParams);
      if (value) next.set("search", value); else next.delete("search");
      next.delete("page");
      setSearchParams(next, { replace: true });
    }, 400);
    return () => clearTimeout(t);
  }, [listSearchInput]);

  const [form, setForm] = useState({
    job_id: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    relationship: "",
    notes: "",
  });
  // Pick from existing candidates so referrers don't have to retype
  // information already on file. Selected candidate's name/email/phone
  // auto-fill the form below.
  const [candidateSearch, setCandidateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(candidateSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [candidateSearch]);

  const candidatesQuery = useQuery({
    queryKey: ["candidates-for-referral", debouncedSearch],
    queryFn: () =>
      apiGet<PaginatedResponse<{ id: string; first_name: string; last_name: string; email: string; phone: string | null }>>(
        "/candidates",
        { perPage: 10, search: debouncedSearch },
      ),
    // Only search when the user has actually typed something — otherwise an
    // empty term returns every candidate and the dropdown reopens after a pick.
    enabled: showForm && debouncedSearch.length > 0,
  });
  // Gate on an active search term so a stale cached result (or an empty-term
  // "all candidates" fetch) can't keep the dropdown open after a pick.
  const candidateOptions = debouncedSearch.length > 0 ? candidatesQuery.data?.data?.data ?? [] : [];

  // Fetch open jobs for the dropdown
  const jobsQuery = useQuery({
    queryKey: ["jobs-for-referral"],
    queryFn: async () => {
      const res = await apiGet<JobPosting[]>("/referrals/jobs");
      return res.data || [];
    },
  });
  const openJobs: JobPosting[] = jobsQuery.data || [];

  const {
    rows: referrals,
    total: refTotal,
    isLoading: referralsLoading,
  } = usePaginatedList<ReferralRow>(
    ["referrals"],
    "/referrals",
    { status: statusFilter, search: listSearch },
    listPage,
  );

  const submitMutation = useMutation({
    mutationFn: (data: typeof form) => apiPost("/referrals", data),
    onSuccess: () => {
      toast.success(t("referrals.submitSuccess"));
      queryClient.invalidateQueries({ queryKey: ["referrals"] });
      setShowForm(false);
      setForm({ job_id: "", first_name: "", last_name: "", email: "", phone: "", relationship: "", notes: "" });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error?.message || t("referrals.submitError"));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (payload: { id: string; status: string; bonus_amount?: number }) =>
      api.patch(`/referrals/${payload.id}/status`, {
        status: payload.status,
        ...(payload.bonus_amount !== undefined ? { bonus_amount: payload.bonus_amount } : {}),
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("referrals.updateSuccess"));
      queryClient.invalidateQueries({ queryKey: ["referrals"] });
      setEditingRef(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || t("referrals.updateError"));
    },
  });

  function openEdit(r: ReferralRow) {
    setEditingRef(r);
    setEditForm({
      status: r.status,
      bonus_amount: r.bonus_amount != null ? String(r.bonus_amount / 100) : "",
    });
  }

  function submitEdit() {
    if (!editingRef) return;
    if (!editForm.status) {
      toast.error(t("referrals.pickStatus"));
      return;
    }
    const payload: { id: string; status: string; bonus_amount?: number } = {
      id: editingRef.id,
      status: editForm.status,
    };
    if (editForm.bonus_amount) {
      const amount = Number(editForm.bonus_amount);
      if (!Number.isFinite(amount) || amount < 0) {
        toast.error(t("referrals.bonusNegative"));
        return;
      }
      payload.bonus_amount = Math.round(amount * 100);
    }
    updateStatusMutation.mutate(payload);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.job_id) {
      toast.error(t("referrals.selectJobPosition"));
      return;
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error(t("referrals.enterFullName"));
      return;
    }
    if (!form.email.trim()) {
      toast.error(t("referrals.enterEmail"));
      return;
    }
    submitMutation.mutate(form);
  }

  const filtersActive = Boolean(statusFilter || listSearch);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("referrals.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("referrals.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons
            baseName="referrals"
            title={t("referrals.title")}
            subtitle={t(statusFilter ? "referrals.countMatch" : "referrals.count", { count: refTotal })}
            columns={REFERRAL_COLUMNS}
            fetchRows={() => fetchAllRows<ReferralRow>("/referrals", { status: statusFilter, search: listSearch })}
          />
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? t("referrals.cancel") : t("referrals.referSomeone")}
          </button>
        </div>
      </div>

      {/* Submit form */}
      {showForm && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">{t("referrals.submitFormTitle")}</h3>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="block text-sm font-medium text-gray-700">{t("referrals.pickExisting")}</label>
            <input
              type="text"
              aria-label={t("referrals.searchPlaceholder")}
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder={t("referrals.searchByNameEmail")}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            {candidateOptions.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {candidateOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setForm((p) => ({
                        ...p,
                        first_name: c.first_name,
                        last_name: c.last_name,
                        email: c.email,
                        phone: c.phone || p.phone,
                      }));
                      // Clear both so the dropdown closes immediately (and the
                      // debounced effect doesn't briefly re-open it).
                      setCandidateSearch("");
                      setDebouncedSearch("");
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-brand-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">
                        {c.first_name} {c.last_name}
                      </p>
                      <p className="truncate text-xs text-gray-500">{c.email}</p>
                    </div>
                    <span className="text-xs text-brand-600">{t("referrals.use")}</span>
                  </button>
                ))}
              </div>
            )}
            {debouncedSearch && candidateOptions.length === 0 && !candidatesQuery.isLoading && (
              <p className="mt-2 text-xs text-gray-500">{t("referrals.noMatchingCandidates")}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">{t("referrals.jobPosition")} *</label>
              <select
                required
                value={form.job_id}
                onChange={(e) => setForm((p) => ({ ...p, job_id: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">{t("referrals.selectJobPositionOption")}</option>
                {jobsQuery.isLoading ? (
                  <option disabled>{t("referrals.loadingJobs")}</option>
                ) : openJobs.length === 0 ? (
                  <option disabled>{t("referrals.noOpenPositions")}</option>
                ) : (
                  openJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title}{job.department ? ` — ${job.department}` : ""}{job.location ? ` (${job.location})` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.firstName")} *</label>
              <input
                type="text"
                required
                value={form.first_name}
                onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.lastName")} *</label>
              <input
                type="text"
                required
                value={form.last_name}
                onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.email")} *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.phone")}</label>
              <input
                type="tel"
                inputMode="tel"
                maxLength={16}
                value={form.phone}
                // Strip anything that isn't a digit or phone punctuation as it's
                // typed, so alphabetic input can't be entered at all. BUG-13.
                onChange={(e) =>
                  setForm((p) => {
                    const cleaned = e.target.value.replace(/[^\d+\-()\s]/g, "");
                    let digits = 0;
                    return { ...p, phone: [...cleaned].filter((char) => !/\d/.test(char) || ++digits <= 12).join("") };
                  })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.relationship")}</label>
              <input
                type="text"
                value={form.relationship}
                onChange={(e) => setForm((p) => ({ ...p, relationship: e.target.value }))}
                placeholder={t("referrals.relationshipPlaceholder")}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t("referrals.notes")}</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {submitMutation.isPending ? t("referrals.submitting") : t("referrals.submitReferral")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List controls: search + status filter */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 sm:w-72">
            <label className="sr-only" htmlFor="referral-search">{t("referrals.searchPlaceholder")}</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="referral-search"
              type="text"
              value={listSearchInput}
              onChange={(e) => setListSearchInput(e.target.value)}
              placeholder={t("referrals.searchPlaceholder")}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <label className="sr-only" htmlFor="referral-status">{t("referrals.status")}</label>
          <select
            id="referral-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setListPage(1);
            }}
            className="h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">{t("referrals.allStatuses")}</option>
            {/* A dashboard card can deep-link a combined filter (e.g.
                submitted,under_review). Surface it as its own option so the
                dropdown reflects what's actually applied instead of falsely
                showing "All statuses". */}
            {statusFilter.includes(",") && (
              <option value={statusFilter}>{formatStatusFilter(statusFilter)}</option>
            )}
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={() => {
                setStatusFilter("");
                setListSearchInput("");
                setListSearch("");
                setListPage(1);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <X className="h-4 w-4" /> {t("referrals.clear")}
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500">
          {filtersActive
            ? t("referrals.countMatch", { count: refTotal })
            : t("referrals.count", { count: refTotal })}
        </p>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {referralsLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          </div>
        ) : referrals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Gift className="h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {filtersActive
                ? t("referrals.noMatch")
                : t("referrals.emptyState")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">{t("referrals.colCandidate")}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t("referrals.colJob")}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t("referrals.status")}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t("referrals.colBonus")}</th>
                  <th className="px-4 py-3 font-medium text-gray-600">{t("referrals.colDate")}</th>
                  {isAdmin && <th className="px-4 py-3 font-medium text-gray-600 w-12"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {referrals.map((ref) => (
                  <tr key={ref.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{ref.candidate_name}</td>
                    <td className="px-4 py-3 text-gray-700">{ref.job_title}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[ref.status] || "bg-gray-100 text-gray-700"}`}
                      >
                        {(() => {
                          const opt = STATUS_OPTIONS.find((o) => o.value === ref.status);
                          return opt ? t(opt.labelKey) : ref.status.replace(/_/g, " ");
                        })()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {ref.bonus_amount ? <><span>INR {(ref.bonus_amount / 100).toLocaleString()}</span>{ref.status === "bonus_paid" && ref.bonus_paid_at && <span className="block text-xs text-gray-500">Paid {formatDate(ref.bonus_paid_at)}</span>}</> : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(ref.created_at)}</td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openEdit(ref)}
                          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          title={t("referrals.updateTitle")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!referralsLoading && referrals.length > 0 && (
        <Pagination
          className="mt-4"
          page={listPage}
          perPage={DEFAULT_PAGE_SIZE}
          total={refTotal}
          onPageChange={setListPage}
        />
      )}

      {editingRef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-base font-semibold text-gray-900">{t("referrals.modalTitle")}</h3>
              <button
                onClick={() => setEditingRef(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{editingRef.candidate_name}</span>
                <span className="text-gray-400"> {t("referrals.forJob", { job: editingRef.job_title })}</span>
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("referrals.status")}</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("referrals.bonusAmountInr")}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editForm.bonus_amount}
                  onChange={(e) => setEditForm((p) => ({ ...p, bonus_amount: e.target.value }))}
                  placeholder={t("referrals.bonusPlaceholder")}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t("referrals.bonusHelp")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4 rounded-b-xl">
              <button
                type="button"
                onClick={() => setEditingRef(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("referrals.cancel")}
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={updateStatusMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {updateStatusMutation.isPending ? t("referrals.saving") : t("referrals.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
