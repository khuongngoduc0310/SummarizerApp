#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function writeWav(filePath, floatSamples, sampleRate) {
  const dataSize = floatSamples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < floatSamples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, Number(floatSamples[i]) || 0));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

function computeAudioStats(samples) {
  if (!samples.length) return { rms: 0, peak: 0 };

  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const value = Number(sample) || 0;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak
  };
}

function removeDcOffset(samples) {
  if (!samples.length) return samples;
  const mean = samples.reduce((sum, sample) => sum + (Number(sample) || 0), 0) / samples.length;
  return samples.map((sample) => (Number(sample) || 0) - mean);
}

function highPassFilter(samples, sampleRate, cutoffHz) {
  if (samples.length < 2) return samples;

  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const output = new Array(samples.length);
  output[0] = samples[0];

  for (let i = 1; i < samples.length; i += 1) {
    output[i] = alpha * (output[i - 1] + samples[i] - samples[i - 1]);
  }

  return output;
}

function trimSilence(samples, sampleRate, threshold, paddingMs = 100) {
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
  const paddingFrames = Math.ceil(paddingMs / 20);
  const frameCount = Math.ceil(samples.length / frameSamples);
  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSamples;
    const end = Math.min(samples.length, start + frameSamples);
    const stats = computeAudioStats(samples.slice(start, end));
    if (stats.rms >= threshold) {
      if (firstSpeechFrame === -1) firstSpeechFrame = frame;
      lastSpeechFrame = frame;
    }
  }

  if (firstSpeechFrame === -1) {
    return { samples: [], trimmedMs: samples.length / sampleRate * 1000 };
  }

  const trimStartFrame = Math.max(0, firstSpeechFrame - paddingFrames);
  const trimEndFrame = Math.min(frameCount, lastSpeechFrame + paddingFrames + 1);
  const trimStart = trimStartFrame * frameSamples;
  const trimEnd = Math.min(samples.length, trimEndFrame * frameSamples);

  return {
    samples: samples.slice(trimStart, trimEnd),
    trimmedMs: ((trimStart + (samples.length - trimEnd)) / sampleRate) * 1000
  };
}

function normalizePeak(samples, targetPeak = 0.8, maxGain = 3) {
  const { peak } = computeAudioStats(samples);
  if (peak <= 0 || peak >= targetPeak) return { samples, gainApplied: 1 };

  const gainApplied = Math.min(maxGain, targetPeak / peak);
  return {
    samples: samples.map((sample) => Math.max(-1, Math.min(1, sample * gainApplied))),
    gainApplied
  };
}

function preprocessAudio(samples, sampleRate, config) {
  const before = computeAudioStats(samples);
  const metrics = {
    rmsBefore: before.rms,
    peakBefore: before.peak,
    rmsAfter: before.rms,
    peakAfter: before.peak,
    trimmedMs: 0,
    skippedByVad: false,
    highPassCutoffHz: config.highPassCutoffHz,
    gainApplied: 1
  };

  if (before.rms < config.vadThreshold) {
    metrics.skippedByVad = true;
    return { samples: [], metrics };
  }

  let processed = samples.map((sample) => Number(sample) || 0);

  if (config.dcOffsetRemoval) {
    processed = removeDcOffset(processed);
  }

  if (config.highPassFilter) {
    processed = highPassFilter(processed, sampleRate, config.highPassCutoffHz);
  }

  if (config.silenceTrim) {
    const trimmed = trimSilence(processed, sampleRate, config.vadThreshold * 0.75);
    processed = trimmed.samples;
    metrics.trimmedMs = trimmed.trimmedMs;
  }

  if (processed.length < sampleRate * 0.3) {
    metrics.skippedByVad = true;
    return { samples: [], metrics };
  }

  if (config.normalizeAudio) {
    const normalized = normalizePeak(processed);
    processed = normalized.samples;
    metrics.gainApplied = normalized.gainApplied;
  }

  const after = computeAudioStats(processed);
  metrics.rmsAfter = after.rms;
  metrics.peakAfter = after.peak;

  return { samples: processed, metrics };
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\[[^\]]*]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForCompare(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function runWhisper({ binary, model, wavPath, language }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const args = ['-m', model, '-f', wavPath, '-nt', '-np'];
    if (language) args.push('-l', language);

    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => resolve({ ok: false, error: error.message, stdout, stderr }));
    child.on('exit', (code, signal) => {
      resolve({
        ok: code === 0,
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: performance.now() - startedAt
      });
    });
  });
}

