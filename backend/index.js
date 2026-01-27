const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'connected' });
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

  if (!llmConfig || !llmConfig.apiKey) {
    return res.status(400).json({ error: 'LLM API Key is required for summarization.' });
  }

  try {
    // 1. Fetch all transcript segments for this meeting
    const segments = await prisma.transcriptSegment.findMany({
      where: {
        transcript: {
          meetingId: meetingId
        }
      },
      include: {
        transcript: {
          include: {
            owner: true
          }
        }
      },
      orderBy: {
        start: 'asc'
      }
    });

    if (segments.length === 0) {
      return res.status(400).json({ error: 'No transcript segments found to summarize.' });
    }

    // 2. Combine segments into a full transcript text with speaker names
    const fullTranscript = segments
      .map(s => `[${s.transcript.owner.displayName}]: ${s.text}`)
      .join('\n');
    console.log(fullTranscript);
    const prompt = `
      Please summarize the following meeting transcript. 
      Focus on key discussed topics, decisions made, and follow-up action items.
      Format the response as a JSON object with these keys:
      - executive: A brief paragraph of the meeting's essence.
      - actions: An array of strings representing specific tasks to be done.
      - questions: A string listing any unresolved questions or pending points.
      - raw: The full detailed markdown summary.

      TRANSCRIPT:
      ${fullTranscript}
    `;

    let summaryText = "";
    let provider = llmConfig.provider || 'openai';

    // 3. Call Real LLM API
    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: llmConfig.apiKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-2024-08-06",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });
      summaryText = response.choices[0].message.content;
    } else if (provider === 'anthropic') {
      const anthropic = new Anthropic({ apiKey: llmConfig.apiKey });
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }]
      });
      summaryText = response.content[0].text;
    } else if (provider === 'deepseek') {
        const openai = new OpenAI({ 
            apiKey: llmConfig.apiKey,
            baseURL: 'https://api.deepseek.com'
        });
        const response = await openai.chat.completions.create({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });
        summaryText = response.choices[0].message.content;
    }

    const parsedSummary = JSON.parse(summaryText);

    // 4. Find the transcript record (any one for this meeting)
    const transcript = await prisma.transcript.findFirst({
      where: { meetingId: meetingId }
    });

    // 5. Store the summary in the database
    await prisma.summary.create({
      data: {
        meetingId: meetingId,
        transcriptId: transcript.id,
        requestedById: userId,
        model: provider === 'openai' ? 'gpt-4o' : (provider === 'anthropic' ? 'claude-3.5-sonnet' : 'deepseek-v3'),
        provider: provider,
        summaryText: summaryText
      }
    });

    res.json(parsedSummary);
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// Socket.io Real-time
// =====================

// In-memory host tracking
const meetingHosts = new Map(); // meetingId -> hostSocketId

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
    const { meetingId, speakerId, text, start, end } = data;
    
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
        data: { durationSec: { increment: Math.max(0, end - start) } }
      });


      // 4. Broadcast to the meeting room
      io.to(meetingId).emit('caption', data);
    } catch (error) {
      console.error('Error saving transcript segment:', error);
    }
  });

  const handleUserLeaveRoom = (socket) => {
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
server.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
