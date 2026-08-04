const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioc } = require('socket.io-client');
const { createServer } = require('../index');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://127.0.0.1');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function createMockPrisma() {
  const calls = { createUser: null, createMeeting: null, findUnique: null, update: null, upsert: null, createSegment: null, updateTranscript: null, createSummary: null, findMany: null, deleteMany: null, queryRaw: null };

  return {
    _calls: calls,
    $queryRaw: async () => [{ '?column?': 1 }],
    user: {
      create: async (args) => { calls.createUser = args; return { id: 'user-' + Math.random().toString(36).slice(2, 8), ...args.data }; }
    },
    meeting: {
      create: async (args) => { calls.createMeeting = args; return { id: 'meeting-' + Math.random().toString(36).slice(2, 8), ...args.data }; },
      findUnique: async (args) => {
        calls.findUnique = args;
        return { id: args.where.id, startedAt: new Date('2026-01-01T00:00:00Z'), endedAt: null, sessionStartedAt: null };
      },
      update: async (args) => { calls.update = args; return { id: args.where.id, ...args.data }; },
      deleteMany: async (args) => { calls.deleteMany = args; return { count: 0 }; }
    },
    transcript: {
      upsert: async (args) => { calls.upsert = args; return { id: 'tx-1', ...args.create }; },
      update: async () => { calls.updateTranscript = true; }
    },
    transcriptSegment: {
      create: async (args) => { calls.createSegment = args; return { id: 'seg-1', ...args.data, createdAt: new Date(), sessionStartedAt: args.data.sessionStartedAt }; },
      findMany: async (args) => { calls.findMany = args; return []; }
    },
    summary: {
      create: async (args) => { calls.createSummary = args; return { id: 'summary-1', ...args.data }; }
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Health Endpoint ────────────────────────────────────────────

test('GET /health returns ok with database connected', async () => {
  const prisma = createMockPrisma();
  const { server } = createServer({ prisma });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  try {
    const res = await httpRequest('GET', `http://127.0.0.1:${addr.port}/health`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.database, 'connected');
  } finally {
    server.close();
  }
});

// ── Meeting Creation ───────────────────────────────────────────

test('POST /meetings creates a meeting and returns meetingId', async () => {
  const prisma = createMockPrisma();
  const { server } = createServer({ prisma });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  try {
    const res = await httpRequest('POST', `http://127.0.0.1:${addr.port}/meetings`, {
      displayName: 'Alice',
      title: 'Sprint Planning'
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.meetingId);
    assert.ok(res.body.hostId);
    assert.equal(res.body.meeting.title, 'Sprint Planning');
  } finally {
    server.close();
  }
});

test('POST /meetings validates displayName type', async () => {
  const prisma = createMockPrisma();
  const { server } = createServer({ prisma });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  try {
    const res = await httpRequest('POST', `http://127.0.0.1:${addr.port}/meetings`, { displayName: 123 });
    assert.equal(res.statusCode, 400);
  } finally {
    server.close();
  }
});

// ── Meeting Status ─────────────────────────────────────────────

test('GET /meetings/:id/status returns active false for empty room', async () => {
  const prisma = createMockPrisma();
  const { server } = createServer({ prisma });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  try {
    const res = await httpRequest('GET', `http://127.0.0.1:${addr.port}/meetings/123e4567-e89b-42d3-a456-426614174000/status`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.active, false);
    assert.equal(res.body.participantCount, 0);
  } finally {
    server.close();
  }
});

// ── Socket.io Join Lifecycle ───────────────────────────────────

test('socket.io join-meeting flow emits host-info and joined-successfully to the joiner', async () => {
  const prisma = createMockPrisma();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const persistedCaptionKeys = new Map();

  const { server } = createServer({ prisma, meetingHosts, meetingJoinLocks, persistedCaptionKeys });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  const socket = ioc(`http://127.0.0.1:${addr.port}`);
  try {
    await waitForEvent(socket, 'connect');

    const meetingId = '123e4567-e89b-42d3-a456-426614174000';
    const events = [];
    socket.on('host-info', (data) => events.push({ type: 'host-info', data }));
    socket.on('user-joined', (data) => events.push({ type: 'user-joined', data }));
    socket.on('joined-successfully', (data) => events.push({ type: 'joined-successfully', data }));

    socket.emit('join-meeting', {
      meetingId,
      displayName: 'Alice',
      isMuted: false,
      isVideoOff: false,
      joinRequestId: 'req-1'
    });

    // Wait for joined-successfully
    await waitForEvent(socket, 'joined-successfully');
    await delay(50); // let other events settle

    const types = events.map(e => e.type);
    assert.deepEqual(types, ['host-info', 'joined-successfully']);

    const joined = events.find(e => e.type === 'joined-successfully').data;
    assert.equal(joined.meetingId, meetingId);
    assert.equal(joined.joinRequestId, 'req-1');
    assert.ok(joined.sessionStartedAt);
  } finally {
    socket.close();
    server.close();
  }
});

// ── Socket.io Caption Broadcast ────────────────────────────────

test('socket.io caption broadcast reaches joined room', async () => {
  const prisma = createMockPrisma();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const persistedCaptionKeys = new Map();

  const { server } = createServer({ prisma, meetingHosts, meetingJoinLocks, persistedCaptionKeys });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  const socket = ioc(`http://127.0.0.1:${addr.port}`);
  try {
    await waitForEvent(socket, 'connect');

    const meetingId = '123e4567-e89b-42d3-a456-426614174000';
    socket.emit('join-meeting', {
      meetingId,
      displayName: 'Speaker',
      isMuted: false,
      isVideoOff: false,
      joinRequestId: 'req-1'
    });

    await waitForEvent(socket, 'joined-successfully');
    await delay(50);

    const captionPromise = waitForEvent(socket, 'caption');
    socket.emit('caption', {
      meetingId,
      speakerId: 'speaker-1',
      text: 'Hello from contract test',
      start: 0,
      end: 2,
      utteranceId: 'utt-contract-1',
      isFinal: true
    });

    const caption = await captionPromise;
    assert.ok(caption.captionId);
    assert.equal(caption.text, 'Hello from contract test');
    assert.equal(caption.isFinal, true);
    assert.equal(caption.speakerName, 'Speaker');
    assert.ok(caption.sessionStartedAt);
    assert.ok(caption.createdAt);
  } finally {
    socket.close();
    server.close();
  }
});

// ── Socket.io Caption History ──────────────────────────────────

test('socket.io caption-history returns results for authorized user', async () => {
  const prisma = createMockPrisma();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const persistedCaptionKeys = new Map();

  const { server } = createServer({ prisma, meetingHosts, meetingJoinLocks, persistedCaptionKeys });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  const socket = ioc(`http://127.0.0.1:${addr.port}`);
  try {
    await waitForEvent(socket, 'connect');

    const meetingId = '123e4567-e89b-42d3-a456-426614174000';
    socket.emit('join-meeting', {
      meetingId,
      displayName: 'Viewer',
      joinRequestId: 'req-1'
    });

    await waitForEvent(socket, 'joined-successfully');
    await delay(50);

    const result = await new Promise((resolve) => {
      socket.emit('get-caption-history', { meetingId, limit: 10 }, (response) => {
        resolve(response);
      });
    });

    assert.equal(result.ok, true);
    assert.equal(result.meetingId, meetingId);
    assert.ok(result.sessionStartedAt);
    assert.ok(Array.isArray(result.captions));
  } finally {
    socket.close();
    server.close();
  }
});

// ── Socket.io Leave ────────────────────────────────────────────

test('socket.io leave-meeting emits user-left', async () => {
  const prisma = createMockPrisma();
  const meetingHosts = new Map();
  const meetingJoinLocks = new Map();
  const persistedCaptionKeys = new Map();

  const { server } = createServer({ prisma, meetingHosts, meetingJoinLocks, persistedCaptionKeys });
  server.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const addr = server.address();

  // Connect two sockets
  const socket1 = ioc(`http://127.0.0.1:${addr.port}`);
  const socket2 = ioc(`http://127.0.0.1:${addr.port}`);

  try {
    await waitForEvent(socket1, 'connect');
    await waitForEvent(socket2, 'connect');

    const meetingId = '123e4567-e89b-42d3-a456-426614174000';
    socket1.emit('join-meeting', { meetingId, displayName: 'A', joinRequestId: 'req-a' });
    await waitForEvent(socket1, 'joined-successfully');

    socket2.emit('join-meeting', { meetingId, displayName: 'B', joinRequestId: 'req-b' });
    await waitForEvent(socket2, 'joined-successfully');
    await delay(50);

    const leftPromise = waitForEvent(socket1, 'user-left');
    socket2.emit('leave-meeting');

    const left = await leftPromise;
    assert.equal(left.socketId, socket2.id);
  } finally {
    socket1.close();
    socket2.close();
    server.close();
  }
});
