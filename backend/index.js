const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const { createSummaryFeature } = require('./features/summary');
const { createMeetingFeature } = require('./features/meeting');
const { createCaptionFeature } = require('./features/caption');

const DEBUG = false;
const debugLog = DEBUG ? (...args) => console.log(...args) : () => {};

function createServer(deps) {
  const options = deps || {};

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

  const io = options.io || new Server(server, {
    cors: { origin: resolveCorsOrigin }
  });

  const prisma = options.prisma || new PrismaClient();

  app.use(cors({ origin: resolveCorsOrigin }));
  app.use(express.json());

  // ── Health Check ─────────────────────────────────────────────

  app.get('/health', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({ status: 'error', database: 'disconnected', error: error.message });
    }
  });

  // ── Shared State ─────────────────────────────────────────────

  const meetingHosts = options.meetingHosts || new Map();
  const persistedCaptionKeys = options.persistedCaptionKeys || new Map();
  const meetingJoinLocks = options.meetingJoinLocks || new Map();

  // ── Feature Composition ──────────────────────────────────────

  // Deferred reference to avoid circular dependency:
  // Meeting feature needs purgeCaptionKeys from Caption feature,
  // Caption feature needs resolveSessionStart from Meeting feature.
  const captionPurger = { fn: null };

  const meetingFeature = createMeetingFeature({
    prisma,
    io,
    meetingHosts,
    meetingJoinLocks,
    purgeCaptionKeys: (meetingId) => {
      if (captionPurger.fn) captionPurger.fn(meetingId);
    }
  });

  const captionFeature = createCaptionFeature({
    prisma,
    io,
    persistedCaptionKeys,
    resolveSessionStart: meetingFeature.resolveSessionStart
  });

  captionPurger.fn = captionFeature.purgeCaptionKeys;

  const summaryFeature = createSummaryFeature({
    prisma,
    getOpenAI: ({ apiKey, baseURL }) => new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey }),
    getAnthropic: ({ apiKey }) => new Anthropic({ apiKey })
  });

  // ── REST Routes ──────────────────────────────────────────────

  app.post('/meetings', meetingFeature.createMeetingRoute);
  app.post('/meetings/:id/summary', summaryFeature);
  app.get('/meetings/:id/status', meetingFeature.meetingStatusRoute);

  // ── Socket.io ────────────────────────────────────────────────

  io.on('connection', (socket) => {
    meetingFeature.registerSocketHandlers(socket);
    captionFeature.registerSocketHandlers(socket);
  });

  // ── Cleanup ──────────────────────────────────────────────────

  const captionKeyCleanupTimer = captionFeature.startCaptionKeyCleanup();
  captionKeyCleanupTimer.unref();

  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);
  const retentionTimer = setInterval(async () => {
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
  }, 3600 * 1000);
  retentionTimer.unref();

  function shutdown() {
    clearInterval(captionKeyCleanupTimer);
    clearInterval(retentionTimer);
    server.close(() => process.exit(0));
  }

  return { app, server, io, prisma, meetingHosts, persistedCaptionKeys, meetingJoinLocks, shutdown };
}

// ── Direct Startup ─────────────────────────────────────────────

if (require.main === module) {
  const { server, shutdown } = createServer();
  const PORT = process.env.PORT || 4000;
  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30', 10);

  server.listen(PORT, () => {
    debugLog(`Backend server running on port ${PORT}`);
    debugLog(`Transcript retention: ${RETENTION_DAYS} days`);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer };
