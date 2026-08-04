const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaptionFeature } = require('../features/caption');

function mockSocket(id, io) {
  const events = {};
  const emitted = [];
  const rooms = new Set();
  return {
    id,
    userId: null,
    meetingId: null,
    sessionStartedAt: null,
    currentStatus: null,
    _emitted: emitted,
    _rooms: rooms,
    emit(event, data) { emitted.push({ event, data }); },
    to(room) {
      return {
        emit(event, data) {
          emitted.push({ event, data, to: room });
        }
      };
    },
    join(room) { rooms.add(room); },
    leave(room) {
      rooms.delete(room);
      if (io) {
        const ioRoom = io.sockets.adapter.rooms.get(room);
        if (ioRoom) ioRoom.delete(this.id);
      }
    },
    on(event, handler) { events[event] = handler; },
    async _trigger(event, ...args) { const h = events[event]; if (h) await h(...args); }
  };
}

function mockIo() {
  const rooms = new Map();
  const allEmitted = [];
  return {
    sockets: {
      adapter: {
        rooms: {
          get(id) { return rooms.get(id) || null; },
          _set(id, set) { rooms.set(id, set); }
        }
      }
    },
    to(room) {
      return {
        emit(event, data) {
          allEmitted.push({ event, data, to: room });
        }
      };
    },
    _allEmitted: allEmitted
  };
}

function mockPrisma(meetingData, segments) {
  const calls = {
    upsert: null,
    createSegment: null,
    updateTranscript: null,
    findUnique: null
  };
  return {
    _calls: calls,
    transcript: {
      upsert: async (args) => {
        calls.upsert = args;
        return { id: 'tx-1', ...args.create };
      },
      update: async (args) => {
        calls.updateTranscript = args;
      }
    },
    transcriptSegment: {
      create: async (args) => {
        calls.createSegment = args;
        return { id: 'seg-1', ...args.data, createdAt: new Date('2026-01-01T01:00:02Z'), sessionStartedAt: args.data.sessionStartedAt };
      },
      findMany: async () => segments || []
    },
    meeting: {
      findUnique: async (args) => {
        calls.findUnique = args;
        return meetingData;
      }
    }
  };
}

// ── Caption Broadcast ──────────────────────────────────────────

test('broadcasts successful caption with correct payload fields', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const prisma = mockPrisma({ id: 'meeting-1' });

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.sessionStartedAt = new Date('2026-01-01T01:00:00Z');
  socket.currentStatus = { displayName: 'Alice' };
  registerSocketHandlers(socket);

  await socket._trigger('caption', {
    meetingId: 'meeting-1',
    speakerId: 'speaker-1',
    text: 'Hello world',
    start: 0,
    end: 2,
    utteranceId: 'utt-1',
    isFinal: true
  });

  // Caption broadcast is via io.to, not socket
  const broadcast = io._allEmitted.find(e => e.event === 'caption');
  assert.ok(broadcast, 'caption should be broadcast');
  assert.equal(broadcast.data.captionId, 'seg-1');
  assert.equal(broadcast.data.speakerName, 'Alice');
  assert.equal(broadcast.data.text, 'Hello world');
  assert.equal(broadcast.data.utteranceId, 'utt-1');
  assert.ok(broadcast.data.sessionStartedAt);
  assert.ok(broadcast.data.createdAt);
  assert.equal(broadcast.to, 'meeting-1');
});

test('persists transcript segment via Prisma', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const prisma = mockPrisma({ id: 'meeting-1' });

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.sessionStartedAt = new Date('2026-01-01T01:00:00Z');
  socket.currentStatus = { displayName: 'Speaker' };
  registerSocketHandlers(socket);

  await socket._trigger('caption', {
    meetingId: 'meeting-1',
    speakerId: 'speaker-1',
    text: 'Test content',
    start: 5,
    end: 8,
    utteranceId: 'utt-1',
    isFinal: true
  });

  // Verify transcript upsert
  assert.ok(prisma._calls.upsert);
  assert.equal(prisma._calls.upsert.where.meetingId_ownerUserId.meetingId, 'meeting-1');
  assert.equal(prisma._calls.upsert.where.meetingId_ownerUserId.ownerUserId, 'speaker-1');

  // Verify segment creation
  assert.ok(prisma._calls.createSegment);
  assert.equal(prisma._calls.createSegment.data.transcriptId, 'tx-1');
  assert.equal(prisma._calls.createSegment.data.text, 'Test content');
  assert.equal(prisma._calls.createSegment.data.start, 5);
  assert.equal(prisma._calls.createSegment.data.end, 8);

  // Verify duration increment
  assert.ok(prisma._calls.updateTranscript);
  assert.equal(prisma._calls.updateTranscript.data.durationSec.increment, 3);
});

// ── Partial Caption Rejection ──────────────────────────────────

test('rejects partial (non-final) captions', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const prisma = mockPrisma();

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);

  await socket._trigger('caption', {
    meetingId: 'meeting-1',
    speakerId: 'speaker-1',
    text: 'partial text...',
    start: 0,
    end: 1,
    utteranceId: 'utt-1',
    isFinal: false
  });

  const rejection = socket._emitted.find(e => e.event === 'caption-rejected');
  assert.ok(rejection);
  assert.equal(rejection.data.reason, 'partial-caption-not-persisted');
  assert.equal(rejection.data.utteranceId, 'utt-1');

  // Should not have persisted anything
  assert.equal(prisma._calls.upsert, null);
});

