import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/api/client";
import type { JobPosting } from "@emp-recruit/shared";
import toast from "react-hot-toast";
import { RichTextEditor } from "@/components/RichTextEditor";

// Strip HTML tags and decode a couple of common entities so we can measure the
// actual text a rich-text description contains (validation counts characters,
// not markup).
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Today's date in YYYY-MM-DD for use as <input type="date" min> — #13.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "freelance", label: "Freelance" },
];

const REMOTE_POLICIES = [
  { value: "onsite", label: "On-site" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
];

interface FormData {
  title: string;
  description: string;
  department: string;
  location: string;
  employment_type: string;
  experience_min: string;
  experience_max: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  remote_policy: string;
  is_internal: boolean;
  requirements: string;
  benefits: string;
  skills: string;
  closes_at: string;
}

const INITIAL: FormData = {
  title: "",
  description: "",
  department: "",
  location: "",
  employment_type: "full_time",
  experience_min: "",
  experience_max: "",
  salary_min: "",
  salary_max: "",
  salary_currency: "INR",
  remote_policy: "onsite",
  is_internal: false,
  requirements: "",
  benefits: "",
  skills: "",
  closes_at: "",
};

export function JobFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormData>(INITIAL);

  const { data: existingJob, isLoading: loadingJob } = useQuery({
    queryKey: ["job", id],
    queryFn: () => apiGet<JobPosting>(`/jobs/${id}`),
    enabled: isEdit,
  });

  // #12 — departments & locations from the EmpCloud master DB so they render
  // as dropdowns instead of free-text. If either list is empty (org hasn't
  // set any up yet) the field gracefully falls back to a plain text input.
  const { data: departmentsData } = useQuery({
    queryKey: ["org-departments"],
    queryFn: () => apiGet<{ id: number; name: string }[]>("/organizations/departments"),
  });
  const { data: locationsData } = useQuery({
    queryKey: ["org-locations"],
    queryFn: () => apiGet<{ id: number; name: string }[]>("/organizations/locations"),
  });
  const departments = useMemo(() => departmentsData?.data ?? [], [departmentsData]);
  const locations = useMemo(() => locationsData?.data ?? [], [locationsData]);
  const minCloseDate = useMemo(() => todayIso(), []);

  useEffect(() => {
    if (existingJob?.data) {
      const j = existingJob.data;
      setForm({
        title: j.title,
        description: j.description,
        department: j.department ?? "",
        location: j.location ?? "",
        employment_type: j.employment_type,
        experience_min: j.experience_min?.toString() ?? "",
        experience_max: j.experience_max?.toString() ?? "",
        salary_min: j.salary_min?.toString() ?? "",
        salary_max: j.salary_max?.toString() ?? "",
        salary_currency: j.salary_currency,
        // #30 — preserve whatever the server has stored; default only if missing
        remote_policy: (j as any).remote_policy || "onsite",
        is_internal: Boolean((j as any).is_internal),
        requirements: j.requirements ?? "",
        benefits: j.benefits ?? "",
        skills: j.skills
          ? Array.isArray(j.skills)
            ? j.skills.join(", ")
            : typeof j.skills === "string"
              ? (() => { try { const p = JSON.parse(j.skills as string); return Array.isArray(p) ? p.join(", ") : j.skills; } catch { return j.skills; } })()
              : ""
          : "",
        closes_at: j.closes_at ? j.closes_at.slice(0, 10) : "",
      });
    }
  }, [existingJob]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiPost<JobPosting>("/jobs", data),
    onSuccess: (res) => {
      toast.success("Job created successfully");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/jobs/${res.data?.id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message || "Failed to create job";
      const details = err?.response?.data?.error?.details;
      if (details) {
        const fieldErrors = Object.entries(details)
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
          .join("; ");
        toast.error(`${msg} — ${fieldErrors}`);
      } else {
        toast.error(msg);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiPut<JobPosting>(`/jobs/${id}`, data),
    onSuccess: () => {
      toast.success("Job updated successfully");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", id] });
      navigate(`/jobs/${id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message || "Failed to update job";
      const details = err?.response?.data?.error?.details;
      if (details) {
        const fieldErrors = Object.entries(details)
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(", ")}`)
          .join("; ");
        toast.error(`${msg} — ${fieldErrors}`);
      } else {
        toast.error(msg);
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // #13 — belt-and-braces past-date guard. The date input already has
    // `min` set, but users who paste the date or use devtools shouldn't
    // be able to slip a past deadline through.
    if (form.closes_at && form.closes_at < minCloseDate) {
      toast.error("Application deadline cannot be in the past");
      return;
    }

    // #14 — description min length is 10 on the server. Fail fast with a
    // human-readable message instead of surfacing a zod error. The editor
    // stores HTML, so measure the visible text rather than the markup.
    if (htmlToText(form.description).length < 10) {
      toast.error("Description must be at least 10 characters");
      return;
    }

    const numericChecks: { field: keyof FormData; label: string }[] = [
      { field: "experience_min", label: "Min experience" },
      { field: "experience_max", label: "Max experience" },
      { field: "salary_min", label: "Min salary" },
      { field: "salary_max", label: "Max salary" },
    ];
    for (const { field: name, label } of numericChecks) {
      const raw = form[name];
      if (raw === "" || raw === undefined) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`${label} cannot be negative`);
        return;
      }
    }

    // Min must not exceed Max for experience and salary ranges (only check when
    // both ends are provided).
    if (
      form.experience_min !== "" &&
      form.experience_max !== "" &&
      Number(form.experience_min) > Number(form.experience_max)
    ) {
      toast.error("Min experience cannot be greater than max experience");
      return;
    }
    if (
      form.salary_min !== "" &&
      form.salary_max !== "" &&
      Number(form.salary_min) > Number(form.salary_max)
    ) {
      toast.error("Min salary cannot be greater than max salary");
      return;
    }

    const payload: Record<string, any> = {
      title: form.title,
      description: form.description,
      employment_type: form.employment_type,
      salary_currency: form.salary_currency,
      // #30 — always persist remote_policy; previously dropped on the floor.
      remote_policy: form.remote_policy,
      is_internal: form.is_internal,
    };

    if (form.department) payload.department = form.department;
    if (form.location) payload.location = form.location;
    if (form.experience_min) payload.experience_min = Number(form.experience_min);
    if (form.experience_max) payload.experience_max = Number(form.experience_max);
    if (form.salary_min) payload.salary_min = Number(form.salary_min);
    if (form.salary_max) payload.salary_max = Number(form.salary_max);
    // Only persist requirements when it has visible text — the rich editor can
    // leave empty markup (e.g. "<br>") behind after the user clears it.
    if (htmlToText(form.requirements).length > 0) payload.requirements = form.requirements;
    if (form.benefits) payload.benefits = form.benefits;
    if (form.skills) payload.skills = form.skills.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (form.closes_at) payload.closes_at = new Date(form.closes_at).toISOString();

    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  // Only string-valued fields go through this generic text-input helper
  // (is_internal is a boolean rendered as a checkbox separately).
  type StringFieldKey = {
    [K in keyof FormData]: FormData[K] extends string ? K : never;
  }[keyof FormData];

  function field(label: string, name: StringFieldKey, type = "text", opts?: { required?: boolean; placeholder?: string; min?: number }) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label} {opts?.required && <span className="text-red-500">*</span>}
        </label>
        <input
          type={type}
          value={form[name]}
          onChange={(e) => setForm((p) => ({ ...p, [name]: e.target.value }))}
          placeholder={opts?.placeholder}
          required={opts?.required}
          min={opts?.min}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
    );
  }

  if (isEdit && loadingJob) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? "Edit Job Posting" : "Create Job Posting"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>

          {field("Job Title", "title", "text", { required: true, placeholder: "e.g. Senior Software Engineer" })}

          <div>
            <label htmlFor="job-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            {/* #14 — backend enforces min length 10; handleSubmit measures the
                editor's visible text so the user gets immediate feedback
                instead of a confusing 400. */}
            <RichTextEditor
              id="job-description"
              aria-label="Job description"
              value={form.description}
              onChange={(html) => setForm((p) => ({ ...p, description: html }))}
              placeholder="Describe the role, responsibilities, and what success looks like..."
            />
            <p className="mt-1 text-xs text-gray-400">
              Format with the toolbar. Minimum 10 characters.
            </p>
          </div>

          {/* #12 — Department & Location. Dropdowns when the org has
              configured entries, free-text fallback otherwise. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              {departments.length > 0 ? (
                <select
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                  placeholder="e.g. Engineering"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              {locations.length > 0 ? (
                <select
                  value={form.location}
                  onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="">Select location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.name}>{l.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. Bengaluru, India"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
              <select
                value={form.employment_type}
                onChange={(e) => setForm((p) => ({ ...p, employment_type: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remote Policy</label>
              <select
                value={form.remote_policy}
                onChange={(e) => setForm((p) => ({ ...p, remote_policy: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {REMOTE_POLICIES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Internal-only visibility */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <input
              type="checkbox"
              checked={form.is_internal}
              onChange={(e) => setForm((p) => ({ ...p, is_internal: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="font-medium text-gray-800">Internal only</span>
              <span className="block text-xs text-gray-500">
                Show this job on the Internal Jobs page for employees, but hide it from the public career page.
              </span>
            </span>
          </label>
        </div>

        {/* Experience & Salary */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Experience & Compensation</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field("Min Experience (years)", "experience_min", "number", { placeholder: "0", min: 0 })}
            {field("Max Experience (years)", "experience_max", "number", { placeholder: "10", min: 0 })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {field("Min Salary", "salary_min", "number", { placeholder: "e.g. 800000", min: 0 })}
            {field("Max Salary", "salary_max", "number", { placeholder: "e.g. 1500000", min: 0 })}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={form.salary_currency}
                onChange={(e) => setForm((p) => ({ ...p, salary_currency: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
        </div>

        {/* Requirements & Details */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Requirements & Details</h2>

          <div>
            <label htmlFor="job-requirements" className="block text-sm font-medium text-gray-700 mb-1">
              Requirements
            </label>
            <RichTextEditor
              id="job-requirements"
              aria-label="Job requirements"
              value={form.requirements}
              onChange={(html) => setForm((p) => ({ ...p, requirements: html }))}
              placeholder="List the key requirements for this role..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Benefits</label>
            <textarea
              value={form.benefits}
              onChange={(e) => setForm((p) => ({ ...p, benefits: e.target.value }))}
              rows={3}
              placeholder="List benefits and perks..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {field("Skills (comma separated)", "skills", "text", { placeholder: "React, TypeScript, Node.js" })}
          {/* #13 — can't pick a deadline in the past. Enforced client-side
              via the native min attribute; backend rejects Invalid dates too. */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Application Deadline</label>
            <input
              type="date"
              value={form.closes_at}
              onChange={(e) => setForm((p) => ({ ...p, closes_at: e.target.value }))}
              min={minCloseDate}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? "Update Job" : "Save as Draft"}
          </button>
        </div>
        {!isEdit && (
          <p className="text-right text-xs text-gray-500">
            Saved jobs start as drafts. Open the job and click Publish to list it on your career page.
          </p>
        )}
      </form>
    </div>
  );
}
