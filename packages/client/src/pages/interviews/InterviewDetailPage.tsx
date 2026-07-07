import { useState, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Users,
  Star,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  MapPin,
  Clock,
  ArrowLeft,
  Video,
  Mic,
  FileText,
  Link as LinkIcon,
  Mail,
  Upload,
  Trash2,
  Copy,
  CheckCircle,
  Download,
} from "lucide-react";
import { api, apiGet, apiPost, apiPut, apiPatch, apiDelete } from "@/api/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/lib/auth-store";
import type {
  Interview,
  InterviewPanelist,
  InterviewFeedback,
  InterviewStatus,
  Recommendation,
} from "@emp-recruit/shared";

interface InterviewDetail extends Interview {
  panelists: InterviewPanelist[];
  feedback: InterviewFeedback[];
  candidate_name: string;
  job_title: string;
  application: { id: string; candidate_id: string; job_id: string } | null;
}

interface Recording {
  id: string;
  interview_id: string;
  file_path: string;
  file_size: number | null;
  duration_seconds: number | null;
  mime_type: string | null;
  uploaded_by: number;
  uploaded_at: string;
  created_at: string;
}

interface Transcript {
  id: string;
  interview_id: string;
  recording_id: string | null;
  content: string;
  summary: string | null;
  status: "processing" | "completed" | "failed";
  generated_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  no_show: "bg-red-100 text-red-800",
};

const PROVIDER_LABELS: Record<string, string> = {
  jitsi: "Jitsi (in-app)",
  livekit: "LiveKit (in-app)",
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
};

const RECOMMENDATION_COLORS: Record<string, string> = {
  strong_yes: "text-green-700 bg-green-50",
  yes: "text-green-600 bg-green-50",
  neutral: "text-gray-600 bg-gray-50",
  no: "text-red-600 bg-red-50",
  strong_no: "text-red-700 bg-red-50",
};

const RECOMMENDATION_ICONS: Record<string, typeof ThumbsUp> = {
  strong_yes: ThumbsUp,
  yes: ThumbsUp,
  neutral: Star,
  no: ThumbsDown,
  strong_no: ThumbsDown,
};

function formatTime(dateStr: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i <= value ? "fill-yellow-400 text-yellow-400" : "text-gray-300",
          )}
        />
      ))}
      <span className="ml-1 text-sm text-gray-600">{value}/5</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline feedback form for panelists who haven't submitted yet
