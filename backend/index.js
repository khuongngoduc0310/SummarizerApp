const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { truncateSegments } = require('./tokenEstimator');

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

// Join Meeting (GET info)
app.get('/meetings/:id', async (req, res) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id },
      include: { host: true }
    });
    
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    res.json(meeting);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate Summary
app.post('/meetings/:id/summary', async (req, res) => {
  const { id: meetingId } = req.params;
  const { userId, llmConfig } = req.body;
  const { minutes } = req.query; // optional rolling summary: ?minutes=15

  if (!llmConfig || !llmConfig.apiKey) {
    return res.status(400).json({ error: 'LLM API Key is required for summarization.' });
  }

  try {
    // 1. Fetch the meeting to get sessionStartedAt
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const sessionStart = meeting.sessionStartedAt || meeting.startedAt;

    // 2. Build where clause: only current session + optional time range
    const whereClause = {
      transcript: { meetingId: meetingId },
      createdAt: { gte: sessionStart }
    };

    let summaryType = 'full';
    let timeRangeStart = null;
    let timeRangeEnd = null;

    if (minutes) {
      const mins = parseInt(minutes, 10);
      if (!isNaN(mins) && mins > 0) {
        const cutoff = new Date(Date.now() - mins * 60 * 1000);
        // Use the later of sessionStart or the rolling cutoff
        whereClause.createdAt = {
          gte: sessionStart > cutoff ? sessionStart : cutoff
        };
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

    const provider = llmConfig.provider || 'openai';
    let summaryText = "";
    let usage = null;

    // 5. Call LLM API with system + user message structure
    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: llmConfig.apiKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullTranscript }
        ],
        response_format: { type: "json_object" }
      });
      summaryText = response.choices[0].message.content;
      usage = response.usage;
    } else if (provider === 'anthropic') {
      const anthropic = new Anthropic({ apiKey: llmConfig.apiKey });
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: fullTranscript }]
      });
      summaryText = response.content[0].text;
      usage = response.usage;
    } else if (provider === 'deepseek') {
      const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: 'https://api.deepseek.com'
      });
      const response = await openai.chat.completions.create({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullTranscript }
        ],
        response_format: { type: "json_object" }
      });
      summaryText = response.choices[0].message.content;
      usage = response.usage;
    }

    if (usage) {
      console.log(`Summary LLM usage:`, JSON.stringify(usage));
    }

    // 6. Clean up JSON response (handle code fences if model misbehaves)
    let cleaned = summaryText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    const parsedSummary = JSON.parse(cleaned);

    // 7. Find a transcript record for this meeting
    const transcript = await prisma.transcript.findFirst({
      where: { meetingId: meetingId }
    });

    // 8. Store the summary
    await prisma.summary.create({
      data: {
        meetingId: meetingId,
        transcriptId: transcript?.id,
        requestedById: userId,
        model: provider === 'openai' ? 'gpt-4o' : (provider === 'anthropic' ? 'claude-3.5-sonnet' : 'deepseek-v3'),
        provider: provider,
        summaryText: cleaned,
        type: summaryType,
        timeRangeStart: timeRangeStart,
        timeRangeEnd: timeRangeEnd
      }
    });

    res.json({
      ...parsedSummary,
      _meta: { type: summaryType, segmentCount: segments.length, droppedCount }
    });
  } catch (error) {
    console.error('Error generating summary:', error);
    if (error instanceof SyntaxError) {
      return res.status(502).json({ error: 'Failed to parse LLM response as JSON.' });
    }
    res.status(500).json({ error: error.message });
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
const persistedCaptionKeys = new Set(); // idempotency keys for final caption events

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User joins a meeting room
  socket.on('join-meeting', async (data) => {
    const { meetingId, displayName, isMuted, isVideoOff } = data;
    
    try {
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

      socket.join(meetingId);
      socket.userId = user.id;
      socket.meetingId = meetingId;
      socket.currentStatus = { displayName: user.displayName, isMuted: isMuted, isVideoOff: isVideoOff };
      
      console.log(`User ${user.displayName} (${user.id}) joined meeting ${meetingId}`);

      // Session lifecycle: if room was empty, start a fresh session
      if (isFirstParticipant) {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { endedAt: null, sessionStartedAt: new Date() }
        });
        console.log(`Meeting ${meetingId}: new session started`);
      }

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
        userId: user.id,
        displayName: user.displayName,
        isHost: socket.id === currentHostId,
        existingParticipants
      });
    } catch (error) {
      console.error('Error joining meeting:', error);
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

    if (idempotencyKey && persistedCaptionKeys.has(idempotencyKey)) {
      return;
    }

    // Reserve the key before async DB work so duplicate client emits from
    // multiple listeners cannot race and create duplicate transcript rows.
    if (idempotencyKey) {
      persistedCaptionKeys.add(idempotencyKey);
    }
    
    try {
      // 1. Ensure Transcript Metadata exists for this user in this meeting
      let transcript = await prisma.transcript.findFirst({
        where: {
          meetingId: meetingId,
          ownerUserId: speakerId
        }
      });

      if (!transcript) {
        transcript = await prisma.transcript.create({
          data: {
            meetingId: meetingId,
            ownerUserId: speakerId,
            language: 'en'
          }
        });
      }

      // 2. Create the Transcript Segment
      await prisma.transcriptSegment.create({
        data: {
          transcriptId: transcript.id,
          speakerId: speakerId,
          text: text,
          start: start,
          end: end
        }
      });

      // 3. Update total duration (simplified for now)
      await prisma.transcript.update({
        where: { id: transcript.id },
        data: { durationSec: { increment: Math.round(Math.max(0, end - start)) } }
      });


      // 4. Broadcast to the meeting room
      io.to(meetingId).emit('caption', data);
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

    console.log(`User ${socket.id} is leaving meeting ${meetingId}`);
    socket.to(meetingId).emit('user-left', { socketId: socket.id });

    // Handle host leaving
    if (meetingHosts.get(meetingId) === socket.id) {
      console.log(`Host ${socket.id} left meeting ${meetingId}. Reassigning...`);
      const room = io.sockets.adapter.rooms.get(meetingId);
      if (room && room.size > 0) {
        const participants = Array.from(room).filter(id => id !== socket.id);
        if (participants.length > 0) {
          const newHostId = participants[Math.floor(Math.random() * participants.length)];
          meetingHosts.set(meetingId, newHostId);
          console.log(`New host for ${meetingId} is ${newHostId}`);
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

    // Mark meeting as ended if room is now empty
    const room = io.sockets.adapter.rooms.get(meetingId);
    if (!room || room.size === 0) {
      try {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { endedAt: new Date() }
        });
        console.log(`Meeting ${meetingId}: ended (all participants left)`);
      } catch (err) {
        console.error(`Failed to set endedAt for meeting ${meetingId}:`, err);
      }
    }
  };

  socket.on('leave-meeting', () => {
    handleUserLeaveRoom(socket);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    handleUserLeaveRoom(socket);
  });
});

const PORT = process.env.PORT || 4000;
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);

server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Transcript retention: ${RETENTION_DAYS} days`);
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
      console.log(`Cleanup: deleted ${count} expired meeting(s) older than ${cutoff.toISOString()}`);
    }
  } catch (err) {
    console.error('Cleanup scheduler error:', err);
  }
}, 3600 * 1000); // every hour
