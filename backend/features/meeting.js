const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEBUG = false;
const debugLog = DEBUG ? (...args) => console.log(...args) : () => {};

function createMeetingFeature({ prisma, io, meetingHosts, meetingJoinLocks, purgeCaptionKeys }) {
  /**
   * Returns the canonical session-start time for a meeting record,
   * falling back from sessionStartedAt to startedAt.
   */
  function resolveSessionStart(meeting) {
    return meeting.sessionStartedAt || meeting.startedAt;
  }

  // ── REST Routes ──────────────────────────────────────────────

  async function createMeetingRoute(req, res) {
    const { displayName, title } = req.body;
    if (displayName !== undefined && typeof displayName !== 'string') {
      return res.status(400).json({ error: 'displayName must be a string' });
    }
    if (typeof displayName === 'string' && displayName.length > 100) {
      return res.status(400).json({ error: 'displayName must be at most 100 characters' });
    }
    if (title !== undefined && typeof title !== 'string') {
      return res.status(400).json({ error: 'title must be a string' });
    }
    if (typeof title === 'string' && title.length > 200) {
      return res.status(400).json({ error: 'title must be at most 200 characters' });
    }

    try {
      const host = await prisma.user.create({
        data: {
          displayName: displayName || 'Anonymous Host'
        }
      });

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
  }

  async function meetingStatusRoute(req, res) {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid meeting ID format' });
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
  }

  // ── Socket.io Lifecycle ──────────────────────────────────────

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

  function collectExistingParticipants(room) {
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
    return existingParticipants;
  }

  async function handleJoinMeeting(socket, data) {
    const { meetingId, displayName, isMuted, isVideoOff, joinRequestId } = data;

    await withMeetingJoinLock(meetingId, async () => {
      try {
        let meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
        if (!meeting) {
          socket.emit('join-error', { meetingId, joinRequestId, error: 'Meeting not found.' });
          return;
        }

        const user = await prisma.user.create({
          data: {
            displayName: displayName || 'Guest'
          }
        });

        const room = io.sockets.adapter.rooms.get(meetingId);
        const isFirstParticipant = !room || room.size === 0;
        const existingParticipants = collectExistingParticipants(room);

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
        socket.sessionStartedAt = resolveSessionStart(meeting);
        socket.currentStatus = { displayName: user.displayName, isMuted: isMuted, isVideoOff: isVideoOff };

        debugLog(`User ${user.displayName} (${user.id}) joined meeting ${meetingId}`);

        if (!meetingHosts.has(meetingId)) {
          meetingHosts.set(meetingId, socket.id);
        }

        const currentHostId = meetingHosts.get(meetingId);

        socket.emit('host-info', { hostId: currentHostId });

        socket.to(meetingId).emit('user-joined', {
          userId: user.id,
          displayName: user.displayName,
          socketId: socket.id,
          isHost: socket.id === currentHostId,
          status: socket.currentStatus
        });

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
  }

  async function handleUserLeaveRoom(socket) {
    const meetingId = socket.meetingId;
    if (!meetingId) return;

    debugLog(`User ${socket.id} is leaving meeting ${meetingId}`);
    socket.to(meetingId).emit('user-left', { socketId: socket.id });

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
      const room = io.sockets.adapter.rooms.get(meetingId);
      if (!room || room.size === 0) {
        if (purgeCaptionKeys) {
          purgeCaptionKeys(meetingId);
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
  }

  function registerSocketHandlers(socket) {
    debugLog('User connected:', socket.id);

    socket.on('join-meeting', (data) => {
      return handleJoinMeeting(socket, data).catch((err) => {
        console.error('join-meeting unhandled rejection:', err);
        socket.emit('join-error', {
          meetingId: data?.meetingId,
          joinRequestId: data?.joinRequestId,
          error: 'Failed to join meeting.'
        });
      });
    });

    socket.on('signal', (data) => {
      io.to(data.to).emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    });

    socket.on('status-change', (data) => {
      const { meetingId, status } = data;
      socket.currentStatus = status;
      socket.to(meetingId).emit('status-change', {
        from: socket.id,
        status: status
      });
    });

    socket.on('leave-meeting', () => {
      return handleUserLeaveRoom(socket).catch(err => console.error('leave-meeting error:', err));
    });

    socket.on('disconnect', () => {
      debugLog('User disconnected:', socket.id);
      return handleUserLeaveRoom(socket).catch(err => console.error('disconnect error:', err));
    });
  }

  return {
    createMeetingRoute,
    meetingStatusRoute,
    resolveSessionStart,
    registerSocketHandlers
  };
}

module.exports = { createMeetingFeature };
