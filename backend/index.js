const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { truncateSegments } = require('./tokenEstimator');
const { SUMMARY_SCHEMA, resolveLlmConfig, parseSummaryText, SummaryFormatError } = require('./llmConfig');
const { CaptionHistoryError, getCaptionHistoryPage } = require('./captionHistory');

const DEBUG = false;
const debugLog = DEBUG ? (...args) => console.log(...args) : () => {};

const app = express();
const server = http.createServer(app);
const configuredCorsOrigin = process.env.CORS_ORIGIN || "*";
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const resolveCorsOrigin = (origin, callback) => {
  if (configuredCorsOrigin === "*") return callback(null, true);
  if (!origin || origin === 'null' || origin === configuredCorsOrigin || localOriginPattern.test(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
};
const io = new Server(server, {
  cors: {
    origin: resolveCorsOrigin,
  }
});

const prisma = new PrismaClient();

app.use(cors({ origin: resolveCorsOrigin }));
app.use(express.json());

// Health Check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// =====================
// REST Endpoints
// =====================

// Create Meeting
app.post('/meetings', async (req, res) => {
  const { displayName, title } = req.body;
  
  try {
    // 1. Create or find the host user
    const host = await prisma.user.create({
      data: {
        displayName: displayName || 'Anonymous Host'
      }
    });

    // 2. Create the meeting
    const meeting = await prisma.meeting.create({
      data: {
        title: title || `Meeting by ${host.displayName}`,
        hostId: host.id,
        startedAt: new Date()
      }
    });

    res.json({
      meetingId: meeting.id,
      hostId: host.id,
      meeting: meeting
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate Summary
app.post('/meetings/:id/summary', async (req, res) => {
  const { id: meetingId } = req.params;
  const { userId, llmConfig } = req.body;
  const { minutes } = req.query; // optional rolling summary: ?minutes=15

  let resolvedLlmConfig;
  try {
    resolvedLlmConfig = resolveLlmConfig(llmConfig);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  try {
    // 1. Fetch the meeting to get sessionStartedAt
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const sessionStart = meeting.sessionStartedAt || meeting.startedAt;

    // 2. Build where clause: only current session + optional time range
    const whereClause = {
      transcript: { meetingId: meetingId },
      sessionStartedAt: sessionStart
    };

    let summaryType = 'full';
    let timeRangeStart = null;
    let timeRangeEnd = null;

    if (minutes) {
      const mins = parseInt(minutes, 10);
      if (!isNaN(mins) && mins > 0) {
        const cutoff = new Date(Date.now() - mins * 60 * 1000);
        // Use the later of sessionStart or the rolling cutoff
        whereClause.createdAt = { gte: sessionStart > cutoff ? sessionStart : cutoff };
        summaryType = 'rolling';
        timeRangeStart = (cutoff.getTime() - (meeting.startedAt?.getTime() || 0)) / 1000;
        timeRangeEnd = (Date.now() - (meeting.startedAt?.getTime() || 0)) / 1000;
      }
    }

    // 3. Fetch transcript segments for this session
    const segments = await prisma.transcriptSegment.findMany({
      where: whereClause,
      include: {
        transcript: {
          include: {
            owner: true
          }
        }
      },
      orderBy: { start: 'asc' }
    });

    if (segments.length === 0) {
      return res.status(400).json({ error: 'No transcript segments found to summarize in this session.' });
    }

    // 4. Build transcript with token-aware truncation
    const { transcript: fullTranscript, droppedCount } = truncateSegments(segments);

    const systemPrompt = `You are a meeting assistant that produces concise, structured summaries.
Focus on key discussed topics, decisions made, and follow-up action items.
Output ONLY valid JSON — no markdown, no commentary, no code fences — with these keys:
- executive: A brief paragraph of the meeting's essence.
- actions: An array of strings representing specific tasks to be done.
- questions: A string listing any unresolved questions or pending points.
- raw: The full detailed markdown summary.`;

    const { provider, model, apiKey } = resolvedLlmConfig;
    let summaryText = "";
    let usage = null;

    // 5. Call LLM API with system + user message structure
    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey });
      const response = await openai.responses.create({
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullTranscript }
        ],
        max_output_tokens: 8192,
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_summary',
            strict: true,
            schema: SUMMARY_SCHEMA
          }
        }
      });
      if (response.status === 'incomplete') {
        throw new SummaryFormatError('The OpenAI response was incomplete.');
      }
      summaryText = response.output_text;
      usage = response.usage;
    } else if (provider === 'anthropic') {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: fullTranscript }],
        output_config: {
          format: { type: 'json_schema', schema: SUMMARY_SCHEMA }
        }
      });
      summaryText = response.content.find((block) => block.type === 'text')?.text;
      usage = response.usage;
    } else if (provider === 'deepseek') {
      const openai = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com'
      });
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullTranscript }
        ],
        max_tokens: 8192,
        response_format: { type: "json_object" }
      });
      summaryText = response.choices[0]?.message?.content;
      usage = response.usage;
    }

    if (usage) {
      console.log(`Summary LLM usage:`, JSON.stringify(usage));
    }

    // 6. Validate the provider response before storing it
    const { parsed: parsedSummary, cleaned } = parseSummaryText(summaryText);

    // 7. Find a transcript record for this meeting (already loaded via segments include)
    const transcript = segments[0].transcript;

    // 8. Store the summary
    await prisma.summary.create({
      data: {
        meetingId: meetingId,
        transcriptId: transcript?.id,
        requestedById: userId,
        model,
        provider: provider,
        summaryText: cleaned,
        type: summaryType,
        timeRangeStart: timeRangeStart,
        timeRangeEnd: timeRangeEnd
      }
    });

    res.json({
      ...parsedSummary,
      _meta: { type: summaryType, segmentCount: segments.length, droppedCount, provider, model }
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    if (error instanceof SummaryFormatError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(502).json({ error: 'Summary generation failed. Check the API key, model access, and provider status.' });
  }
});