function validateConfig(config, current = {}) {
  const windowSec = Number(config.windowSec ?? current.windowSec ?? 4);
  const overlapSecRaw = Number(config.overlapSec ?? current.overlapSec ?? 1);
  const maxBufferSec = Number(config.maxBufferSec ?? current.maxBufferSec ?? 8);
  const vadThreshold = Number(config.vadThreshold ?? current.vadThreshold ?? 0.008);
  const highPassCutoffHz = Number(config.highPassCutoffHz ?? current.highPassCutoffHz ?? 100);

  if (!Number.isFinite(windowSec) || windowSec < 2 || windowSec > 10) {
    throw new Error('windowSec must be between 2 and 10 seconds');
  }
  if (!Number.isFinite(overlapSecRaw) || overlapSecRaw < 0 || overlapSecRaw >= windowSec) {
    throw new Error('overlapSec must be >= 0 and less than windowSec');
  }

  const stepSec = Math.max(0.5, windowSec - overlapSecRaw);
  const overlapSec = windowSec - stepSec;

  if (!Number.isFinite(maxBufferSec) || maxBufferSec < windowSec || maxBufferSec > 30) {
    throw new Error('maxBufferSec must be between windowSec and 30 seconds');
  }
  if (!Number.isFinite(vadThreshold) || vadThreshold < 0 || vadThreshold > 0.1) {
    throw new Error('vadThreshold must be between 0 and 0.1');
  }
  if (!Number.isFinite(highPassCutoffHz) || highPassCutoffHz < 20 || highPassCutoffHz > 300) {
    throw new Error('highPassCutoffHz must be between 20 and 300 Hz');
  }

  return {
    windowSec,
    overlapSec,
    stepSec,
    maxBufferSec,
    vadThreshold,
    dcOffsetRemoval: config.dcOffsetRemoval ?? current.dcOffsetRemoval ?? true,
    highPassFilter: config.highPassFilter ?? current.highPassFilter ?? true,
    highPassCutoffHz,
    normalizeAudio: config.normalizeAudio ?? current.normalizeAudio ?? true,
    silenceTrim: config.silenceTrim ?? current.silenceTrim ?? true
  };
}

class SessionState {
  constructor({ meetingId, speakerId, sampleRate, config }) {
    this.meetingId = meetingId;
    this.speakerId = speakerId;
    this.sampleRate = sampleRate;
    this.samples = [];
    this.totalSamplesReceived = 0;
    this.lastInferenceAtSample = 0;
    this.inferenceRunning = false;
    this.sequence = 0;
    this.recentFinals = [];
    this.lastFinalText = '';
    this.duplicateSuppressedCount = 0;
    this.overlapPrefixTrimCount = 0;
    this.applyConfig(config);
  }

  applyConfig(config) {
    this.config = validateConfig(config, this.config);
    this.windowSamples = Math.round(this.config.windowSec * this.sampleRate);
    this.stepSamples = Math.round(this.config.stepSec * this.sampleRate);
    this.maxBufferSamples = Math.round(this.config.maxBufferSec * this.sampleRate);
    if (this.samples.length > this.maxBufferSamples) {
      this.samples = this.samples.slice(-this.maxBufferSamples);
    }
  }

  push(samples) {
    this.samples.push(...samples);
    this.totalSamplesReceived += samples.length;
    if (this.samples.length > this.maxBufferSamples) {
      this.samples = this.samples.slice(-this.maxBufferSamples);
    }
  }

