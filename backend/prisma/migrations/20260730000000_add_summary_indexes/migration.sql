-- CreateIndex
CREATE INDEX "Summary_meetingId_idx" ON "Summary"("meetingId");

-- CreateIndex
CREATE INDEX "Summary_transcriptId_idx" ON "Summary"("transcriptId");

-- CreateIndex
CREATE INDEX "Summary_requestedById_idx" ON "Summary"("requestedById");
