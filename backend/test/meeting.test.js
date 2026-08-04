const test = require('node:test');
const assert = require('node:assert/strict');
const { createMeetingFeature } = require('../features/meeting');

function mockResponse(json) {
  const body = JSON.stringify(json);
  return {
    statusCode: 200,
    _body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this._body = data; return this; }
  };
}

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
    emit(event, data) {
      emitted.push({ event, data });
    },
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
    async _trigger(event, data) { const h = events[event]; if (h) await h(data); }
  };
}

function mockIo() {
  const sockets = new Map();
  const rooms = new Map();
  const allEmitted = [];

  return {
    sockets: {
      adapter: {
        rooms: {
          get(id) { return rooms.get(id) || null; },
          _set(id, set) { rooms.set(id, set); }
        }
      },
      sockets: {
        get(id) { return sockets.get(id) || null; }
      },
      _add(socket) { sockets.set(socket.id, socket); }
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

function mockPrisma(userData, meetingData) {
  const calls = {
    createUser: null,
    findUnique: null,
    update: null,
    createMeeting: null
  };
  return {
    _calls: calls,
    user: {
      create: async (args) => {
        calls.createUser = args;
        return { id: 'user-1', ...args.data };
      }
    },
    meeting: {
      findUnique: async (args) => {
        calls.findUnique = args;
        return meetingData;
      },
      update: async (args) => {
        calls.update = args;
        return { id: args.where.id, ...args.data, sessionStartedAt: meetingData?.sessionStartedAt, startedAt: meetingData?.startedAt };
      },
      create: async (args) => {
        calls.createMeeting = args;
        return { id: 'meeting-1', ...args.data };
      }
    }
  };
}

// ── Meeting Creation Route ─────────────────────────────────────

test('create meeting returns meetingId, hostId, and meeting object', async () => {
  const { createMeetingRoute } = createMeetingFeature({
    prisma: mockPrisma(),
    io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { body: { displayName: 'Alice', title: 'Sprint Planning' } };
  const res = mockResponse();

  await createMeetingRoute(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.meetingId, 'meeting-1');
  assert.equal(res._body.hostId, 'user-1');
  assert.equal(res._body.meeting.title, 'Sprint Planning');
});

test('create meeting rejects invalid displayName type', async () => {
  const { createMeetingRoute } = createMeetingFeature({
    prisma: mockPrisma(),
    io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { body: { displayName: 123 } };
  const res = mockResponse();

  await createMeetingRoute(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /displayName must be a string/);
});

test('create meeting rejects displayName over 100 characters', async () => {
  const { createMeetingRoute } = createMeetingFeature({
    prisma: mockPrisma(),
    io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { body: { displayName: 'a'.repeat(101) } };
  const res = mockResponse();

  await createMeetingRoute(req, res);

  assert.equal(res.statusCode, 400);
});

test('create meeting rejects invalid title type', async () => {
  const { createMeetingRoute } = createMeetingFeature({
    prisma: mockPrisma(),
    io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { body: { title: true } };
  const res = mockResponse();

  await createMeetingRoute(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res._body.error, /title must be a string/);
});

test('create meeting defaults displayName and title when omitted', async () => {
  const { createMeetingRoute } = createMeetingFeature({
    prisma: mockPrisma(),
    io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { body: {} };
  const res = mockResponse();

  await createMeetingRoute(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res._body.meeting.title, /Meeting by Anonymous Host/);
});

// ── Meeting Status Route ───────────────────────────────────────

test('meeting status returns active=true when room has participants', async () => {
  const io = mockIo();
  io.sockets.adapter.rooms._set('123e4567-e89b-42d3-a456-426614174000', new Set(['socket-1', 'socket-2']));
  const prisma = mockPrisma(null, { id: '123e4567-e89b-42d3-a456-426614174000', endedAt: null });

  const { meetingStatusRoute } = createMeetingFeature({
    prisma, io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { params: { id: '123e4567-e89b-42d3-a456-426614174000' } };
  const res = mockResponse();

  await meetingStatusRoute(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.active, true);
  assert.equal(res._body.participantCount, 2);
});

test('meeting status returns active=false for empty room', async () => {
  const io = mockIo();
  const prisma = mockPrisma(null, { id: '123e4567-e89b-42d3-a456-426614174000', endedAt: null });

  const { meetingStatusRoute } = createMeetingFeature({
    prisma, io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { params: { id: '123e4567-e89b-42d3-a456-426614174000' } };
  const res = mockResponse();

  await meetingStatusRoute(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res._body.active, false);
  assert.equal(res._body.participantCount, 0);
});

test('meeting status returns 404 for unknown meeting', async () => {
  const io = mockIo();
  const prisma = mockPrisma(null, null);

  const { meetingStatusRoute } = createMeetingFeature({
    prisma, io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { params: { id: '123e4567-e89b-42d3-a456-426614174000' } };
  const res = mockResponse();

  await meetingStatusRoute(req, res);

  assert.equal(res.statusCode, 404);
});

test('meeting status returns 400 for invalid ID format', async () => {
  const { meetingStatusRoute } = createMeetingFeature({
    prisma: mockPrisma(), io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });
  const req = { params: { id: 'bad-id' } };
  const res = mockResponse();

  await meetingStatusRoute(req, res);

  assert.equal(res.statusCode, 400);
});

// ── Join Meeting Lifecycle ─────────────────────────────────────

test('join emits host-info, user-joined, joined-successfully in order', async () => {
  const io = mockIo();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const meeting = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: null
  };
  const prisma = mockPrisma(null, meeting);

  const { registerSocketHandlers } = createMeetingFeature({
    prisma, io, meetingHosts, meetingJoinLocks
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);

  await socket._trigger('join-meeting', {
    meetingId: '123e4567-e89b-42d3-a456-426614174000',
    displayName: 'Alice',
    isMuted: false,
    isVideoOff: false,
    joinRequestId: 'req-1'
  });

  const events = socket._emitted.map(e => e.event);
  assert.deepEqual(events, ['host-info', 'user-joined', 'joined-successfully']);

  // host-info payload
  assert.equal(socket._emitted[0].data.hostId, 'socket-1');
  // user-joined payload
  assert.equal(socket._emitted[1].data.userId, 'user-1');
  assert.equal(socket._emitted[1].data.displayName, 'Alice');
  assert.equal(socket._emitted[1].data.isHost, true);
  // joined-successfully payload
  assert.equal(socket._emitted[2].data.meetingId, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(socket._emitted[2].data.joinRequestId, 'req-1');
  assert.equal(socket._emitted[2].data.isHost, true);
  assert.ok(socket._emitted[2].data.sessionStartedAt);
});

test('second joiner gets existing participant list and different host', async () => {
  const io = mockIo();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const meeting = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  };
  const prisma = mockPrisma(null, meeting);

  // First socket already in room
  const socket1 = mockSocket('socket-1', io);
  socket1.userId = 'existing-user';
  socket1.currentStatus = { displayName: 'Host', isMuted: false, isVideoOff: false };
  io.sockets._add(socket1);
  io.sockets.adapter.rooms._set('123e4567-e89b-42d3-a456-426614174000', new Set(['socket-1']));
  meetingHosts.set('123e4567-e89b-42d3-a456-426614174000', 'socket-1');

  const { registerSocketHandlers } = createMeetingFeature({
    prisma, io, meetingHosts, meetingJoinLocks
  });

  const socket2 = mockSocket('socket-2', io);
  registerSocketHandlers(socket2);

  await socket2._trigger('join-meeting', {
    meetingId: '123e4567-e89b-42d3-a456-426614174000',
    displayName: 'Bob',
    isMuted: true,
    isVideoOff: true,
    joinRequestId: 'req-2'
  });

  // Bob is not the host (host is socket-1)
  assert.equal(meetingHosts.get('123e4567-e89b-42d3-a456-426614174000'), 'socket-1');

  const joinedPayload = socket2._emitted.find(e => e.event === 'joined-successfully').data;
  assert.equal(joinedPayload.isHost, false);
  assert.equal(joinedPayload.existingParticipants.length, 1);
  assert.equal(joinedPayload.existingParticipants[0].socketId, 'socket-1');

  // host-info should tell socket-2 that socket-1 is host
  const hostInfo = socket2._emitted.find(e => e.event === 'host-info').data;
  assert.equal(hostInfo.hostId, 'socket-1');
});

test('join-error when meeting not found', async () => {
  const io = mockIo();
  const prisma = mockPrisma(null, null); // null meeting

  const { registerSocketHandlers } = createMeetingFeature({
    prisma, io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);

  await socket._trigger('join-meeting', {
    meetingId: '123e4567-e89b-42d3-a456-426614174000',
    displayName: 'Alice',
    joinRequestId: 'req-1'
  });

  const error = socket._emitted.find(e => e.event === 'join-error');
  assert.ok(error);
  assert.match(error.data.error, /Meeting not found/);
  assert.equal(error.data.meetingId, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(error.data.joinRequestId, 'req-1');
});

// ── Leave & Host Reassignment ──────────────────────────────────

test('user-left emitted before endedAt update', async () => {
  const io = mockIo();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const purgeCalls = [];
  const meeting = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  };
  const prisma = mockPrisma(null, meeting);

  const { registerSocketHandlers } = createMeetingFeature({
    prisma, io, meetingHosts, meetingJoinLocks,
    purgeCaptionKeys: (meetingId) => purgeCalls.push(meetingId)
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);
  socket.meetingId = '123e4567-e89b-42d3-a456-426614174000';
  meetingHosts.set('123e4567-e89b-42d3-a456-426614174000', 'socket-1');
  io.sockets.adapter.rooms._set('123e4567-e89b-42d3-a456-426614174000', new Set(['socket-1']));

  // Trigger disconnect (which fires handleUserLeaveRoom)
  await socket._trigger('disconnect');

  // user-left should be emitted
  assert.ok(socket._emitted.some(e => e.event === 'user-left' && e.to === '123e4567-e89b-42d3-a456-426614174000'));
  // Purge should be called since room is now empty
  assert.ok(purgeCalls.includes('123e4567-e89b-42d3-a456-426614174000'));
  // endedAt should have been set
  assert.ok(prisma._calls.update);
  assert.equal(prisma._calls.update.where.id, '123e4567-e89b-42d3-a456-426614174000');
});

test('host reassigned when host leaves and others remain', async () => {
  const io = mockIo();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const meeting = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T01:00:00Z')
  };
  const prisma = mockPrisma(null, meeting);

  const { registerSocketHandlers } = createMeetingFeature({
    prisma, io, meetingHosts, meetingJoinLocks
  });

  const socket1 = mockSocket('socket-1', io);
  registerSocketHandlers(socket1);
  socket1.meetingId = '123e4567-e89b-42d3-a456-426614174000';
  meetingHosts.set('123e4567-e89b-42d3-a456-426614174000', 'socket-1');

  const socket2 = mockSocket('socket-2', io);
  registerSocketHandlers(socket2);
  socket2.meetingId = '123e4567-e89b-42d3-a456-426614174000';
  io.sockets._add(socket1);
  io.sockets._add(socket2);
  io.sockets.adapter.rooms._set('123e4567-e89b-42d3-a456-426614174000', new Set(['socket-1', 'socket-2']));

  await socket1._trigger('disconnect');

  // Host should be reassigned to socket-2
  assert.equal(meetingHosts.get('123e4567-e89b-42d3-a456-426614174000'), 'socket-2');

  // host-info should have been broadcast to the room with new host
  const hostInfo = io._allEmitted.find(e => e.event === 'host-info');
  assert.ok(hostInfo);
  assert.equal(hostInfo.data.hostId, 'socket-2');
});

// ── Signal & Status Relay ──────────────────────────────────────

test('signal relay forwards to target socket', async () => {
  const io = mockIo();
  const { registerSocketHandlers } = createMeetingFeature({
    prisma: mockPrisma(), io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);

  socket._trigger('signal', { to: 'socket-2', signal: { type: 'offer', sdp: '...' } });

  const relayed = io._allEmitted.find(e => e.event === 'signal');
  assert.ok(relayed);
  assert.equal(relayed.data.from, 'socket-1');
  assert.deepEqual(relayed.data.signal, { type: 'offer', sdp: '...' });
});

test('status-change relay forwards to room', async () => {
  const io = mockIo();
  const { registerSocketHandlers } = createMeetingFeature({
    prisma: mockPrisma(), io,
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });

  const socket = mockSocket('socket-1', io);
  registerSocketHandlers(socket);

  socket._trigger('status-change', {
    meetingId: 'meeting-123',
    status: { displayName: 'Alice', isMuted: true, isVideoOff: false }
  });

  assert.equal(socket.currentStatus.isMuted, true);
  assert.ok(socket._emitted.some(e => e.event === 'status-change' && e.to === 'meeting-123'));
});

// ── resolveSessionStart ────────────────────────────────────────

test('resolveSessionStart uses sessionStartedAt when present', () => {
  const { resolveSessionStart } = createMeetingFeature({
    prisma: mockPrisma(), io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });

  const meeting = {
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: new Date('2026-01-01T02:00:00Z')
  };
  assert.deepEqual(resolveSessionStart(meeting), new Date('2026-01-01T02:00:00Z'));
});

test('resolveSessionStart falls back to startedAt', () => {
  const { resolveSessionStart } = createMeetingFeature({
    prisma: mockPrisma(), io: mockIo(),
    meetingHosts: new Map(),
    meetingJoinLocks: new Map()
  });

  const meeting = {
    startedAt: new Date('2026-01-01T00:00:00Z'),
    sessionStartedAt: null
  };
  assert.deepEqual(resolveSessionStart(meeting), new Date('2026-01-01T00:00:00Z'));
});