  shouldRun() {
    if (this.inferenceRunning) return false;
    if (this.samples.length < Math.min(this.windowSamples, this.sampleRate)) return false;
    return this.totalSamplesReceived - this.lastInferenceAtSample >= this.stepSamples;
  }

  getWindow() {
    const windowSamples = this.samples.slice(-this.windowSamples);
    const end = this.totalSamplesReceived / this.sampleRate;
    const start = Math.max(0, end - (windowSamples.length / this.sampleRate));
    return { samples: windowSamples, start, end };
  }

  removeRepeatedPrefix(text) {
    const normalizedPrevious = normalizeForCompare(this.lastFinalText);
    const normalizedCurrent = normalizeForCompare(text);
    const previousWords = normalizedPrevious.split(' ').filter(Boolean);
    const currentWords = normalizedCurrent.split(' ').filter(Boolean);
    const originalWords = normalizeText(text).split(' ').filter(Boolean);

    if (!normalizedPrevious || !normalizedCurrent) return text;

    // Whisper sometimes repeats the whole previous window and appends new words,
    // even when audio overlap is 0. Emit only the appended suffix in that case.
    if (currentWords.length > previousWords.length) {
      const currentPrefix = currentWords.slice(0, previousWords.length).join(' ');
      if (currentPrefix === normalizedPrevious) {
        this.overlapPrefixTrimCount += 1;
        return originalWords.slice(previousWords.length).join(' ');
      }
    }

    const maxMatch = Math.min(previousWords.length, currentWords.length, originalWords.length);
    for (let size = maxMatch; size >= 1; size -= 1) {
      const previousSuffix = previousWords.slice(-size).join(' ');
      const currentPrefix = currentWords.slice(0, size).join(' ');
      if (previousSuffix && previousSuffix === currentPrefix) {
        this.overlapPrefixTrimCount += 1;
        return originalWords.slice(size).join(' ');
      }
    }

    return text;
  }

  rememberFinal(text) {
    this.lastFinalText = text;
    const normalized = normalizeForCompare(text);
    if (normalized) {
      this.recentFinals.push(normalized);
      this.recentFinals = this.recentFinals.slice(-8);
    }
  }

