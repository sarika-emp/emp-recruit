import { useRef, useState } from "react";
import {
  X,
  Upload,
  Download,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
} from "lucide-react";
import { apiPost } from "@/api/client";

interface BulkUploadModalProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  /** Called after an import run so the parent can refresh the pipeline. */
  onImported: () => void;
}

const VALID_SOURCES = ["direct", "referral", "linkedin", "indeed", "naukri", "other"];

// CSV columns we understand. Only first_name, last_name and email are required.
const TEMPLATE_HEADERS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "current_title",
  "current_company",
  "experience_years",
  "source",
  "skills",
];

const TEMPLATE_SAMPLE =
  TEMPLATE_HEADERS.join(",") +
  "\n" +
  [
    "John,Doe,john.doe@example.com,+91 98765 43210,Senior Engineer,Acme Corp,6,linkedin,React;TypeScript;Node.js",
    "Jane,Smith,jane.smith@example.com,,Product Designer,,3,direct,Figma;UX",
  ].join("\n") +
  "\n";

interface ParsedRow {
  index: number; // 1-based data row number (for messages)
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  current_title?: string;
  current_company?: string;
  experience_years?: string;
  source: string;
  skills: string[];
  error: string | null; // validation error, null when the row is importable
}

interface ImportResults {
  createdNew: number;
  linkedExisting: number;
  skipped: number;
  failed: { name: string; reason: string }[];
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes and
 *  commas/newlines inside quotes. Returns an array of rows of string cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Flush trailing cell/row (file may not end with a newline).
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

function rowsFromCsv(text: string): { rows: ParsedRow[]; headerError: string | null } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length === 0) return { rows: [], headerError: "The file is empty." };

  const headers = table[0].map(normalizeHeader);
  const col = (name: string) => headers.indexOf(name);
  const ci = {
    first_name: col("first_name"),
    last_name: col("last_name"),
    email: col("email"),
    phone: col("phone"),
    current_title: col("current_title"),
    current_company: col("current_company"),
    experience_years: col("experience_years"),
    source: col("source"),
    skills: col("skills"),
  };

  if (ci.first_name === -1 || ci.last_name === -1 || ci.email === -1) {
    return {
      rows: [],
      headerError:
        "CSV must include first_name, last_name and email columns. Download the template for the expected format.",
    };
  }

  const get = (r: string[], idx: number) => (idx >= 0 ? (r[idx] ?? "").trim() : "");
  const rows: ParsedRow[] = table.slice(1).map((r, i) => {
    const first_name = get(r, ci.first_name);
    const last_name = get(r, ci.last_name);
    const email = get(r, ci.email);
    const sourceRaw = get(r, ci.source).toLowerCase();
    const skills = get(r, ci.skills)
      .split(/[;,|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    let error: string | null = null;
    if (!first_name || !last_name) error = "Missing first or last name";
    else if (!email) error = "Missing email";
    else if (!EMAIL_RE.test(email)) error = "Invalid email";

    return {
      index: i + 1,
      first_name,
      last_name,
      email,
      phone: get(r, ci.phone) || undefined,
      current_title: get(r, ci.current_title) || undefined,
      current_company: get(r, ci.current_company) || undefined,
      experience_years: get(r, ci.experience_years) || undefined,
      source: VALID_SOURCES.includes(sourceRaw) ? sourceRaw : "direct",
      skills,
      error,
    };
  });

  return { rows, headerError: null };
}

export function BulkUploadModal({ jobId, open, onClose, onImported }: BulkUploadModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);

  if (!open) return null;

  const validRows = rows.filter((r) => !r.error);

  function reset() {
    setFileName(null);
    setRows([]);
    setHeaderError(null);
    setResults(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (importing) return;
    reset();
    onClose();
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_SAMPLE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "candidates-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    setResults(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, headerError } = rowsFromCsv(String(reader.result || ""));
      setRows(rows);
      setHeaderError(headerError);
    };
    reader.readAsText(file);
  }

  async function runImport() {
    setImporting(true);
    try {
      // One request: the server creates candidates + applications and returns a
      // complete per-row report, instead of the client firing N calls.
      const candidates = validRows.map((r) => {
        const c: Record<string, any> = {
          first_name: r.first_name,
          last_name: r.last_name,
          email: r.email,
          source: r.source,
        };
        if (r.phone) c.phone = r.phone;
        if (r.current_title) c.current_title = r.current_title;
        if (r.current_company) c.current_company = r.current_company;
        if (r.experience_years && Number.isFinite(Number(r.experience_years))) {
          c.experience_years = Number(r.experience_years);
        }
        if (r.skills.length) c.skills = r.skills;
        return c;
      });

      const res = await apiPost<ImportResults>("/candidates/bulk", {
        job_id: jobId,
        candidates,
      });
      const d = res.data;
      const summary: ImportResults = {
        createdNew: d?.createdNew ?? 0,
        linkedExisting: d?.linkedExisting ?? 0,
        skipped: d?.skipped ?? 0,
        failed: d?.failed ?? [],
      };
      setResults(summary);
      if (summary.createdNew + summary.linkedExisting > 0) onImported();
    } catch (err: any) {
      // Whole request failed — surface it against every row we tried to import.
      setResults({
        createdNew: 0,
        linkedExisting: 0,
        skipped: 0,
        failed: validRows.map((r) => ({
          name: `${r.first_name} ${r.last_name}`,
          reason: errMsg(err),
        })),
      });
    }
    setImporting(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Bulk upload candidates"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600" />
            <h3 className="text-base font-semibold text-gray-900">Bulk Upload Candidates</h3>
          </div>
          <button
            onClick={close}
            disabled={importing}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Results view */}
          {results ? (
            <div className="space-y-4">
              {(() => {
                const added = results.createdNew + results.linkedExisting;
                const bits: string[] = [];
                if (results.createdNew) bits.push(`${results.createdNew} new`);
                if (results.linkedExisting) bits.push(`${results.linkedExisting} existing`);
                return (
                  <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                    <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-green-600" />
                    <div>
                      <p className="text-sm font-medium text-green-800">
                        {added} candidate{added !== 1 ? "s" : ""} added to this job
                        {bits.length ? ` (${bits.join(", ")})` : ""}.
                      </p>
                      {(results.skipped > 0 || results.failed.length > 0) && (
                        <p className="text-xs text-green-700">
                          {results.skipped > 0 && `${results.skipped} already applied`}
                          {results.skipped > 0 && results.failed.length > 0 && " · "}
                          {results.failed.length > 0 &&
                            `${results.failed.length} could not be imported`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {results.failed.length > 0 && (
                <div className="rounded-lg border border-gray-200">
                  <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Failed rows
                  </div>
                  <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto">
                    {results.failed.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                        <span>
                          <span className="font-medium text-gray-800">{f.name}</span>
                          <span className="text-gray-500"> — {f.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Instructions + template */}
              <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-sm text-gray-600">
                  Upload a CSV with columns{" "}
                  <code className="rounded bg-gray-200 px-1 text-xs">first_name</code>,{" "}
                  <code className="rounded bg-gray-200 px-1 text-xs">last_name</code>,{" "}
                  <code className="rounded bg-gray-200 px-1 text-xs">email</code> (required) plus
                  optional phone, current_title, current_company, experience_years, source and
                  skills.
                </p>
                <button
                  onClick={downloadTemplate}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-4 w-4" />
                  Template
                </button>
              </div>

              {/* File picker */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 text-center hover:border-brand-400 hover:bg-brand-50/40"
              >
                {fileName ? (
                  <>
                    <FileText className="h-8 w-8 text-brand-500" />
                    <span className="text-sm font-medium text-gray-700">{fileName}</span>
                    <span className="text-xs text-gray-400">Click to choose a different file</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">
                      Click to select a CSV file
                    </span>
                    <span className="text-xs text-gray-400">.csv up to a few hundred rows</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              {headerError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{headerError}</span>
                </div>
              )}

              {/* Preview */}
              {rows.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">
                      Preview — {validRows.length} of {rows.length} row
                      {rows.length !== 1 ? "s" : ""} ready
                    </span>
                    {rows.length - validRows.length > 0 && (
                      <span className="text-xs text-red-600">
                        {rows.length - validRows.length} row(s) will be skipped
                      </span>
                    )}
                  </div>
                  <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 font-medium">Email</th>
                          <th className="px-3 py-2 font-medium">Title</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map((r) => (
                          <tr key={r.index} className={r.error ? "bg-red-50/60" : ""}>
                            <td className="px-3 py-2 text-gray-800">
                              {r.first_name} {r.last_name}
                            </td>
                            <td className="px-3 py-2 text-gray-500">{r.email || "—"}</td>
                            <td className="px-3 py-2 text-gray-500">{r.current_title || "—"}</td>
                            <td className="px-3 py-2">
                              {r.error ? (
                                <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  {r.error}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-6 py-4">
          <div className="text-sm text-gray-500">
            {importing && (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing {validRows.length} candidate{validRows.length !== 1 ? "s" : ""}…
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={close}
              disabled={importing}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {results ? "Done" : "Cancel"}
            </button>
            {!results && (
              <button
                onClick={runImport}
                disabled={importing || validRows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import {validRows.length > 0 ? validRows.length : ""} candidate
                {validRows.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function errMsg(err: any): string {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    "Unknown error"
  );
}
