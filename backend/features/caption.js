const { CaptionHistoryError, getCaptionHistoryPage } = require('../captionHistory');

const CAPTION_KEY_TTL_MS = 3_600_000; // 1 hour
const CAPTION_KEY_CLEANUP_INTERVAL = 300_000; // 5 minutes

function createCaptionFeature({ prisma, io, persistedCaptionKeys, resolveSessionStart }) {
  /**
   * Returns the canonical session-start time for a meeting record,
   * falling back through sessionStartedAt, startedAt, and createdAt.
   */
  function resolveMeetingSession(meeting) {
    if (resolveSessionStart) return resolveSessionStart(meeting);
    return meeting.sessionStartedAt || meeting.startedAt || meeting.createdAt;
  }

  /**
   * Purges all idempotency keys that start with the given meetingId prefix.
   * Called by the meeting feature when a room empties.
   */
  function purgeCaptionKeys(meetingId) {
    const prefix = `${meetingId}:`;
    for (const key of persistedCaptionKeys.keys()) {
      if (key.startsWith(prefix)) persistedCaptionKeys.delete(key);
    }
  }

  /**
   * Prunes stale idempotency keys older than the TTL.
   * Returns a timer handle so the caller can clear it on shutdown.
   */
  function startCaptionKeyCleanup() {
    return setInterval(() => {
      const cutoff = Date.now() - CAPTION_KEY_TTL_MS;
      for (const [key, ts] of persistedCaptionKeys) {
        if (ts < cutoff) persistedCaptionKeys.delete(key);
      }
    }, CAPTION_KEY_CLEANUP_INTERVAL);
  }

  // ── Socket.io Handlers ───────────────────────────────────────

  async function handleCaption(socket, data) {
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

      await prisma.transcript.update({
        where: { id: transcript.id },
        data: { durationSec: { increment: Math.round(Math.max(0, end - start)) } }
      });

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
  }

  async function handleCaptionHistory(socket, data, callback) {
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

      const sessionStartedAt = resolveMeetingSession(meeting);
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
  }

  function registerSocketHandlers(socket) {
    socket.on('caption', (data) => {
      return handleCaption(socket, data).catch((err) => {
        console.error('caption handler error:', err);
      });
    });

    socket.on('get-caption-history', (data, callback) => {
      return handleCaptionHistory(socket, data, callback).catch((err) => {
        console.error('get-caption-history handler error:', err);
        const respond = typeof callback === 'function' ? callback : () => {};
        respond({ ok: false, error: 'Failed to load caption history.' });
      });
    });
  }

  return {
    purgeCaptionKeys,
    startCaptionKeyCleanup,
    registerSocketHandlers
  };
}

module.exports = { createCaptionFeature, CAPTION_KEY_TTL_MS, CAPTION_KEY_CLEANUP_INTERVAL };