// ---------------------------------------------------------------------------
function InlineFeedbackForm({
  interviewId,
  onSuccess,
}: {
  interviewId: string;
  onSuccess: () => void;
}) {
  const [recommendation, setRecommendation] = useState<Recommendation | "">("");
  const [overallScore, setOverallScore] = useState(0);
  const [technicalScore, setTechnicalScore] = useState(0);
  const [communicationScore, setCommunicationScore] = useState(0);
  const [culturalFitScore, setCulturalFitScore] = useState(0);
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      return apiPost(`/interviews/${interviewId}/feedback`, {
        recommendation,
        overall_score: overallScore || undefined,
        technical_score: technicalScore || undefined,
        communication_score: communicationScore || undefined,
        cultural_fit_score: culturalFitScore || undefined,
        strengths: strengths || undefined,
        weaknesses: weaknesses || undefined,
        notes: notes || undefined,
      });
    },
    onSuccess,
  });

  function ScoreSelector({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
  }) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange(i)}
              className="p-0.5"
            >
              <Star
                className={cn(
                  "h-6 w-6 transition-colors",
                  i <= value
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-gray-300 hover:text-yellow-300",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-5 rounded-lg border border-brand-200 bg-brand-50/30 p-6"
    >
      <h3 className="text-lg font-semibold text-gray-900">Submit Your Feedback</h3>

      {/* Recommendation */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Recommendation <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "strong_yes", label: "Strong Yes" },
              { value: "yes", label: "Yes" },
              { value: "neutral", label: "Neutral" },
              { value: "no", label: "No" },
              { value: "strong_no", label: "Strong No" },
            ] as { value: Recommendation; label: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRecommendation(opt.value)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                recommendation === opt.value
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:border-brand-400",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ScoreSelector label="Overall" value={overallScore} onChange={setOverallScore} />
        <ScoreSelector label="Technical" value={technicalScore} onChange={setTechnicalScore} />
        <ScoreSelector
          label="Communication"
          value={communicationScore}
          onChange={setCommunicationScore}
        />
        <ScoreSelector
          label="Cultural Fit"
          value={culturalFitScore}
          onChange={setCulturalFitScore}
        />
      </div>

      {/* Text areas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Strengths</label>
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Key strengths observed..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Weaknesses</label>
          <textarea
            value={weaknesses}
            onChange={(e) => setWeaknesses(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            placeholder="Areas of concern..."
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="Any other observations..."
        />
      </div>

      {mutation.isError && (
        <p className="text-sm text-red-600">
          {(mutation.error as any)?.response?.data?.error?.message || "Failed to submit feedback."}
        </p>
      )}

      <button
        type="submit"
        disabled={!recommendation || mutation.isPending}
        className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {mutation.isPending ? "Submitting..." : "Submit Feedback"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Meeting Link Section
// ---------------------------------------------------------------------------
function MeetingLinkSection({ interview }: { interview: InterviewDetail }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [invitationSent, setInvitationSent] = useState(false);

  const generateMeetMutation = useMutation({
    mutationFn: async () => {
      return apiPost(`/interviews/${interview.id}/generate-meet`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interview", interview.id] });
    },
  });

  const sendInvitationMutation = useMutation({
    mutationFn: async () => {
      return apiPost(`/interviews/${interview.id}/send-invitation`);
    },
    onSuccess: () => {
      setInvitationSent(true);
      setTimeout(() => setInvitationSent(false), 5000);
    },
  });

  const handleCopyLink = async () => {
    if (interview.meeting_link) {
      await navigator.clipboard.writeText(interview.meeting_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Video className="h-5 w-5 text-gray-400" /> Meeting
        </h3>
        {interview.meeting_provider && (
          <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
            {PROVIDER_LABELS[interview.meeting_provider] || interview.meeting_provider}
          </span>
        )}
      </div>

      {!interview.meeting_link ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">No meeting link has been generated yet.</p>
          <button
            onClick={() => generateMeetMutation.mutate()}
            disabled={generateMeetMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            <LinkIcon className="h-4 w-4" />
            {generateMeetMutation.isPending ? "Generating..." : "Generate Meeting Link"}
          </button>
          {generateMeetMutation.isError && (
            <p className="text-sm text-red-600">Failed to generate link.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Embedded providers (Jitsi/LiveKit): join inside the app. */}
            {interview.meeting_embeddable && (
              <Link
                to={`/interviews/${interview.id}/room`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
              >
                <Video className="h-4 w-4" />
                Join Room
              </Link>
            )}
            <a
              href={interview.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors",
                interview.meeting_embeddable
                  ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  : "bg-brand-600 text-white hover:bg-brand-700",
              )}
            >
              {interview.meeting_embeddable ? (
                <ExternalLink className="h-4 w-4" />
              ) : (
                <Video className="h-4 w-4" />
              )}
              {interview.meeting_embeddable ? "Open externally" : "Join Meeting"}
            </a>
            <a
              href={interview.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800 break-all"
            >
              <ExternalLink className="h-4 w-4 flex-shrink-0" />
              {interview.meeting_link}
            </a>
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircle className="h-3.5 w-3.5 text-green-600" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy Link
                </>
              )}
            </button>
            <button
              onClick={() => sendInvitationMutation.mutate()}
              disabled={sendInvitationMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Mail className="h-3.5 w-3.5" />
              {sendInvitationMutation.isPending ? "Sending..." : "Send Invitation"}
            </button>
          </div>

          {invitationSent && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <p className="text-sm text-green-800">Invitation sent successfully to candidate and panelists.</p>
            </div>
          )}

          {sendInvitationMutation.isError && (
            <p className="text-sm text-red-600">
              {(sendInvitationMutation.error as any)?.response?.data?.error?.message || "Failed to send invitation."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Links Section
// ---------------------------------------------------------------------------
function CalendarLinksSection({ interviewId }: { interviewId: string }) {
  const { data: calendarLinks, isLoading } = useQuery({
    queryKey: ["calendar-links", interviewId],
    queryFn: async () => {
      const res = await apiGet<{ google: string; outlook: string; office365: string }>(
        `/interviews/${interviewId}/calendar-links`,
      );
      return res.data!;
    },
  });

  if (isLoading || !calendarLinks) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <Calendar className="h-5 w-5 text-gray-400" /> Add to Calendar
      </h3>
      <div className="flex flex-wrap gap-2">
        <a
          href={calendarLinks.google}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Google Calendar
        </a>
        <a
          href={calendarLinks.outlook}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Outlook
        </a>
        <a
          href={calendarLinks.office365}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
        >
          <Calendar className="h-4 w-4" />
          Office 365
        </a>
        <a
          href={`/api/v1/interviews/${interviewId}/calendar.ics`}
          download
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <Download className="h-4 w-4" />
          Download .ics
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recording Section
// ---------------------------------------------------------------------------
function RecordingSection({ interviewId }: { interviewId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const { data: recordings = [] } = useQuery({
    queryKey: ["recordings", interviewId],
    queryFn: async () => {
      const res = await apiGet<Recording[]>(`/interviews/${interviewId}/recordings`);
      return res.data || [];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("recording", file);
      setUploadProgress(0);

      const res = await api.post(`/interviews/${interviewId}/recordings`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) {
            setUploadProgress(Math.round((e.loaded * 100) / e.total));
          }
        },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings", interviewId] });
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: () => {
      setUploadProgress(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (recId: string) => {
      return apiDelete(`/interviews/${interviewId}/recordings/${recId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recordings", interviewId] });
      queryClient.invalidateQueries({ queryKey: ["transcript", interviewId] });
    },
  });
  const [recToDelete, setRecToDelete] = useState<string | null>(null);

  const transcribeMutation = useMutation({
    mutationFn: async (recId: string) => {
      return apiPost(`/interviews/${interviewId}/recordings/${recId}/transcribe`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transcript", interviewId] });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Mic className="h-5 w-5 text-gray-400" /> Recordings ({recordings.length})
        </h3>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            <Upload className="h-4 w-4" />
            {uploadMutation.isPending ? "Uploading..." : "Upload Recording"}
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
            <span>Uploading...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-brand-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {uploadMutation.isError && (
        <p className="text-sm text-red-600 mb-3">
          {(uploadMutation.error as any)?.response?.data?.error?.message || "Failed to upload recording."}
        </p>
      )}

      {recordings.length === 0 && uploadProgress === null && (
        <p className="text-sm text-gray-500">No recordings uploaded yet.</p>
      )}

      {recordings.length > 0 && (
        <div className="divide-y divide-gray-100">
          {recordings.map((rec) => {
            const fileName = rec.file_path.split("/").pop() || "recording";
            return (
              <div key={rec.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50">
                    {rec.mime_type?.startsWith("video/") ? (
                      <Video className="h-4 w-4 text-purple-600" />
                    ) : (
                      <Mic className="h-4 w-4 text-purple-600" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 truncate max-w-xs">{fileName}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(rec.file_size)}
                      {rec.duration_seconds ? ` \u00b7 ${Math.floor(rec.duration_seconds / 60)}m ${rec.duration_seconds % 60}s` : ""}
                      {" \u00b7 "}
                      {formatDate(rec.uploaded_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => transcribeMutation.mutate(rec.id)}
                    disabled={transcribeMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {transcribeMutation.isPending ? "Generating..." : "Generate Transcript"}
                  </button>
                  <button
                    onClick={() => setRecToDelete(rec.id)}
                    disabled={deleteMutation.isPending}
                    className="inline-flex items-center rounded-md border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={recToDelete !== null}
        variant="danger"
        title="Delete this recording?"
        message="This permanently removes the recording (and any transcript generated from it). This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (recToDelete) {
            deleteMutation.mutate(recToDelete, { onSettled: () => setRecToDelete(null) });
          }
        }}
        onCancel={() => setRecToDelete(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript Section
// ---------------------------------------------------------------------------
function TranscriptSection({ interviewId }: { interviewId: string }) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<string>("");
  const [summaryInitialized, setSummaryInitialized] = useState(false);
  const [saveSummarySuccess, setSaveSummarySuccess] = useState(false);

  const { data: transcript } = useQuery({
    queryKey: ["transcript", interviewId],
    queryFn: async () => {
      const res = await apiGet<Transcript | null>(`/interviews/${interviewId}/transcript`);
      return res.data ?? null;
    },
  });

  // Initialize summary from fetched transcript
  if (transcript && !summaryInitialized) {
    setSummary(transcript.summary || "");
    setSummaryInitialized(true);
  }

  const saveSummaryMutation = useMutation({
    mutationFn: async () => {
      if (!transcript) return;
      return apiPut(`/interviews/${interviewId}/transcript/${transcript.id}`, { summary });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transcript", interviewId] });
      setSaveSummarySuccess(true);
      setTimeout(() => setSaveSummarySuccess(false), 3000);
    },
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <FileText className="h-5 w-5 text-gray-400" /> Transcript
      </h3>

      {!transcript ? (
        <p className="text-sm text-gray-500">
          Upload a recording and generate a transcript to view it here.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Status badge */}
          {transcript.status !== "completed" && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                transcript.status === "processing"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-red-100 text-red-800",
              )}
            >
              {transcript.status}
            </span>
          )}

          {/* Transcript content */}
          <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
              {transcript.content}
            </pre>
          </div>

          {transcript.generated_at && (
            <p className="text-xs text-gray-400">
              Generated {formatDate(transcript.generated_at)}
            </p>
          )}

          {/* Summary section */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Summary (HR notes)
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Add a summary of the interview transcript..."
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => saveSummaryMutation.mutate()}
                disabled={saveSummaryMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {saveSummaryMutation.isPending ? "Saving..." : "Save Summary"}
              </button>
              {saveSummarySuccess && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" /> Saved
                </span>
              )}
              {saveSummaryMutation.isError && (
                <span className="text-sm text-red-600">Failed to save summary.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function InterviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const { data: interview, isLoading, isError } = useQuery({
    queryKey: ["interview", id],
    queryFn: async () => {
      const res = await apiGet<InterviewDetail>(`/interviews/${id}`);
      return res.data!;
    },
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: InterviewStatus) => {
      await apiPatch(`/interviews/${id}/status`, { status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["interview", id] }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        Loading interview details...
      </div>
    );
  }

  if (isError || !interview) {
    return (
      <div className="flex h-64 items-center justify-center text-red-500">
        Failed to load interview details.
      </div>
    );
  }

  const currentUserId = user?.empcloudUserId;
  const isPanelist = interview.panelists.some((p) => p.user_id === currentUserId);
  const hasSubmittedFeedback = interview.feedback.some((f) => f.panelist_id === currentUserId);
  const showFeedbackForm = isPanelist && !hasSubmittedFeedback;

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <button
          onClick={() => navigate("/interviews")}
          className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Interviews
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{interview.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {interview.candidate_name} &mdash; {interview.job_title}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium capitalize",
              STATUS_COLORS[interview.status] || "bg-gray-100 text-gray-800",
            )}
          >
            {interview.status.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Calendar className="h-4 w-4" /> Schedule
          </div>
          <p className="text-sm font-medium text-gray-900">{formatDate(interview.scheduled_at)}</p>
          <p className="text-xs text-gray-500">{formatTime(interview.scheduled_at)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Clock className="h-4 w-4" /> Duration
          </div>
          <p className="text-sm font-medium text-gray-900">{interview.duration_minutes} minutes</p>
          <p className="text-xs text-gray-500 capitalize">{interview.type} &middot; Round {interview.round}</p>
        </div>
        {interview.location && (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <MapPin className="h-4 w-4" /> Location
            </div>
            <p className="text-sm font-medium text-gray-900">{interview.location}</p>
          </div>
        )}
        {interview.meeting_link && (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <ExternalLink className="h-4 w-4" /> Meeting Link
            </div>
            <a
              href={interview.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-brand-600 hover:text-brand-800 break-all"
            >
              Join Meeting
            </a>
          </div>
        )}
      </div>

      {/* Status actions */}
      {interview.status !== "completed" && interview.status !== "cancelled" && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">Change status:</span>
          {(["in_progress", "completed", "cancelled", "no_show"] as InterviewStatus[])
            .filter((s) => s !== interview.status)
            .map((status) => (
              <button
                key={status}
                onClick={() => statusMutation.mutate(status)}
                disabled={statusMutation.isPending}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 capitalize disabled:opacity-50"
              >
                {status.replace("_", " ")}
              </button>
            ))}
        </div>
      )}

      {/* Meeting Link Section */}
      <MeetingLinkSection interview={interview} />

      {/* Calendar Links Section */}
      <CalendarLinksSection interviewId={interview.id} />

      {/* Notes */}
      {interview.notes && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Notes</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{interview.notes}</p>
        </div>
      )}

      {/* Panelists */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-400" /> Panelists ({interview.panelists.length})
          </h2>
        </div>
        <div className="divide-y divide-gray-100">
          {interview.panelists.length === 0 && (
            <p className="px-6 py-4 text-sm text-gray-500">No panelists assigned yet.</p>
          )}
          {interview.panelists.map((panelist) => {
            const fb = interview.feedback.find((f) => f.panelist_id === panelist.user_id);
            return (
              <div key={panelist.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
                    {panelist.user_id}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      User #{panelist.user_id}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">{panelist.role}</p>
                  </div>
                </div>
                <div>
                  {fb ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      Feedback submitted
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recording Section */}
      <RecordingSection interviewId={interview.id} />

      {/* Transcript Section */}
      <TranscriptSection interviewId={interview.id} />

      {/* Feedback form (if current user is panelist and hasn't submitted) */}
      {showFeedbackForm && (
        <InlineFeedbackForm
          interviewId={interview.id}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["interview", id] })}
        />
      )}

      {/* Submitted feedback */}
      {interview.feedback.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Submitted Feedback ({interview.feedback.length})
          </h2>
          {interview.feedback.map((fb) => {
            const RecIcon = RECOMMENDATION_ICONS[fb.recommendation] || Star;
            return (
              <div
                key={fb.id}
                className="rounded-lg border border-gray-200 bg-white p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                      {fb.panelist_id}
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      Panelist #{fb.panelist_id}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                      RECOMMENDATION_COLORS[fb.recommendation] || "bg-gray-50 text-gray-600",
                    )}
                  >
                    <RecIcon className="h-3 w-3" />
                    {fb.recommendation.replace("_", " ")}
                  </span>
                </div>

                {/* Scores */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {fb.overall_score != null && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Overall</p>
                      <StarRating value={fb.overall_score} />
                    </div>
                  )}
                  {fb.technical_score != null && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Technical</p>
                      <StarRating value={fb.technical_score} />
                    </div>
                  )}
                  {fb.communication_score != null && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Communication</p>
                      <StarRating value={fb.communication_score} />
                    </div>
                  )}
                  {fb.cultural_fit_score != null && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Cultural Fit</p>
                      <StarRating value={fb.cultural_fit_score} />
                    </div>
                  )}
                </div>

                {/* Text feedback */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {fb.strengths && (
                    <div>
                      <p className="text-xs font-medium text-green-700 mb-0.5">Strengths</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{fb.strengths}</p>
                    </div>
                  )}
                  {fb.weaknesses && (
                    <div>
                      <p className="text-xs font-medium text-red-700 mb-0.5">Weaknesses</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{fb.weaknesses}</p>
                    </div>
                  )}
                </div>

                {fb.notes && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-0.5">Notes</p>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{fb.notes}</p>
                  </div>
                )}

                <p className="text-xs text-gray-400">
                  Submitted {formatDate(fb.submitted_at)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Link to standalone feedback form */}
      {showFeedbackForm && (
        <div className="text-center">
          <Link
            to={`/interviews/${interview.id}/feedback`}
            className="text-sm text-brand-600 hover:text-brand-800 font-medium"
          >
            Open full feedback form in a new page
          </Link>
        </div>
      )}
    </div>
  );
}
