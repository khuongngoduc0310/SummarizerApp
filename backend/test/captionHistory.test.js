const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CaptionHistoryError,
  decodeCaptionCursor,
  getCaptionHistoryPage
} = require('../captionHistory');

const makeSegment = (id, createdAt, speakerName = 'Speaker') => ({
  id,
  speakerId: `speaker-${id}`,
  text: `Caption ${id}`,
  start: 1,
  end: 2,
  createdAt: new Date(createdAt),
  transcript: { owner: { displayName: speakerName } }
});

test('returns the newest page in chronological order with a cursor', async () => {
  const calls = [];
  const rows = [
    makeSegment('c', '2026-07-28T12:00:03.000Z'),
    makeSegment('b', '2026-07-28T12:00:02.000Z'),
    makeSegment('a', '2026-07-28T12:00:01.000Z')
  ];
  const prisma = {
    transcriptSegment: {
      findMany: async (args) => {
        calls.push(args);
        return rows;
      }
    }
  };

  const result = await getCaptionHistoryPage(prisma, {
    meetingId: 'meeting-1',
    sessionStartedAt: '2026-07-28T12:00:00.000Z',
    limit: 2
  });

  assert.deepEqual(result.captions.map((caption) => caption.captionId), ['b', 'c']);
  assert.equal(result.captions[0].speakerName, 'Speaker');
  assert.equal(result.hasMore, true);
  assert.deepEqual(decodeCaptionCursor(result.nextCursor), {
    id: 'b',
    createdAt: new Date('2026-07-28T12:00:02.000Z')
  });
  assert.equal(calls[0].where.transcript.meetingId, 'meeting-1');
  assert.equal(calls[0].where.sessionStartedAt.toISOString(), '2026-07-28T12:00:00.000Z');
  assert.equal(calls[0].take, 3);
});

test('applies timestamp and id cursor bounds', async () => {
  let query;
  const prisma = {
    transcriptSegment: {
      findMany: async (args) => {
        query = args;
        return [];
      }
    }
  };
  const cursor = Buffer.from(JSON.stringify({
    createdAt: '2026-07-28T12:00:02.000Z',
    id: 'segment-b'
  })).toString('base64url');

  await getCaptionHistoryPage(prisma, {
    meetingId: 'meeting-1',
    sessionStartedAt: '2026-07-28T12:00:00.000Z',
    cursor
  });

  assert.deepEqual(query.where.OR, [
    { createdAt: { lt: new Date('2026-07-28T12:00:02.000Z') } },
    { createdAt: new Date('2026-07-28T12:00:02.000Z'), id: { lt: 'segment-b' } }
  ]);
});

test('rejects malformed cursors and invalid sessions', async () => {
  const prisma = { transcriptSegment: { findMany: async () => [] } };

  await assert.rejects(
    getCaptionHistoryPage(prisma, {
      meetingId: 'meeting-1',
      sessionStartedAt: '2026-07-28T12:00:00.000Z',
      cursor: 'not-a-cursor'
    }),
    CaptionHistoryError
  );
  await assert.rejects(
    getCaptionHistoryPage(prisma, { meetingId: 'meeting-1', sessionStartedAt: 'invalid' }),
    CaptionHistoryError
  );
});
