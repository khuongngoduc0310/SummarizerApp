CREATE INDEX "Transcript_meetingId_idx" ON "Transcript"("meetingId");

ALTER TABLE "TranscriptSegment" ADD COLUMN "sessionStartedAt" TIMESTAMP(3);

CREATE INDEX "TranscriptSegment_transcriptId_sessionStartedAt_createdAt_id_idx" ON "TranscriptSegment"("transcriptId", "sessionStartedAt", "createdAt", "id");