  isDuplicate(text) {
    const normalized = normalizeForCompare(text);
    if (!normalized) return true;

    for (const previous of this.recentFinals) {
      if (previous === normalized) {
        this.duplicateSuppressedCount += 1;
        return true;
      }
      if (previous.includes(normalized) && normalized.length > 12) {
        this.duplicateSuppressedCount += 1;
        return true;
      }
      if (normalized.includes(previous) && previous.length > 12) {
        // If the current text starts with previous text, removeRepeatedPrefix
        // should have reduced it. Anything left here is still duplicate enough
        // to suppress.
        this.duplicateSuppressedCount += 1;
        return true;
      }
    }

    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const binary = args.binary && path.resolve(args.binary);
  const model = args.model && path.resolve(args.model);
  const language = args.language || 'en';
  const backend = args.backend || 'native';
  let activeConfig = validateConfig({
    windowSec: Number(args.windowSec || 4),
    overlapSec: args.overlapSec !== undefined ? Number(args.overlapSec) : undefined,
    stepSec: Number(args.stepSec || 3),
    maxBufferSec: Number(args.maxBufferSec || 8),
    vadThreshold: Number(args.vadThreshold || 0.008),
    highPassCutoffHz: Number(args.highPassCutoffHz || 100),
    dcOffsetRemoval: args.dcOffsetRemoval !== 'false',
    highPassFilter: args.highPassFilter !== 'false',
    normalizeAudio: args.normalizeAudio !== 'false',
    silenceTrim: args.silenceTrim !== 'false'
  });

  if (!binary || !fs.existsSync(binary)) {
    throw new Error(`whisper.cpp binary not found: ${binary}`);
  }
  if (!model || !fs.existsSync(model)) {
    throw new Error(`Whisper model not found: ${model}`);
  }

  const sessions = new Map();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetsummarizer-stt-'));

  const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  emit({ type: 'status', status: 'ready', backend, model, binary, config: activeConfig });

  async function maybeInfer(session) {
    if (!session.shouldRun()) return;

    session.inferenceRunning = true;
    session.lastInferenceAtSample = session.totalSamplesReceived;
    const { samples, start, end } = session.getWindow();
    const wavPath = path.join(tempDir, `${session.meetingId}-${session.speakerId}-${Date.now()}.wav`);

    try {
      const preprocessed = preprocessAudio(samples, session.sampleRate, session.config);
      if (preprocessed.metrics.skippedByVad) {
        emit({
          type: 'telemetry',
          event: 'vad-skip',
          backend,
          meetingId: session.meetingId,
          speakerId: session.speakerId,
          metrics: preprocessed.metrics
        });
        return;
      }

      writeWav(wavPath, preprocessed.samples, session.sampleRate);
      const result = await runWhisper({ binary, model, wavPath, language });
      if (!result.ok) {
        emit({ type: 'error', backend, error: result.error || result.stderr || `whisper.cpp exited ${result.code}` });
        return;
      }

      const rawText = normalizeText(result.stdout);
      const text = session.removeRepeatedPrefix(rawText);
      if (!text || session.isDuplicate(text)) return;
      session.rememberFinal(text);

      session.sequence += 1;
      emit({
        type: 'final',
        backend,
        utteranceId: `${session.meetingId}-${session.speakerId}-${session.sequence}`,
        meetingId: session.meetingId,
        speakerId: session.speakerId,
        sequence: session.sequence,
        text,
        start,
        end,
        confidence: null,
        isFinal: true,
        metrics: {
          backend,
          inferenceTimeMs: result.elapsedMs,
          audioDurationSec: samples.length / session.sampleRate,
          processedAudioDurationSec: preprocessed.samples.length / session.sampleRate,
          realtimeFactor: result.elapsedMs / ((samples.length / session.sampleRate) * 1000),
          windowSec: session.config.windowSec,
          stepSec: session.config.stepSec,
          overlapSec: session.config.overlapSec,
          duplicateSuppressedCount: session.duplicateSuppressedCount,
          overlapPrefixTrimCount: session.overlapPrefixTrimCount,
          ...preprocessed.metrics
        }
      });
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
      session.inferenceRunning = false;
    }
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      emit({ type: 'error', backend, error: 'Invalid JSON message' });
      return;
    }

    if (message.type === 'config') {
      try {
        activeConfig = validateConfig(message, activeConfig);
        for (const session of sessions.values()) {
          session.applyConfig(activeConfig);
        }
        emit({ type: 'status', status: 'config-updated', backend, config: activeConfig });
      } catch (error) {
        emit({ type: 'error', backend, error: error.message });
      }
      return;
    }

    if (message.type !== 'audio') return;
    if (!message.meetingId || !message.speakerId || !Array.isArray(message.audio)) return;

    if (message.sttConfig) {
      try {
        activeConfig = validateConfig(message.sttConfig, activeConfig);
      } catch (error) {
        emit({ type: 'error', backend, error: error.message });
      }
    }

    const sampleRate = Number(message.sampleRate || 16000);
    const key = `${message.meetingId}:${message.speakerId}`;
    let session = sessions.get(key);
    if (!session) {
      session = new SessionState({
        meetingId: message.meetingId,
        speakerId: message.speakerId,
        sampleRate,
        config: activeConfig
      });
      sessions.set(key, session);
    } else if (message.sttConfig) {
      session.applyConfig(activeConfig);
    }

    session.push(message.audio);
    maybeInfer(session).catch((error) => emit({ type: 'error', backend, error: error.message }));
  });

  process.on('exit', () => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ type: 'error', error: error.message })}\n`);
  process.exit(1);
});
