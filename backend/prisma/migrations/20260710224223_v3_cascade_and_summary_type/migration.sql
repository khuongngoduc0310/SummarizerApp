-- DropForeignKey
ALTER TABLE "Summary" DROP CONSTRAINT "Summary_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "Summary" DROP CONSTRAINT "Summary_transcriptId_fkey";

-- DropForeignKey
ALTER TABLE "Transcript" DROP CONSTRAINT "Transcript_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "TranscriptSegment" DROP CONSTRAINT "TranscriptSegment_transcriptId_fkey";

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "sessionStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Summary" ADD COLUMN     "timeRangeEnd" DOUBLE PRECISION,
ADD COLUMN     "timeRangeStart" DOUBLE PRECISION,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'full';

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
