import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Video, AlertCircle } from "lucide-react";
import { apiGet, apiPost } from "@/api/client";
import { loadJitsiApi, type JitsiApi } from "@/lib/jitsi";
import { useAuthStore } from "@/lib/auth-store";
import type { Interview } from "@emp-recruit/shared";

interface RoomToken {
  token: string;
  roomName: string;
  serverUrl: string;
  domain: string;
  expiresAt: string | null;
  provider: string;
}

// ---------------------------------------------------------------------------
// Embedded interview room — HR/panelists join the meeting inside the app.
// Fetches short-lived join credentials from POST /interviews/:id/meeting-token
// and mounts the Jitsi IFrame API into a full-height container.
// ---------------------------------------------------------------------------
export function InterviewRoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);
  const [status, setStatus] = useState<"loading" | "joined" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Interview title for the header (best-effort; failure doesn't block joining).
  const [title, setTitle] = useState<string>("Interview Room");
  useEffect(() => {
    let active = true;
    apiGet<Interview & { title: string }>(`/interviews/${id}`)
      .then((res) => {
        if (active && res.data?.title) setTitle(res.data.title);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let disposed = false;

    async function join() {
      try {
        setStatus("loading");
        const res = await apiPost<RoomToken>(`/interviews/${id}/meeting-token`);
        const room = res.data;
        if (!room) throw new Error("No meeting credentials returned");

        // For JaaS the appId is the first segment of the namespaced room name.
        const appId = room.domain.includes("8x8.vc")
          ? room.roomName.split("/")[0]
          : undefined;
        const JitsiMeetExternalAPI = await loadJitsiApi(room.domain, appId);

        if (disposed || !containerRef.current) return;

        const displayName =
          `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.email || "Interviewer";

        const jitsi = new JitsiMeetExternalAPI(room.domain, {
          roomName: room.roomName,
          jwt: room.token || undefined,
          parentNode: containerRef.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName, email: user?.email },
          configOverwrite: {
            prejoinPageEnabled: true,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableThirdPartyRequests: true,
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
          },
        });

        apiRef.current = jitsi;
        jitsi.addEventListener("videoConferenceJoined", () => {
          if (!disposed) setStatus("joined");
        });
        jitsi.addEventListener("readyToClose", () => {
          navigate(`/interviews/${id}`);
        });
        // If the SDK never fires "joined" (e.g. prejoin), still clear the overlay.
        setStatus("joined");
      } catch (err: unknown) {
        if (disposed) return;
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
            ?.message ||
          (err as Error)?.message ||
          "Failed to join the interview room.";
        setErrorMsg(msg);
        setStatus("error");
      }
    }

    join();
    return () => {
      disposed = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
    // user is read once at mount; re-joining on identity change isn't desired.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[480px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/interviews/${id}`)}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Interview
          </button>
          <span className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-gray-900">
            <Video className="h-4 w-4 text-brand-600" /> {title}
          </span>
        </div>
      </div>

      {/* Video container */}
      <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Connecting to the interview room…</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-red-200 max-w-md">{errorMsg}</p>
            <button
              onClick={() => navigate(`/interviews/${id}`)}
              className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
            >
              Back to interview
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
