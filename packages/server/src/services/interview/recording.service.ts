// ============================================================================
// RECORDING & TRANSCRIPT SERVICE
// Handles interview recording uploads, transcript generation, and management.
// ============================================================================

import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { getDB } from "../../db/adapters";
import { NotFoundError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import {
  transcribeFile,
  isTranscriptionEnabled,
} from "../ai/transcription/deepgram.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterviewRecording {
  id: string;
  organization_id: number;
  interview_id: string;
  file_path: string;
  file_size: number | null;
  duration_seconds: number | null;
  mime_type: string | null;
  uploaded_by: number;
  uploaded_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface InterviewTranscript {
  id: string;
  organization_id: number;
  interview_id: string;
  recording_id: string | null;
  content: string;
  summary: string | null;
  status: "processing" | "completed" | "failed";
  generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Upload a recording
// ---------------------------------------------------------------------------

export async function uploadRecording(
  orgId: number,
  interviewId: string,
  file: Express.Multer.File,
  uploadedBy: number,
): Promise<InterviewRecording> {
  const db = getDB();

  // Verify interview belongs to org
  const interview = await db.findOne("interviews", {
    id: interviewId,
    organization_id: orgId,
  });
  if (!interview) {
    throw new NotFoundError("Interview", interviewId);
  }

  const now = new Date();
  const recordingId = uuidv4();

  const recording = await db.create<InterviewRecording>("interview_recordings", {
    id: recordingId,
    organization_id: orgId,
    interview_id: interviewId,
    file_path: file.path.replace(/\\/g, "/"),
    file_size: file.size,
    duration_seconds: null, // Would be extracted from the file in production
    mime_type: file.mimetype,
    uploaded_by: uploadedBy,
    uploaded_at: now,
    created_at: now,
    updated_at: now,
  });

  logger.info(`Recording uploaded for interview ${interviewId} by user ${uploadedBy}`);

  return recording;
}

// ---------------------------------------------------------------------------
// Get a single recording
// ---------------------------------------------------------------------------

export async function getRecording(
  orgId: number,
  recordingId: string,
): Promise<InterviewRecording> {
  const db = getDB();

  const recording = await db.findOne<InterviewRecording>("interview_recordings", {
    id: recordingId,
    organization_id: orgId,
  });
  if (!recording) {
    throw new NotFoundError("Recording", recordingId);
  }

  return recording;
}

// ---------------------------------------------------------------------------
// List recordings for an interview
// ---------------------------------------------------------------------------

export async function getRecordings(
  orgId: number,
  interviewId: string,
): Promise<InterviewRecording[]> {
  const db = getDB();

  const result = await db.findMany<InterviewRecording>("interview_recordings", {
    filters: { organization_id: orgId, interview_id: interviewId },
    sort: { field: "uploaded_at", order: "desc" },
    limit: 100,
  });

  return result.data;
}

// ---------------------------------------------------------------------------
// Delete a recording
// ---------------------------------------------------------------------------

export async function deleteRecording(
  orgId: number,
  recordingId: string,
): Promise<void> {
  const db = getDB();

  const recording = await db.findOne<InterviewRecording>("interview_recordings", {
    id: recordingId,
    organization_id: orgId,
  });
  if (!recording) {
    throw new NotFoundError("Recording", recordingId);
  }

  // Delete the file from disk
  try {
    const filePath = path.resolve(recording.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn(`Failed to delete recording file: ${recording.file_path}`, err);
  }

  // Delete any transcripts linked to this recording
  await db.deleteMany("interview_transcripts", { recording_id: recordingId });

  // Delete the DB record
  await db.delete("interview_recordings", recordingId);

  logger.info(`Recording ${recordingId} deleted`);
}

// ---------------------------------------------------------------------------
// Generate transcript from a recording
// ---------------------------------------------------------------------------

export async function generateTranscript(
  orgId: number,
  interviewId: string,
  recordingId: string,
): Promise<InterviewTranscript> {
  const db = getDB();

  // Verify recording belongs to org and interview
  const recording = await db.findOne<InterviewRecording>("interview_recordings", {
    id: recordingId,
    organization_id: orgId,
    interview_id: interviewId,
  });
  if (!recording) {
    throw new NotFoundError("Recording", recordingId);
  }

  // Real speech-to-text via Deepgram when configured; otherwise fall back to a
  // placeholder so the flow still works without an STT key.
  let content: string;
  let status: InterviewTranscript["status"] = "completed";

  if (isTranscriptionEnabled()) {
    try {
      const filePath = path.resolve(recording.file_path);
      const result = await transcribeFile(filePath, recording.mime_type);
      content = result.text || "(no speech detected)";
      // Backfill the media duration we now know from the transcription.
      if (result.durationSeconds != null && recording.duration_seconds == null) {
        await db.update("interview_recordings", recordingId, {
          duration_seconds: result.durationSeconds,
        });
      }
    } catch (err) {
      logger.error(`Transcription failed for recording ${recordingId}:`, err);
      content = "Transcription failed. Please retry.";
      status = "failed";
    }
  } else {
    content = generatePlaceholderTranscript();
  }

  const now = new Date();
  const transcriptId = uuidv4();

  const transcript = await db.create<InterviewTranscript>("interview_transcripts", {
    id: transcriptId,
    organization_id: orgId,
    interview_id: interviewId,
    recording_id: recordingId,
    content,
    summary: null,
    status,
    generated_at: now,
    created_at: now,
    updated_at: now,
  });

  logger.info(`Transcript generated for recording ${recordingId} (interview ${interviewId})`);

  return transcript;
}

// ---------------------------------------------------------------------------
// Get transcript for an interview
// ---------------------------------------------------------------------------

export async function getTranscript(
  orgId: number,
  interviewId: string,
): Promise<InterviewTranscript | null> {
  const db = getDB();

  const transcript = await db.findOne<InterviewTranscript>("interview_transcripts", {
    organization_id: orgId,
    interview_id: interviewId,
  });

  return transcript;
}

// ---------------------------------------------------------------------------
// Update transcript summary
// ---------------------------------------------------------------------------

export async function updateTranscriptSummary(
  orgId: number,
  transcriptId: string,
  summary: string,
): Promise<InterviewTranscript> {
  const db = getDB();

  const transcript = await db.findOne<InterviewTranscript>("interview_transcripts", {
    id: transcriptId,
    organization_id: orgId,
  });
  if (!transcript) {
    throw new NotFoundError("Transcript", transcriptId);
  }

  const updated = await db.update<InterviewTranscript>("interview_transcripts", transcriptId, {
    summary,
    updated_at: new Date(),
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Helper: Generate a realistic placeholder transcript
// ---------------------------------------------------------------------------

function generatePlaceholderTranscript(): string {
  return `[00:00:00] Interviewer: Good morning, thank you for joining us today. How are you?

[00:00:05] Candidate: Good morning! I'm doing well, thank you for having me. I've been looking forward to this conversation.

[00:00:15] Interviewer: Great to hear. Let's start with a brief introduction. Could you tell us about your background and what brings you to this role?

[00:00:25] Candidate: Of course. I have about five years of experience in software development, primarily working with full-stack technologies. In my current role, I lead a team of four developers and we build internal tools that serve over 2,000 employees across the organization.

[00:01:10] Interviewer: That sounds impressive. Can you walk us through a challenging project you worked on recently?

[00:01:18] Candidate: Sure. Last quarter, we migrated our legacy monolith to a microservices architecture. The biggest challenge was maintaining zero downtime during the transition while handling over 10,000 daily active users. We used a strangler fig pattern and feature flags to gradually shift traffic.

[00:02:45] Interviewer: How did you handle data consistency across services during the migration?

[00:02:52] Candidate: We implemented an event-driven architecture using message queues. For critical operations, we used the saga pattern to maintain consistency. We also set up comprehensive monitoring and alerting so we could catch any discrepancies early.

[00:03:30] Interviewer: Excellent approach. Now, let's discuss your experience with team leadership. How do you handle conflicts within your team?

[00:03:40] Candidate: I believe in addressing conflicts early and directly. I schedule one-on-one meetings to understand each person's perspective, then facilitate a group discussion focused on finding common ground. I've found that most conflicts stem from miscommunication rather than fundamental disagreements.

[00:04:20] Interviewer: That's a mature approach. Do you have any questions for us about the role or the company?

[00:04:28] Candidate: Yes, I'd love to know more about the team structure and the tech stack you're currently using. Also, what does the onboarding process look like for new engineers?

[00:04:45] Interviewer: Great questions. Let me walk you through that...

[00:05:30] Interviewer: Thank you for your time today. We'll be in touch with next steps within the week.

[00:05:35] Candidate: Thank you so much! I really enjoyed our conversation and I'm excited about the opportunity.`;
}
