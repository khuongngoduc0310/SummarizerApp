const DEFAULT_CAPTION_PAGE_SIZE = 200;
const MAX_CAPTION_PAGE_SIZE = 200;

class CaptionHistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptionHistoryError';
  }
}

function encodeCaptionCursor(segment) {
  return Buffer.from(JSON.stringify({
    createdAt: segment.createdAt.toISOString(),
    id: segment.id
  })).toString('base64url');
}

function decodeCaptionCursor(cursor) {
  if (!cursor) return null;
  if (typeof cursor !== 'string' || cursor.length > 500) {
    throw new CaptionHistoryError('Invalid caption history cursor.');
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);
    if (!parsed.id || typeof parsed.id !== 'string' || Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid cursor fields');
    }
    return { id: parsed.id, createdAt };
  } catch {
    throw new CaptionHistoryError('Invalid caption history cursor.');
  }
}

function normalizeCaptionSegment(segment, meetingId) {
  return {
    captionId: segment.id,
    meetingId,
    speakerId: segment.speakerId,
    speakerName: segment.transcript.owner.displayName,
    text: segment.text,
    start: segment.start,
    end: segment.end,
    isFinal: true,
    createdAt: segment.createdAt.toISOString()
  };
}

async function getCaptionHistoryPage(prisma, { meetingId, sessionStartedAt, cursor, limit }) {
  const sessionStart = new Date(sessionStartedAt);
  if (!meetingId || Number.isNaN(sessionStart.getTime())) {
    throw new CaptionHistoryError('Invalid caption history request.');
  }

  const decodedCursor = decodeCaptionCursor(cursor);
  const pageSize = Math.min(
    Math.max(Number.parseInt(limit, 10) || DEFAULT_CAPTION_PAGE_SIZE, 1),
    MAX_CAPTION_PAGE_SIZE
  );

  const segments = await prisma.transcriptSegment.findMany({
    where: {
      transcript: { meetingId },
      sessionStartedAt: sessionStart,
      ...(decodedCursor ? {
        OR: [
          { createdAt: { lt: decodedCursor.createdAt } },
          { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.id } }
        ]
      } : {})
    },
    include: {
      transcript: {
        include: { owner: true }
      }
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }
    ],
    take: pageSize + 1
  });

  const hasMore = segments.length > pageSize;
  const page = segments.slice(0, pageSize);

  return {
    captions: page.slice().reverse().map((segment) => normalizeCaptionSegment(segment, meetingId)),
    nextCursor: hasMore && page.length > 0 ? encodeCaptionCursor(page[page.length - 1]) : null,
    hasMore
  };
}

module.exports = {
  CaptionHistoryError,
  DEFAULT_CAPTION_PAGE_SIZE,
  MAX_CAPTION_PAGE_SIZE,
  decodeCaptionCursor,
  encodeCaptionCursor,
  getCaptionHistoryPage,
  normalizeCaptionSegment
};