// Meeting Status (check if room is active)
app.get('/meetings/:id/status', async (req, res) => {
  try {
    const room = io.sockets.adapter.rooms.get(req.params.id);
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id },
      select: { endedAt: true }
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    res.json({
      active: !!room && room.size > 0,
      participantCount: room?.size || 0,
      endedAt: meeting.endedAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// Socket.io Real-time
// =====================

// In-memory host tracking
const meetingHosts = new Map(); // meetingId -> hostSocketId
const persistedCaptionKeys = new Map(); // idempotency key -> timestamp (ms)
const CAPTION_KEY_TTL_MS = 3_600_000; // 1 hour
const meetingJoinLocks = new Map();

// Prune stale caption keys every 5 minutes
const CAPTION_KEY_CLEANUP_INTERVAL = 300_000;
const captionKeyCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - CAPTION_KEY_TTL_MS;
  for (const [key, ts] of persistedCaptionKeys) {
    if (ts < cutoff) persistedCaptionKeys.delete(key);
  }
}, CAPTION_KEY_CLEANUP_INTERVAL);

async function withMeetingJoinLock(meetingId, work) {
  const previous = meetingJoinLocks.get(meetingId) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  meetingJoinLocks.set(meetingId, current);
  try {
    return await current;
  } finally {
    if (meetingJoinLocks.get(meetingId) === current) meetingJoinLocks.delete(meetingId);
  }
}

io.on('connection', (socket) => {
      debugLog('User connected:', socket.id);

  // User joins a meeting room
  socket.on('join-meeting', async (data) => {
    const { meetingId, displayName, isMuted, isVideoOff, joinRequestId } = data;

    await withMeetingJoinLock(meetingId, async () => {
      try {
      let meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (!meeting) {
        socket.emit('join-error', { meetingId, joinRequestId, error: 'Meeting not found.' });
        return;
      }

      // Create a user record for this session
      const user = await prisma.user.create({
        data: {
          displayName: displayName || 'Guest'
        }
      });

      // Get existing participants before joining
      const room = io.sockets.adapter.rooms.get(meetingId);
      const isFirstParticipant = !room || room.size === 0;

      const existingParticipants = [];
      if (room) {
        for (const socketId of room) {
          const s = io.sockets.sockets.get(socketId);
          if (s) {
            existingParticipants.push({
              socketId: s.id,
              userId: s.userId,
              status: s.currentStatus || { displayName: 'Guest', isMuted: true, isVideoOff: true }
            });
          }
        }
      }

      // Commit a new session before exposing the first socket in the room.
      if (isFirstParticipant) {
        meeting = await prisma.meeting.update({
          where: { id: meetingId },
          data: { endedAt: null, sessionStartedAt: new Date() }
        });
        debugLog(`Meeting ${meetingId}: new session started`);
      }

      socket.join(meetingId);
      socket.userId = user.id;
      socket.meetingId = meetingId;
      socket.sessionStartedAt = meeting.sessionStartedAt || meeting.startedAt || meeting.createdAt;
      socket.currentStatus = { displayName: user.displayName, isMuted: isMuted, isVideoOff: isVideoOff };

      debugLog(`User ${user.displayName} (${user.id}) joined meeting ${meetingId}`);

      if (!meetingHosts.has(meetingId)) {
        meetingHosts.set(meetingId, socket.id);
      }

      const currentHostId = meetingHosts.get(meetingId);
      
      socket.emit('host-info', { hostId: currentHostId });
      
      // Notify others about the new user
      socket.to(meetingId).emit('user-joined', {
        userId: user.id,
        displayName: user.displayName,
        socketId: socket.id,
        isHost: socket.id === currentHostId,
        status: socket.currentStatus
      });

      // Send the joiner the list of people already there
      socket.emit('joined-successfully', {
        meetingId,
        joinRequestId,
        sessionStartedAt: socket.sessionStartedAt.toISOString(),
        userId: user.id,
        displayName: user.displayName,
        isHost: socket.id === currentHostId,
        existingParticipants
      });
      } catch (error) {
        console.error('Error joining meeting:', error);
        socket.emit('join-error', { meetingId, joinRequestId, error: 'Failed to join meeting.' });
      }
    });
  });

  socket.on('get-caption-history', async (data, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const meetingId = data?.meetingId;
    const room = meetingId ? io.sockets.adapter.rooms.get(meetingId) : null;

    if (!meetingId || socket.meetingId !== meetingId || !room?.has(socket.id)) {
      respond({ ok: false, error: 'Join the meeting before requesting caption history.' });
      return;
    }

    try {
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (!meeting) {
        respond({ ok: false, error: 'Meeting not found.' });
        return;
      }

      const sessionStartedAt = meeting.sessionStartedAt || meeting.startedAt || meeting.createdAt;
      const page = await getCaptionHistoryPage(prisma, {
        meetingId,
        sessionStartedAt,
        cursor: data?.cursor,
        limit: data?.limit
      });

      respond({
        ok: true,
        meetingId,
        sessionStartedAt: sessionStartedAt.toISOString(),
        ...page
      });
    } catch (error) {
      const isRequestError = error instanceof CaptionHistoryError;
      if (!isRequestError) {
        console.error(`Failed to load caption history for meeting ${meetingId}:`, error);
      }
      respond({ ok: false, error: isRequestError ? error.message : 'Failed to load caption history.' });
    }
  });

  // WebRTC Signaling
  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  // Peer Status Change (Mute/Video)
  socket.on('status-change', (data) => {
    const { meetingId, status } = data;
    socket.currentStatus = status; // Sync server-side state
    socket.to(meetingId).emit('status-change', {
      from: socket.id,
      status: status
    });
  });

  // Real-time Captions
  socket.on('caption', async (data) => {
    const { meetingId, speakerId, text, start, end, utteranceId, isFinal } = data;

    if (isFinal === false) {
      socket.emit('caption-rejected', { reason: 'partial-caption-not-persisted', utteranceId });
      return;
    }

    const idempotencyKey = utteranceId
      ? `${meetingId}:${speakerId}:${utteranceId}`
      : null;

    if (idempotencyKey) {
      const ts = persistedCaptionKeys.get(idempotencyKey);
      if (ts && Date.now() - ts < CAPTION_KEY_TTL_MS) return;
      persistedCaptionKeys.set(idempotencyKey, Date.now());
    }
    
    try {
      // 1. Ensure Transcript Metadata exists for this user in this meeting
      let transcript = await prisma.transcript.upsert({
        where: {
          meetingId_ownerUserId: {
            meetingId: meetingId,
            ownerUserId: speakerId
          }
        },
        update: {},
        create: {
          meetingId: meetingId,
          ownerUserId: speakerId,
          language: 'en'
        }
      });

      // 2. Create the Transcript Segment
      const segment = await prisma.transcriptSegment.create({
        data: {
          transcriptId: transcript.id,
          speakerId: speakerId,
          text: text,
          start: start,
          end: end,
          sessionStartedAt: socket.sessionStartedAt
        }
      });

      // 3. Update total duration (simplified for now)
      await prisma.transcript.update({
        where: { id: transcript.id },
        data: { durationSec: { increment: Math.round(Math.max(0, end - start)) } }
      });


      // 4. Broadcast to the meeting room
      io.to(meetingId).emit('caption', {
        ...data,
        captionId: segment.id,
        speakerName: socket.currentStatus?.displayName || 'Guest',
        sessionStartedAt: segment.sessionStartedAt?.toISOString(),
        createdAt: segment.createdAt.toISOString()
      });
    } catch (error) {
      if (idempotencyKey) {
        persistedCaptionKeys.delete(idempotencyKey);
      }
      console.error('Error saving transcript segment:', error);
    }
  });

  const handleUserLeaveRoom = async (socket) => {
    const meetingId = socket.meetingId;
    if (!meetingId) return;

      debugLog(`User ${socket.id} is leaving meeting ${meetingId}`);
    socket.to(meetingId).emit('user-left', { socketId: socket.id });

    // Handle host leaving
    if (meetingHosts.get(meetingId) === socket.id) {
      debugLog(`Host ${socket.id} left meeting ${meetingId}. Reassigning...`);
      const room = io.sockets.adapter.rooms.get(meetingId);
      if (room && room.size > 0) {
        const participants = Array.from(room).filter(id => id !== socket.id);
        if (participants.length > 0) {
          const newHostId = participants[Math.floor(Math.random() * participants.length)];
          meetingHosts.set(meetingId, newHostId);
          debugLog(`New host for ${meetingId} is ${newHostId}`);
          io.to(meetingId).emit('host-info', { hostId: newHostId });
        } else {
          meetingHosts.delete(meetingId);
        }
      } else {
        meetingHosts.delete(meetingId);
      }
    }

    socket.leave(meetingId);
    socket.meetingId = null;
    socket.sessionStartedAt = null;

    await withMeetingJoinLock(meetingId, async () => {
      // Recheck while serialized with joins so an active room is never marked ended.
      const room = io.sockets.adapter.rooms.get(meetingId);
      if (!room || room.size === 0) {
        const prefix = `${meetingId}:`;
        for (const key of persistedCaptionKeys.keys()) {
          if (key.startsWith(prefix)) persistedCaptionKeys.delete(key);
        }
        try {
          await prisma.meeting.update({
            where: { id: meetingId },
            data: { endedAt: new Date() }
          });
          debugLog(`Meeting ${meetingId}: ended (all participants left)`);
        } catch (err) {
          console.error(`Failed to set endedAt for meeting ${meetingId}:`, err);
        }
      }
    });
  };

  socket.on('leave-meeting', () => {
    handleUserLeaveRoom(socket).catch(err => console.error('leave-meeting error:', err));
  });

  socket.on('disconnect', () => {
    debugLog('User disconnected:', socket.id);
    handleUserLeaveRoom(socket).catch(err => console.error('disconnect error:', err));
  });
});

const PORT = process.env.PORT || 4000;
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);

server.listen(PORT, () => {
  debugLog(`Backend server running on port ${PORT}`);
  debugLog(`Transcript retention: ${RETENTION_DAYS} days`);
});

// =====================
// Cleanup Scheduler
// =====================

setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
    const { count } = await prisma.meeting.deleteMany({
      where: {
        endedAt: { not: null, lte: cutoff }
      }
    });
    if (count > 0) {
      debugLog(`Cleanup: deleted ${count} expired meeting(s) older than ${cutoff.toISOString()}`);
    }
  } catch (err) {
    console.error('Cleanup scheduler error:', err);
  }
}, 3600 * 1000); // every hour


// Graceful shutdown
function shutdown() {
  clearInterval(captionKeyCleanupTimer);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