// ── Idempotency ────────────────────────────────────────────────

test('suppresses duplicate captions via idempotency key', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const prisma = mockPrisma({ id: 'meeting-1' });

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.sessionStartedAt = new Date('2026-01-01T01:00:00Z');
  socket.currentStatus = { displayName: 'Speaker' };
  registerSocketHandlers(socket);

  // First caption
  await socket._trigger('caption', {
    meetingId: 'meeting-1', speakerId: 'speaker-1', text: 'First',
    start: 0, end: 1, utteranceId: 'utt-1', isFinal: true
  });

  const firstBroadcastCount = io._allEmitted.filter(e => e.event === 'caption').length;

  // Duplicate caption with same utteranceId
  io._allEmitted.length = 0; // reset
  await socket._trigger('caption', {
    meetingId: 'meeting-1', speakerId: 'speaker-1', text: 'First',
    start: 0, end: 1, utteranceId: 'utt-1', isFinal: true
  });

  const secondBroadcastCount = io._allEmitted.filter(e => e.event === 'caption').length;
  assert.equal(secondBroadcastCount, 0, 'duplicate should be suppressed');

  // But a different utteranceId should go through
  io._allEmitted.length = 0;
  await socket._trigger('caption', {
    meetingId: 'meeting-1', speakerId: 'speaker-1', text: 'Second',
    start: 1, end: 2, utteranceId: 'utt-2', isFinal: true
  });

  assert.ok(io._allEmitted.some(e => e.event === 'caption'), 'new utterance should broadcast');
});

// ── Write Failure Rollback ─────────────────────────────────────

test('deletes idempotency key on persistence failure', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const prisma = mockPrisma();
  prisma.transcript.upsert = async () => { throw new Error('DB connection lost'); };

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.sessionStartedAt = new Date('2026-01-01T01:00:00Z');
  socket.currentStatus = { displayName: 'Speaker' };
  registerSocketHandlers(socket);

  assert.equal(persistedCaptionKeys.size, 0);

  await socket._trigger('caption', {
    meetingId: 'meeting-1', speakerId: 'speaker-1', text: 'Lost',
    start: 0, end: 1, utteranceId: 'utt-fail', isFinal: true
  });

  // Key should have been set then rolled back
  assert.equal(persistedCaptionKeys.size, 0, 'key should be deleted on failure');
});

// ── Room-Key Purging ───────────────────────────────────────────

test('purges all keys for a meeting prefix', () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  persistedCaptionKeys.set('meeting-A:speaker-1:utt-1', Date.now());
  persistedCaptionKeys.set('meeting-A:speaker-2:utt-2', Date.now());
  persistedCaptionKeys.set('meeting-B:speaker-1:utt-1', Date.now());

  const { purgeCaptionKeys } = createCaptionFeature({
    prisma: mockPrisma(), io, persistedCaptionKeys,
    resolveSessionStart: () => new Date()
  });

  purgeCaptionKeys('meeting-A');

  assert.equal(persistedCaptionKeys.size, 1);
  assert.ok(persistedCaptionKeys.has('meeting-B:speaker-1:utt-1'));
  assert.ok(!persistedCaptionKeys.has('meeting-A:speaker-1:utt-1'));
});

// ── Caption History Authorization ──────────────────────────────

test('caption history rejects unauthorized requests', async () => {
  const io = mockIo();
  const prisma = mockPrisma();
  const persistedCaptionKeys = new Map();

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: () => new Date()
  });

  const socket = mockSocket('socket-1', io);
  // socket not joined to any meeting
  registerSocketHandlers(socket);

  const responses = [];
  await socket._trigger('get-caption-history', { meetingId: 'meeting-1' }, (resp) => {
    responses.push(resp);
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /Join the meeting/);
});

// ── Caption History Success ────────────────────────────────────

test('caption history returns paginated results', async () => {
  const io = mockIo();
  const persistedCaptionKeys = new Map();
  const meeting = {
    id: 'meeting-1',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  };
  const prisma = mockPrisma(meeting, []);

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: (m) => m.sessionStartedAt || m.startedAt
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.join('meeting-1');
  io.sockets.adapter.rooms._set('meeting-1', new Set(['socket-1']));
  registerSocketHandlers(socket);

  const responses = [];
  await socket._trigger('get-caption-history', {
    meetingId: 'meeting-1',
    cursor: null,
    limit: 50
  }, (resp) => {
    responses.push(resp);
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[0].meetingId, 'meeting-1');
  assert.ok(responses[0].sessionStartedAt);
  assert.ok(Array.isArray(responses[0].captions));
});

test('caption history returns error when meeting not found', async () => {
  const io = mockIo();
  const prisma = mockPrisma(null, []); // null meeting
  const persistedCaptionKeys = new Map();

  const { registerSocketHandlers } = createCaptionFeature({
    prisma, io, persistedCaptionKeys,
    resolveSessionStart: () => new Date()
  });

  const socket = mockSocket('socket-1', io);
  socket.meetingId = 'meeting-1';
  socket.join('meeting-1');
  io.sockets.adapter.rooms._set('meeting-1', new Set(['socket-1']));
  registerSocketHandlers(socket);

  const responses = [];
  await socket._trigger('get-caption-history', {
    meetingId: 'meeting-1'
  }, (resp) => {
    responses.push(resp);
  });

  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /Meeting not found/);
});
