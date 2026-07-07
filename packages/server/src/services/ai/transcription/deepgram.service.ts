// ============================================================================
// DEEPGRAM TRANSCRIPTION
// ============================================================================
// Real speech-to-text for interview recordings via Deepgram's prerecorded API,
// with speaker diarization (who-said-what). Raw fetch — no SDK dependency.
// Configured via config.ai.transcription.deepgram.
// ============================================================================

import fs from "fs";
import { config } from "../../../config";
import { AppError } from "../../../utils/errors";
import { logger } from "../../../utils/logger";

export interface TranscriptionResult {
  text: string;
  durationSeconds: number | null;
}

export function isTranscriptionEnabled(): boolean {
  return (
    config.ai.transcription.provider === "deepgram" &&
    !!config.ai.transcription.deepgram.apiKey
  );
}

/**
 * Transcribe an audio/video file with Deepgram. Returns diarized text
 * ("Speaker 0: …") plus the media duration.
 */
export async function transcribeFile(
  filePath: string,
  mimeType: string | null,
): Promise<TranscriptionResult> {
  if (!isTranscriptionEnabled()) {
    throw new AppError(400, "STT_DISABLED", "No speech-to-text provider is configured");
  }

  const audio = await fs.promises.readFile(filePath);
  const params = new URLSearchParams({
    model: config.ai.transcription.deepgram.model,
    smart_format: "true",
    diarize: "true",
    punctuate: "true",
    paragraphs: "true",
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.ai.transcription.deepgram.apiKey}`,
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: audio,
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError(502, "STT_ERROR", json?.err_msg || json?.reason || `Transcription failed (${res.status})`);
  }

  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const durationSeconds = json?.metadata?.duration
    ? Math.round(json.metadata.duration)
    : null;

  const text = formatDiarized(alt) || alt?.transcript || "";
  logger.info(`Deepgram transcription complete (${durationSeconds ?? "?"}s)`);
  return { text, durationSeconds };
}

/** Build "Speaker N: …" paragraphs when diarization data is present. */
function formatDiarized(alt: any): string {
  const paragraphs = alt?.paragraphs?.paragraphs;
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return "";
  return paragraphs
    .map((p: any) => {
      const speaker = typeof p.speaker === "number" ? `Speaker ${p.speaker}` : "Speaker";
      const sentences = (p.sentences ?? []).map((s: any) => s.text).join(" ");
      return `${speaker}: ${sentences}`;
    })
    .join("\n\n");
}
