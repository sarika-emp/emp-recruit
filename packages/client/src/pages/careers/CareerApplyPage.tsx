import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2,
  ArrowLeft,
  Upload,
  FileText,
  X,
} from "lucide-react";
import axios from "axios";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { JobPosting } from "@emp-recruit/shared";

const PUBLIC_API = "/api/v1/public";

interface PublicScreeningQuestion {
  id: string;
  question: string;
  type: "text" | "number" | "yes_no" | "single_choice";
  options: string[] | null;
  required: boolean;
}
interface PublicCustomField { id: string; field_key: string; label: string; field_type: string; options: string[] | null; required: boolean; condition_field_key?: string | null; condition_value?: string | null; }

// Upper bounds for the optional numeric fields (BUG-10). Negatives were already
// rejected; these cap unrealistic values like 999 years / 999,999,999 salary.
const MAX_EXPERIENCE_YEARS = 50;
const MAX_EXPECTED_SALARY = 100_000_000;
const REQUIRED_PHONE_DIGITS = 10;
const COUNTRY_CODES = [
  { code: "+91", label: "🇮🇳 +91" },
  { code: "+1", label: "🇺🇸 +1" },
  { code: "+44", label: "🇬🇧 +44" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+61", label: "🇦🇺 +61" },
  { code: "+65", label: "🇸🇬 +65" },
  { code: "+49", label: "🇩🇪 +49" },
  { code: "+33", label: "🇫🇷 +33" },
  { code: "+34", label: "🇪🇸 +34" },
  { code: "+351", label: "🇵🇹 +351" },
  { code: "+62", label: "🇮🇩 +62" },
  { code: "+81", label: "🇯🇵 +81" },
  { code: "+86", label: "🇨🇳 +86" },
  { code: "+966", label: "🇸🇦 +966" },
] as const;

export function CareerApplyPage() {
  const { t } = useTranslation();
  const { slug, jobId } = useParams<{ slug: string; jobId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    country_code: "+91",
    phone: "",
    cover_letter: "",
    current_company: "",
    experience_years: "",
    experience_months: "",
    expected_salary: "",
    skills: "",
  });
  const [resume, setResume] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Answers to the job's screening questions, keyed by question id.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const jobQuery = useQuery({
    queryKey: ["public-job", slug, jobId],
    queryFn: async () => {
      const { data } = await axios.get(`${PUBLIC_API}/careers/${slug}/jobs/${jobId}`);
      return data.data as JobPosting;
    },
  });

  const screeningQuery = useQuery({
    queryKey: ["public-screening", slug, jobId],
    queryFn: async () => {
      const { data } = await axios.get(
        `${PUBLIC_API}/careers/${slug}/jobs/${jobId}/screening-questions`,
      );
      return (data.data ?? []) as PublicScreeningQuestion[];
    },
  });
  const questions = screeningQuery.data ?? [];
  const customFieldsQuery = useQuery({
    queryKey: ["public-form-fields", slug, jobId],
    queryFn: async () => (await axios.get(`${PUBLIC_API}/careers/${slug}/jobs/${jobId}/form-fields`)).data.data as PublicCustomField[],
  });
  const customFields = customFieldsQuery.data ?? [];

  const applyMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("first_name", form.first_name);
      formData.append("last_name", form.last_name);
      formData.append("email", form.email);
      formData.append("job_id", jobId!);
      if (form.phone) {
        formData.append("country_code", form.country_code);
        formData.append("phone", form.phone);
      }
      if (form.cover_letter) formData.append("cover_letter", form.cover_letter);
      if (form.current_company) formData.append("current_company", form.current_company);
      // Fold months into the decimal years the API already accepts (same
      // pattern as the internal candidate forms: 2y 6m -> 2.5).
      if (form.experience_years || form.experience_months) {
        const yrs = Number(form.experience_years || 0);
        const mos = Number(form.experience_months || 0);
        formData.append("experience_years", String(Math.round((yrs + mos / 12) * 10) / 10));
      }
      if (form.expected_salary) formData.append("expected_salary", form.expected_salary);
      if (form.skills.trim()) formData.append("skills", form.skills.trim());
      if (questions.length) {
        formData.append(
          "screening_answers",
          JSON.stringify(questions.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? "" }))),
        );
      }
      if (customFields.length) formData.append("custom_form_values", JSON.stringify(customValues));
      if (resume) formData.append("resume", resume);

      const { data } = await axios.post(`${PUBLIC_API}/careers/${slug}/apply`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    onSuccess: () => {
      setSubmitError(null);
      navigate(`/careers/${slug}/jobs/${jobId}/success`);
    },
    onError: (err: any) => {
      const isDuplicate = err.response?.status === 409;
      const msg =
        err.response?.data?.error?.message ||
        (isDuplicate
          ? t("careers.apply.errorDuplicate")
          : t("careers.apply.errorSubmit"));
      // Show it both as a toast and as a persistent inline banner so the
      // applicant always sees why nothing happened. (BUG-03)
      setSubmitError(msg);
      toast.error(msg);
    },
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    // Clear a field's error as soon as the applicant edits it. (BUG-06)
    setErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
    // Phone: accept digits only and stop at exactly 10 digits (BUG-020).
    if (name === "phone") {
      const phone = value.replace(/\D/g, "").slice(0, REQUIRED_PHONE_DIGITS);
      setForm((prev) => ({ ...prev, phone }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  // Red border + focus ring for fields with a validation error. (BUG-06)
  function fieldClass(field: string) {
    const base =
      "mt-1 block w-full rounded-lg border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1";
    return errors[field]
      ? `${base} border-red-400 focus:border-red-500 focus:ring-red-500`
      : `${base} border-gray-300 focus:border-brand-500 focus:ring-brand-500`;
  }

  // Validate the resume the moment it's picked, so the applicant gets immediate
  // feedback instead of only finding out after clicking Submit. (BUG-01)
  const ALLOWED_RESUME_EXT = [".pdf", ".doc", ".docx"];
  const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10MB, matches the server limit
  function handleResumeSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same (or a corrected) file re-fires.
    e.target.value = "";
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_RESUME_EXT.includes(ext)) {
      toast.error(t("careers.apply.errorResumeType"));
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      toast.error(t("careers.apply.errorResumeSize"));
      return;
    }
    setResume(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Collect per-field errors so invalid fields are highlighted inline (BUG-06),
    // in addition to the toast messages the flow already surfaced.
    const next: Record<string, string> = {};
    const emailInvalid =
      form.email.trim() !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
    // Phone is optional, but when supplied it must contain exactly 10 digits.
    // This also protects submission state from programmatic changes (BUG-020).
    const phoneDigits = form.phone.replace(/\D/g, "");
    const phoneInvalid =
      form.phone.trim() !== "" && phoneDigits.length !== REQUIRED_PHONE_DIGITS;
    const yearsNegative = form.experience_years !== "" && Number(form.experience_years) < 0;
    const yearsTooHigh =
      form.experience_years !== "" && Number(form.experience_years) > MAX_EXPERIENCE_YEARS;
    const monthsOutOfRange =
      form.experience_months !== "" &&
      (Number(form.experience_months) < 0 || Number(form.experience_months) > 11);
    const salaryNegative = form.expected_salary !== "" && Number(form.expected_salary) < 0;
    const salaryTooHigh =
      form.expected_salary !== "" && Number(form.expected_salary) > MAX_EXPECTED_SALARY;

    if (!form.first_name.trim()) next.first_name = t("careers.apply.errorFirstNameRequired");
    if (!form.last_name.trim()) next.last_name = t("careers.apply.errorLastNameRequired");
    if (!form.email.trim()) next.email = t("careers.apply.errorEmailRequired");
    else if (emailInvalid) next.email = t("careers.apply.errorEmailInvalid");
    if (!resume) next.resume = t("careers.apply.errorResumeRequired");
    if (phoneInvalid) next.phone = t("careers.apply.errorPhoneInvalid");
    if (yearsNegative) next.experience_years = t("careers.apply.errorYearsNegative");
    else if (yearsTooHigh)
      next.experience_years = t("careers.apply.errorYearsMax", { max: MAX_EXPERIENCE_YEARS });
    if (monthsOutOfRange) next.experience_months = t("careers.apply.errorMonthsRange");
    if (salaryNegative) next.expected_salary = t("careers.apply.errorSalaryNegative");
    else if (salaryTooHigh) next.expected_salary = t("careers.apply.errorSalaryMax");
    // Required screening questions must be answered.
    const missingScreening = questions.filter((q) => q.required && (answers[q.id] ?? "").trim() === "");
    for (const q of missingScreening) next[`screening_${q.id}`] = t("careers.apply.screeningRequired");
    const visibleCustomFields = customFields.filter((f) => !f.condition_field_key || (customValues[f.condition_field_key] ?? "") === (f.condition_value ?? ""));
    const missingCustom = visibleCustomFields.filter((f) => f.required && !(customValues[f.field_key] ?? "").trim());
    for (const f of missingCustom) next[`custom_${f.field_key}`] = "This field is required";
    setErrors(next);

    // Keep the exact toast messages/priority the QA verified (CHK-01/02/03).
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      toast.error(t("careers.apply.errorNameEmailRequired"));
      return;
    }
    if (emailInvalid) {
      toast.error(t("careers.apply.errorEmailInvalid"));
      return;
    }
    if (!resume) {
      toast.error(t("careers.apply.errorResumeRequired"));
      return;
    }
    if (phoneInvalid) {
      toast.error(t("careers.apply.errorPhoneInvalid"));
      return;
    }
    if (yearsNegative) {
      toast.error(t("careers.apply.errorYearsNegative"));
      return;
    }
    if (yearsTooHigh) {
      toast.error(t("careers.apply.errorYearsMax", { max: MAX_EXPERIENCE_YEARS }));
      return;
    }
    if (monthsOutOfRange) {
      toast.error(t("careers.apply.errorMonthsRange"));
      return;
    }
    if (salaryNegative) {
      toast.error(t("careers.apply.errorSalaryNegative"));
      return;
    }
    if (salaryTooHigh) {
      toast.error(t("careers.apply.errorSalaryMax"));
      return;
    }
    if (missingScreening.length > 0) {
      toast.error(t("careers.apply.screeningRequiredToast"));
      return;
    }
    if (missingCustom.length > 0) { toast.error("Please complete all required application fields"); return; }
    setSubmitError(null);
    applyMutation.mutate();
  }

  // Wait for BOTH the job and its screening questions before showing the form:
  // rendering with a failed screening fetch would let the applicant submit with
  // no required answers and hit an unfixable server rejection.
  if (jobQuery.isLoading || screeningQuery.isLoading || customFieldsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (screeningQuery.isError || customFieldsQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-gray-700">{t("careers.apply.screeningLoadError")}</p>
          <button
            type="button"
            onClick={() => screeningQuery.refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("careers.apply.retry")}
          </button>
        </div>
      </div>
    );
  }

  const job = jobQuery.data;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          to={`/careers/${slug}/jobs/${jobId}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("careers.apply.backToJob")}
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("careers.apply.title", { title: job?.title || t("careers.apply.positionFallback") })}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("careers.apply.subtitle")}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="first_name" className="block text-sm font-medium text-gray-700">
                {t("careers.apply.firstNameLabel")}
              </label>
              <input
                id="first_name"
                name="first_name"
                type="text"
                required
                value={form.first_name}
                onChange={handleChange}
                className={fieldClass("first_name")}
              />
              {errors.first_name && <p className="mt-1 text-xs text-red-600">{errors.first_name}</p>}
            </div>
            <div>
              <label htmlFor="last_name" className="block text-sm font-medium text-gray-700">
                {t("careers.apply.lastNameLabel")}
              </label>
              <input
                id="last_name"
                name="last_name"
                type="text"
                required
                value={form.last_name}
                onChange={handleChange}
                className={fieldClass("last_name")}
              />
              {errors.last_name && <p className="mt-1 text-xs text-red-600">{errors.last_name}</p>}
            </div>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              {t("careers.apply.emailLabel")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={form.email}
              onChange={handleChange}
              className={fieldClass("email")}
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
              {t("careers.apply.phoneLabel")}
            </label>
            <div className="mt-1 flex gap-2">
              <select
                id="country_code"
                name="country_code"
                value={form.country_code}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, country_code: event.target.value }))
                }
                className="w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                aria-label={t("careers.apply.countryCodeLabel", { defaultValue: "Country code" })}
              >
                {COUNTRY_CODES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </select>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={REQUIRED_PHONE_DIGITS}
                value={form.phone}
                onChange={handleChange}
                className={fieldClass("phone").replace("mt-1 ", "")}
              />
            </div>
            {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
          </div>

          {/* Screening questions (job-specific) */}
          {questions.length > 0 && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-gray-900">{t("careers.apply.screeningTitle")}</h3>
              {questions.map((q) => {
                const val = answers[q.id] ?? "";
                const set = (v: string) => setAnswers((a) => ({ ...a, [q.id]: v }));
                const key = `screening_${q.id}`;
                const questionText = /^ny years of\b/i.test(q.question.trim()) ? `How ma${q.question.trim()}` : q.question;
                const usesYesNoOptions = q.type === "yes_no" || /^(can|do|does|did|is|are|will|would|have|has)\b/i.test(questionText.trim());
                return (
                  <div key={q.id}>
                    <label className="block text-sm font-medium text-gray-700">
                      {questionText} {q.required && <span className="text-red-500">*</span>}
                    </label>
                    {usesYesNoOptions ? (
                      <div className="mt-1 flex gap-4">
                        {["Yes", "No", "N/A"].map((opt) => (
                          <label key={opt} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                            <input
                              type="radio"
                              name={key}
                              checked={val === opt}
                              onChange={() => set(opt)}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : q.type === "single_choice" ? (
                      <select value={val} onChange={(e) => set(e.target.value)} className={fieldClass(key)}>
                        <option value="">{t("careers.apply.screeningSelect")}</option>
                        {(q.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={q.type === "number" ? "number" : "text"}
                        value={val}
                        maxLength={2000}
                        onChange={(e) => set(e.target.value)}
                        className={fieldClass(key)}
                      />
                    )}
                    {errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {customFields.length > 0 && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-gray-900">Additional application details</h3>
              {customFields.filter((f) => !f.condition_field_key || (customValues[f.condition_field_key] ?? "") === (f.condition_value ?? "")).map((f) => {
                const value = customValues[f.field_key] ?? "";
                const set = (next: string) => setCustomValues((current) => ({ ...current, [f.field_key]: next }));
                const key = `custom_${f.field_key}`;
                return <div key={f.id}><label className="block text-sm font-medium text-gray-700">{f.label} {f.required && <span className="text-red-500">*</span>}</label>
                  {f.field_type === "yes_no" ? <select className={fieldClass(key)} value={value} onChange={(e) => set(e.target.value)}><option value="">Select…</option><option>Yes</option><option>No</option></select>
                    : f.field_type === "multi_choice" ? <select multiple className={fieldClass(key)} value={value ? value.split("\u001f") : []} onChange={(e) => set(Array.from(e.target.selectedOptions).map((option) => option.value).join("\u001f"))}>{(f.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>
                    : f.field_type === "single_choice" ? <select className={fieldClass(key)} value={value} onChange={(e) => set(e.target.value)}><option value="">Select…</option>{(f.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>
                    : f.field_type === "textarea" ? <textarea className={fieldClass(key)} rows={3} value={value} onChange={(e) => set(e.target.value)} />
                    : <input className={fieldClass(key)} type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"} value={value} onChange={(e) => set(e.target.value)} />}
                  {errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
                </div>;
              })}
            </div>
          )}

          {/* Resume upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t("careers.apply.resumeLabel")} <span className="text-red-500">*</span>
            </label>
            {resume ? (
              <div className="mt-1 flex items-center gap-3 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
                <FileText className="h-5 w-5 text-brand-600" />
                <span className="flex-1 text-sm text-gray-700 truncate">{resume.name}</span>
                <button
                  type="button"
                  onClick={() => setResume(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-6 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600">
                <Upload className="h-5 w-5" />
                <span>{t("careers.apply.uploadResume")}</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={handleResumeSelect}
                />
              </label>
            )}
            {errors.resume && <p className="mt-1 text-xs text-red-600">{errors.resume}</p>}
          </div>

          {/* Cover letter */}
          <div>
            <label htmlFor="cover_letter" className="block text-sm font-medium text-gray-700">
              {t("careers.apply.coverLetterLabel")}
            </label>
            <textarea
              id="cover_letter"
              name="cover_letter"
              rows={4}
              value={form.cover_letter}
              onChange={handleChange}
              placeholder={t("careers.apply.coverLetterPlaceholder")}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Current company */}
          <div>
            <label htmlFor="current_company" className="block text-sm font-medium text-gray-700">
              {t("careers.apply.currentCompanyLabel")}
            </label>
            <input
              id="current_company"
              name="current_company"
              type="text"
              value={form.current_company}
              onChange={handleChange}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Experience & salary row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="experience_years" className="block text-sm font-medium text-gray-700">
                {t("careers.apply.experienceLabel")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input
                    id="experience_years"
                    name="experience_years"
                    type="number"
                    min="0"
                    max="50"
                    value={form.experience_years}
                    onChange={handleChange}
                    className={fieldClass("experience_years")}
                    aria-label={t("careers.apply.experienceLabel")}
                  />
                </div>
                <div>
                  <input
                    id="experience_months"
                    name="experience_months"
                    type="number"
                    min="0"
                    max="11"
                    step="1"
                    value={form.experience_months}
                    onChange={handleChange}
                    placeholder={t("careers.apply.monthsLabel")}
                    className={fieldClass("experience_months")}
                    aria-label={t("careers.apply.monthsLabel")}
                  />
                </div>
              </div>
              {errors.experience_years && (
                <p className="mt-1 text-xs text-red-600">{errors.experience_years}</p>
              )}
              {errors.experience_months && (
                <p className="mt-1 text-xs text-red-600">{errors.experience_months}</p>
              )}
            </div>
            <div>
              <label htmlFor="expected_salary" className="block text-sm font-medium text-gray-700">
                {t("careers.apply.salaryLabel")}
              </label>
              <input
                id="expected_salary"
                name="expected_salary"
                type="number"
                min="0"
                value={form.expected_salary}
                onChange={handleChange}
                className={fieldClass("expected_salary")}
              />
              {errors.expected_salary && (
                <p className="mt-1 text-xs text-red-600">{errors.expected_salary}</p>
              )}
            </div>
          </div>

          {/* Skills — feed the ATS skills match (BUG-004) */}
          <div>
            <label htmlFor="skills" className="block text-sm font-medium text-gray-700">
              {t("careers.apply.skillsLabel")}
            </label>
            <input
              id="skills"
              name="skills"
              type="text"
              maxLength={2000}
              value={form.skills}
              onChange={handleChange}
              placeholder={t("careers.apply.skillsPlaceholder")}
              className={fieldClass("skills")}
            />
          </div>

          {submitError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={applyMutation.isPending}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {applyMutation.isPending ? t("careers.apply.submitting") : t("careers.apply.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
