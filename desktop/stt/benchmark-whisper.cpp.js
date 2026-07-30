#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const { StringDecoder } = require('string_decoder');

const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|flac)$/i;
const DEFAULT_TIMEOUT_MS = 120000;
const FRAME_DURATION_SEC = 0.1;

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

function usage() {
  console.log(`Usage:
  node desktop/stt/benchmark-whisper.cpp.js \\
    --binary <path-to-whisper-cli> \\
    --model <path-to-model> \\
    (--manifest <dataset.json> | --samples <audio-file-or-directory>) \\
    --mode <offline|streaming|both> \\
    --backend <cpu|vulkan|cuda|openvino> \\
    --out benchmark-results/native.json

Optional:
  --references <txt-file-or-directory>
  --transcripts-dir benchmark-results/transcripts
  --sidecar desktop/stt/whisper-streaming-sidecar.js
  --language en
  --pace <realtime|fast>
  --timeoutMs 120000
  --windowSec 4 --overlapSec 1 --maxBufferSec 8
  --vadThreshold 0.003 --highPassCutoffHz 100
  --dcOffsetRemoval <true|false>
  --highPassFilter <true|false>
  --normalizeAudio <true|false>
  --silenceTrim <true|false>

Notes:
  - Streaming mode requires mono 16 kHz 16-bit PCM WAV input.
  - Realtime pacing is required for representative streaming latency.
  - Offline remains the default mode for compatibility with existing commands.
`);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received: ${value}`);
}

function parseFiniteNumber(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {
      try { child.kill(); } catch {}
      resolve();
    });
    killer.on('close', resolve);
  });
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summarize(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return { count: 0, average: null, p50: null, p95: null, max: null };
  return {
    count: valid.length,
    average: valid.reduce((sum, value) => sum + value, 0) / valid.length,
    p50: percentile(valid, 0.5),
    p95: percentile(valid, 0.95),
    max: Math.max(...valid)
  };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function parsePcmWav(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${filePath}`);
  }

  let format = null;
  let dataOffset = null;
  let dataSize = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new Error(`Truncated WAV chunk ${chunkId}: ${filePath}`);

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error(`Invalid WAV fmt chunk: ${filePath}`);
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    } else if (chunkId === 'data' && dataOffset === null) {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format || dataOffset === null) throw new Error(`WAV is missing fmt or data chunk: ${filePath}`);
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`WAV must use 16-bit PCM: ${filePath}`);
  }
  if (!format.blockAlign || dataSize % format.blockAlign !== 0) {
    throw new Error(`WAV data is not frame-aligned: ${filePath}`);
  }

  const sampleFrames = dataSize / format.blockAlign;
  const samples = new Float32Array(sampleFrames * format.channels);
  let sampleOffset = dataOffset;
  for (let i = 0; i < samples.length; i += 1) {
    const value = buffer.readInt16LE(sampleOffset);
    samples[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
    sampleOffset += 2;
  }

  return {
    ...format,
    durationSec: sampleFrames / format.sampleRate,
    sampleFrames,
    samples
  };
}

function validateStreamingWav(wav, filePath) {
  if (wav.channels !== 1 || wav.sampleRate !== 16000 || wav.bitsPerSample !== 16 || wav.audioFormat !== 1) {
    throw new Error(`Streaming input must be mono 16 kHz 16-bit PCM WAV: ${filePath}`);
  }
}

function normalizeForWer(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\S*@\S*/g, ' ')
    .replace(/\b[\p{L}\p{N}']+-(?=\s|$)/gu, ' ')
    .replace(/[$%#@]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .replace(/(^|\s)'|'(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseCandidate(candidates) {
  return candidates.reduce((best, candidate) => {
    if (!best || candidate.cost < best.cost) return candidate;
    return best;
  }, null);
}

function calculateWer(referenceText, hypothesisText) {
  const normalizedReference = normalizeForWer(referenceText);
  const normalizedHypothesis = normalizeForWer(hypothesisText);
  const reference = normalizedReference ? normalizedReference.split(' ') : [];
  const hypothesis = normalizedHypothesis ? normalizedHypothesis.split(' ') : [];

  if (!reference.length) {
    return {
      substitutions: 0,
      deletions: 0,
      insertions: hypothesis.length,
      errors: hypothesis.length,
      referenceWords: 0,
      hypothesisWords: hypothesis.length,
      wer: hypothesis.length ? null : 0,
      normalizedReference,
      normalizedHypothesis
    };
  }

  const columns = hypothesis.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => ({
    cost: index,
    substitutions: 0,
    deletions: 0,
    insertions: index
  }));

  for (let i = 1; i <= reference.length; i += 1) {
    const current = new Array(columns);
    current[0] = { cost: i, substitutions: 0, deletions: i, insertions: 0 };
    for (let j = 1; j <= hypothesis.length; j += 1) {
      if (reference[i - 1] === hypothesis[j - 1]) {
        current[j] = { ...previous[j - 1] };
        continue;
      }

      const diagonal = previous[j - 1];
      const above = previous[j];
      const left = current[j - 1];
      current[j] = chooseCandidate([
        { cost: diagonal.cost + 1, substitutions: diagonal.substitutions + 1, deletions: diagonal.deletions, insertions: diagonal.insertions },
        { cost: above.cost + 1, substitutions: above.substitutions, deletions: above.deletions + 1, insertions: above.insertions },
        { cost: left.cost + 1, substitutions: left.substitutions, deletions: left.deletions, insertions: left.insertions + 1 }
      ]);
    }
    previous = current;
  }

  const result = previous[hypothesis.length];
  return {
    substitutions: result.substitutions,
    deletions: result.deletions,
    insertions: result.insertions,
    errors: result.cost,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    wer: result.cost / reference.length,
    normalizedReference,
    normalizedHypothesis
  };
}

function cleanHypothesis(stdout) {
  return String(stdout || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listAudioFiles(input) {
  const resolved = path.resolve(input);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];
  return fs.readdirSync(resolved)
    .filter((name) => AUDIO_EXTENSIONS.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(resolved, name));
}

function findReference(referenceInput, sample, sampleCount) {
  if (!referenceInput) return null;
  const resolved = path.resolve(referenceInput);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (sampleCount !== 1) throw new Error('--references may be a file only when one sample is selected');
    return resolved;
  }

  const parsed = path.parse(sample);
  const candidates = [
    path.join(resolved, `${parsed.name}.txt`),
    path.join(resolved, `${parsed.base}.txt`)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadDataset(args) {
  if (args.manifest) {
    const manifestPath = path.resolve(args.manifest);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
    if (!Array.isArray(manifest.samples) || !manifest.samples.length) {
      throw new Error(`Manifest has no samples: ${manifestPath}`);
    }
    const baseDir = path.dirname(manifestPath);
    return {
      manifestPath,
      metadata: manifest.dataset || { name: path.basename(manifestPath, path.extname(manifestPath)) },
      samples: manifest.samples.map((entry, index) => {
        const id = entry.id || `sample-${index + 1}`;
        validateSampleId(id);
        return {
          ...entry,
          id,
          audio: path.resolve(baseDir, entry.audio || entry.sample),
          reference: entry.reference ? path.resolve(baseDir, entry.reference) : null
        };
      })
    };
  }

  if (!args.samples) throw new Error('Either --manifest or --samples is required');
  const audioFiles = listAudioFiles(args.samples);
  return {
    manifestPath: null,
    metadata: { name: path.basename(path.resolve(args.samples)) },
    samples: audioFiles.map((audio, index) => ({
      id: validateSampleId(safeFileName(path.parse(audio).name || `sample-${index + 1}`)),
      audio,
      reference: findReference(args.references, audio, audioFiles.length)
    }))
  };
}

function runOfflineWhisper({ binary, model, sample, language, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const commandArgs = ['-m', model, '-f', sample, '-nt', '-np'];
    if (language) commandArgs.push('-l', language);
    const child = spawn(binary, commandArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stdout = '';
    let stderr = '';
    let childError = null;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += stdoutDecoder.write(data); });
    child.stderr.on('data', (data) => { stderr += stderrDecoder.write(data); });
    child.on('error', (error) => { childError = error; });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      resolve({
        ok: !childError && !timedOut && code === 0,
        code,
        signal,
        error: childError?.message,
        timedOut,
        elapsedMs: performance.now() - startedAt,
        stdout,
        stderr,
        args: commandArgs
      });
    });
  });
}

function streamingConfigFromArgs(args) {
  return {
    windowSec: parseFiniteNumber(args.windowSec, 4, 'windowSec'),
    overlapSec: parseFiniteNumber(args.overlapSec, 1, 'overlapSec'),
    maxBufferSec: parseFiniteNumber(args.maxBufferSec, 8, 'maxBufferSec'),
    vadThreshold: parseFiniteNumber(args.vadThreshold, 0.003, 'vadThreshold'),
    highPassCutoffHz: parseFiniteNumber(args.highPassCutoffHz, 100, 'highPassCutoffHz'),
    dcOffsetRemoval: parseBoolean(args.dcOffsetRemoval, true),
    highPassFilter: parseBoolean(args.highPassFilter, true),
    normalizeAudio: parseBoolean(args.normalizeAudio, true),
    silenceTrim: parseBoolean(args.silenceTrim, true)
  };
}

async function runStreamingSidecar({ sidecar, binary, model, backend, language, wav, sampleId, config, pace, timeoutMs }) {
  const meetingId = `benchmark-${sampleId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const speakerId = 'speaker-1';
  const sidecarArgs = [
    sidecar,
    '--binary', binary,
    '--model', model,
    '--backend', backend,
    '--language', language,
    '--windowSec', String(config.windowSec),
    '--overlapSec', String(config.overlapSec),
    '--maxBufferSec', String(config.maxBufferSec),
    '--vadThreshold', String(config.vadThreshold),
    '--highPassCutoffHz', String(config.highPassCutoffHz),
    '--dcOffsetRemoval', String(config.dcOffsetRemoval),
    '--highPassFilter', String(config.highPassFilter),
    '--normalizeAudio', String(config.normalizeAudio),
    '--silenceTrim', String(config.silenceTrim),
    '--inferenceTimeoutMs', String(timeoutMs)
  ];
  const childStartedAt = performance.now();
  const child = spawn(process.execPath, sidecarArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const events = [];
  const waiters = [];
  let stdoutBuffer = '';
  let stderr = '';
  let closed = false;
  let closeInfo = null;

  const settleWaiters = (eventRecord) => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].predicate(eventRecord.event)) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(eventRecord);
      }
    }
  };
  const parseLines = () => {
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines.filter(Boolean)) {
      try {
        const record = { event: JSON.parse(line), receivedAtMs: performance.now() };
        events.push(record);
        settleWaiters(record);
      } catch (error) {
        events.push({ event: { type: 'protocol-error', error: error.message, line }, receivedAtMs: performance.now() });
      }
    }
  };
  child.stdout.on('data', (data) => {
    stdoutBuffer += stdoutDecoder.write(data);
    parseLines();
  });
  child.stderr.on('data', (data) => { stderr += stderrDecoder.write(data); });

  const closePromise = new Promise((resolve) => {
    child.on('error', (error) => {
      closeInfo = { error: error.message };
    });
    child.on('close', (code, signal) => {
      closed = true;
      stdoutBuffer += stdoutDecoder.end();
      parseLines();
      stderr += stderrDecoder.end();
      closeInfo = { ...closeInfo, code, signal };
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`Sidecar exited before expected event: code=${code} signal=${signal}`));
      }
      resolve(closeInfo);
    });
  });

  const waitForEvent = (predicate, label) => {
    const existing = events.find((record) => predicate(record.event));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for sidecar ${label}`));
      }, timeoutMs);
      waiters.push({ predicate, resolve, reject, timer });
    });
  };

  let backpressureCount = 0;
  let backpressureMs = 0;
  const writeMessage = async (message) => {
    if (closed || child.stdin.destroyed) throw new Error('Sidecar stdin is closed');
    const startedAt = performance.now();
    if (!child.stdin.write(`${JSON.stringify(message)}\n`)) {
      backpressureCount += 1;
      await once(child.stdin, 'drain');
      backpressureMs += performance.now() - startedAt;
    }
  };

  let mediaStartedAt = null;
  let flushStartedAt = null;
  const scheduleLatenessMs = [];
  let flushRecord = null;
  let forcedTermination = false;
  try {
    const readyRecord = await waitForEvent((event) => event.type === 'status' && event.status === 'ready', 'readiness');
    const sidecarReadyMs = readyRecord.receivedAtMs - childStartedAt;
    const frameSamples = Math.round(wav.sampleRate * FRAME_DURATION_SEC);
    mediaStartedAt = performance.now();

    let sequence = 0;
    for (let start = 0; start < wav.samples.length; start += frameSamples) {
      const frameEnd = Math.min(wav.samples.length, start + frameSamples);
      const targetMs = mediaStartedAt + (frameEnd / wav.sampleRate) * 1000;
      if (pace === 'realtime') {
        const waitMs = targetMs - performance.now();
        if (waitMs > 0) await delay(waitMs);
      }
      if (pace === 'realtime') scheduleLatenessMs.push(performance.now() - targetMs);
      const frame = wav.samples.subarray(start, frameEnd);
      sequence += 1;
      await writeMessage({
        type: 'audio',
        meetingId,
        speakerId,
        sequence,
        sampleRate: wav.sampleRate,
        format: 'f32le',
        durationSec: frame.length / wav.sampleRate,
        capturedAt: Date.now(),
        sttConfig: config,
        audio: Array.from(frame)
      });
    }

    const requestId = `${meetingId}-${Date.now()}`;
    flushStartedAt = performance.now();
    await writeMessage({ type: 'flush', meetingId, speakerId, requestId });
    flushRecord = await waitForEvent(
      (event) => event.type === 'flushed' && event.requestId === requestId,
      'flush acknowledgment'
    );

    child.stdin.end();
    const closedNormally = await Promise.race([
      closePromise.then(() => true),
      delay(1000).then(() => false)
    ]);
    if (!closedNormally) {
      forcedTermination = true;
      await terminateProcessTree(child);
      const closedAfterKill = await Promise.race([
        closePromise.then(() => true),
        delay(5000).then(() => false)
      ]);
      if (!closedAfterKill) throw new Error('Sidecar did not terminate after flush');
    }

    const finals = events
      .filter((record) => record.event.type === 'final' && record.event.meetingId === meetingId)
      .sort((a, b) => a.event.sequence - b.event.sequence);
    const utteranceIds = new Set();
    let previousSequence = 0;
    for (const record of finals) {
      if (utteranceIds.has(record.event.utteranceId)) throw new Error(`Duplicate utteranceId: ${record.event.utteranceId}`);
      if (record.event.sequence <= previousSequence) throw new Error('Streaming final sequence is not increasing');
      utteranceIds.add(record.event.utteranceId);
      previousSequence = record.event.sequence;
    }

    const inferenceEnds = events.filter((record) => record.event.type === 'telemetry' && record.event.event === 'inference-end');
    const errors = events.filter((record) => record.event.type === 'error' || record.event.type === 'protocol-error');
    const hypothesis = finals.map((record) => record.event.text.trim()).filter(Boolean).join(' ');
    const captionLags = pace === 'realtime'
      ? finals.map((record) => record.receivedAtMs - (mediaStartedAt + record.event.end * 1000))
      : [];
    const inferenceTimes = inferenceEnds.map((record) => record.event.inferenceTimeMs);
    const windowRtfs = inferenceEnds.map((record) => (
      record.event.audioDurationSec
        ? record.event.inferenceTimeMs / (record.event.audioDurationSec * 1000)
        : null
    ));
    const firstCaptionMs = pace === 'realtime' && finals.length
      ? finals[0].receivedAtMs - mediaStartedAt
      : null;
    const flush = flushRecord.event;
    const totalInferenceMs = inferenceTimes.filter(Number.isFinite).reduce((sum, value) => sum + value, 0);

    return {
      ok: Boolean(flush.ok)
        && errors.length === 0
        && flush.totalSamplesReceived === wav.samples.length
        && flush.pendingSamples === 0
        && flush.uncoveredSamples === 0
        && flush.bufferOverflowSamples === 0
        && !forcedTermination
        && closeInfo?.code === 0
        && !closeInfo?.signal,
      hypothesis,
      finals: finals.map((record) => ({
        ...record.event,
        receivedAtMs: record.receivedAtMs - mediaStartedAt
      })),
      telemetry: events
        .filter((record) => record.event.type === 'telemetry')
        .map((record) => ({ ...record.event, receivedAtMs: record.receivedAtMs - mediaStartedAt })),
      errors: errors.map((record) => record.event),
      flush,
      stderrTail: stderr.slice(-4000),
      close: closeInfo,
      forcedTermination,
      performance: {
        pace,
        latencyRepresentative: pace === 'realtime',
        sidecarReadyMs,
        timeToFirstCaptionMs: firstCaptionMs,
        captionLagValuesMs: captionLags,
        captionLagMs: summarize(captionLags),
        inferenceTimeValuesMs: inferenceTimes,
        inferenceTimeMs: summarize(inferenceTimes),
        windowRealtimeFactorValues: windowRtfs.filter(Number.isFinite),
        windowRealtimeFactor: summarize(windowRtfs),
        computeLoadFactor: wav.durationSec ? totalInferenceMs / (wav.durationSec * 1000) : null,
        feedScheduleLatenessMs: summarize(scheduleLatenessMs),
        feedScheduleLatenessValuesMs: scheduleLatenessMs,
        backpressureCount,
        backpressureMs,
        flushLatencyMs: flushRecord.receivedAtMs - flushStartedAt,
        endToEndCompletionMs: flushRecord.receivedAtMs - mediaStartedAt,
        frameCount: Math.ceil(wav.samples.length / frameSamples),
        samplesSent: wav.samples.length
      },
      args: [process.execPath, ...sidecarArgs]
    };
  } finally {
    if (!child.stdin.destroyed) child.stdin.end();
    if (!closed) {
      await terminateProcessTree(child);
      await Promise.race([closePromise, delay(5000)]);
    }
  }
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function validateSampleId(value) {
  const id = String(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.endsWith('.')) {
    throw new Error(`Unsafe sample id: ${id}`);
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw new Error(`Reserved sample id: ${id}`);
  }
  return id;
}

function writeTranscript(directory, sampleId, mode, text) {
  if (!directory) return null;
  const resolvedDirectory = path.resolve(directory);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const filePath = path.join(resolvedDirectory, `${safeFileName(sampleId)}.${mode}.txt`);
  fs.writeFileSync(filePath, text ? `${text}\n` : '', 'utf8');
  return filePath;
}

function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, resolved);
}

function aggregateAccuracy(results, mode) {
  const scores = results.map((result) => result[mode]?.accuracy).filter(Boolean);
  if (!scores.length) return null;
  const totals = scores.reduce((aggregate, score) => ({
    substitutions: aggregate.substitutions + score.substitutions,
    deletions: aggregate.deletions + score.deletions,
    insertions: aggregate.insertions + score.insertions,
    errors: aggregate.errors + score.errors,
    referenceWords: aggregate.referenceWords + score.referenceWords,
    hypothesisWords: aggregate.hypothesisWords + score.hypothesisWords
  }), { substitutions: 0, deletions: 0, insertions: 0, errors: 0, referenceWords: 0, hypothesisWords: 0 });
  return {
    ...totals,
    scoredSampleCount: scores.length,
    attemptedSampleCount: results.filter((result) => result[mode]).length,
    complete: scores.length === results.filter((result) => result[mode]).length,
    wer: totals.referenceWords ? totals.errors / totals.referenceWords : (totals.errors ? null : 0)
  };
}

function aggregateReport(results, mode) {
  const modeResults = results.map((result) => result[mode]).filter(Boolean);
  if (!modeResults.length) return null;
  if (mode === 'offline') {
    return {
      successCount: modeResults.filter((result) => result.ok).length,
      failureCount: modeResults.filter((result) => !result.ok).length,
      noCaptionCount: modeResults.filter((result) => result.hypothesis === '').length,
      accuracy: aggregateAccuracy(results, mode),
      elapsedMs: summarize(modeResults.map((result) => result.elapsedMs)),
      realtimeFactor: summarize(modeResults.map((result) => result.realtimeFactor))
    };
  }

  const performance = modeResults.map((result) => result.performance).filter(Boolean);
  return {
    successCount: modeResults.filter((result) => result.ok).length,
    failureCount: modeResults.filter((result) => !result.ok).length,
    noCaptionCount: modeResults.filter((result) => result.hypothesis === '').length,
    accuracy: aggregateAccuracy(results, mode),
    timeToFirstCaptionMs: summarize(performance.map((metric) => metric.timeToFirstCaptionMs)),
    captionLagMs: summarize(performance.flatMap((metric) => metric.captionLagValuesMs || [])),
    inferenceTimeMs: summarize(performance.flatMap((metric) => metric.inferenceTimeValuesMs || [])),
    windowRealtimeFactor: summarize(performance.flatMap((metric) => metric.windowRealtimeFactorValues || [])),
    computeLoadFactor: summarize(performance.map((metric) => metric.computeLoadFactor)),
    feedScheduleLatenessMs: summarize(performance.flatMap((metric) => metric.feedScheduleLatenessValuesMs || [])),
    flushLatencyMs: summarize(performance.map((metric) => metric.flushLatencyMs)),
    bufferOverflowSamples: modeResults.reduce((sum, result) => sum + Number(result.flush?.bufferOverflowSamples || 0), 0),
    uncoveredSamples: modeResults.reduce((sum, result) => sum + Number(result.flush?.uncoveredSamples || 0), 0),
    pendingSamples: modeResults.reduce((sum, result) => sum + Number(result.flush?.pendingSamples || 0), 0),
    coalescedInferenceCount: modeResults.reduce((sum, result) => sum + Number(result.flush?.coalescedInferenceCount || 0), 0),
    vadSkipCount: modeResults.reduce((sum, result) => sum + Number(result.flush?.vadSkipCount || 0), 0),
    duplicateSuppressedCount: modeResults.reduce((sum, result) => sum + Number(result.flush?.duplicateSuppressedCount || 0), 0),
    overlapPrefixTrimCount: modeResults.reduce((sum, result) => sum + Number(result.flush?.overlapPrefixTrimCount || 0), 0),
    errorCount: modeResults.reduce((sum, result) => sum + Number(result.flush?.errorCount || result.errors?.length || 0), 0)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.binary || !args.model || (!args.samples && !args.manifest)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const mode = args.mode || 'offline';
  const pace = args.pace || 'realtime';
  if (!['offline', 'streaming', 'both'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (!['realtime', 'fast'].includes(pace)) throw new Error(`Unsupported pace: ${pace}`);

  const binary = path.resolve(args.binary);
  const model = path.resolve(args.model);
  const sidecar = path.resolve(args.sidecar || path.join(__dirname, 'whisper-streaming-sidecar.js'));
  const backend = args.backend || 'unknown';
  const language = args.language || 'en';
  const timeoutMs = parseFiniteNumber(args.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const config = streamingConfigFromArgs(args);
  const dataset = loadDataset(args);
  const out = args.out ? path.resolve(args.out) : null;

  if (!fs.existsSync(binary)) throw new Error(`Binary not found: ${binary}`);
  if (!fs.existsSync(model)) throw new Error(`Model not found: ${model}`);
  if ((mode === 'streaming' || mode === 'both') && !fs.existsSync(sidecar)) throw new Error(`Sidecar not found: ${sidecar}`);
  if (!dataset.samples.length) throw new Error('No audio samples found');

  const sampleIds = new Set();
  for (const sample of dataset.samples) {
    const sampleKey = validateSampleId(sample.id).toLowerCase();
    if (sampleIds.has(sampleKey)) throw new Error(`Duplicate sample id: ${sample.id}`);
    sampleIds.add(sampleKey);
    if (!fs.existsSync(sample.audio)) throw new Error(`Sample not found: ${sample.audio}`);
    if (sample.reference && !fs.existsSync(sample.reference)) throw new Error(`Reference not found: ${sample.reference}`);
    if ((args.manifest || args.references) && !sample.reference) throw new Error(`Reference missing for sample: ${sample.id}`);
    sample.observedAudioSha256 = sha256File(sample.audio);
    sample.observedReferenceSha256 = sample.reference ? sha256File(sample.reference) : null;
    if (sample.audioSha256 && sample.audioSha256 !== sample.observedAudioSha256) {
      throw new Error(`Audio hash mismatch for sample: ${sample.id}`);
    }
    if (sample.referenceSha256 && sample.referenceSha256 !== sample.observedReferenceSha256) {
      throw new Error(`Reference hash mismatch for sample: ${sample.id}`);
    }
  }

  const report = {
    schemaVersion: 1,
    tool: 'MeetSummarizer native STT benchmark',
    dataset: {
      ...dataset.metadata,
      manifest: dataset.manifestPath,
      manifestSha256: dataset.manifestPath ? sha256File(dataset.manifestPath) : null,
      normalization: 'ami-wer-v1'
    },
    run: {
      mode,
      pace,
      backend,
      language,
      binary,
      binarySha256: sha256File(binary),
      model,
      modelSha256: sha256File(model),
      sidecar: mode === 'offline' ? null : sidecar,
      streamingConfig: mode === 'offline' ? null : config,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpu: os.cpus()[0]?.model || null,
      startedAt: new Date().toISOString()
    },
    aggregate: null,
    samples: []
  };

  let hadFailure = false;
  for (const sample of dataset.samples) {
    console.log(`[STT benchmark] sample=${sample.id} mode=${mode} backend=${backend}`);
    const row = {
      id: sample.id,
      audio: sample.audio,
      audioSha256: sample.observedAudioSha256,
      reference: sample.reference,
      referenceSha256: sample.observedReferenceSha256,
      recordedAt: new Date().toISOString()
    };
    let wav = null;
    if (/\.wav$/i.test(sample.audio)) {
      wav = parsePcmWav(sample.audio);
      row.audioMetadata = {
        durationSec: wav.durationSec,
        sampleRate: wav.sampleRate,
        channels: wav.channels,
        bitsPerSample: wav.bitsPerSample,
        sampleFrames: wav.sampleFrames
      };
    }
    const referenceText = sample.reference ? fs.readFileSync(sample.reference, 'utf8') : null;

    if (mode === 'offline' || mode === 'both') {
      const result = await runOfflineWhisper({ binary, model, sample: sample.audio, language, timeoutMs });
      const hypothesis = result.ok ? cleanHypothesis(result.stdout) : null;
      row.offline = {
        ok: result.ok,
        hypothesis,
        transcriptPath: result.ok ? writeTranscript(args['transcripts-dir'], sample.id, 'offline', hypothesis) : null,
        accuracy: referenceText !== null ? calculateWer(referenceText, hypothesis || '') : null,
        elapsedMs: result.elapsedMs,
        realtimeFactor: wav?.durationSec ? result.elapsedMs / (wav.durationSec * 1000) : null,
        timedOut: result.timedOut,
        code: result.code,
        signal: result.signal,
        error: result.error,
        stderrTail: result.stderr.slice(-4000),
        args: [binary, ...result.args]
      };
      if (!result.ok) hadFailure = true;
    }

    if (mode === 'streaming' || mode === 'both') {
      try {
        if (!wav) throw new Error(`Streaming mode requires WAV input: ${sample.audio}`);
        validateStreamingWav(wav, sample.audio);
        const result = await runStreamingSidecar({
          sidecar,
          binary,
          model,
          backend,
          language,
          wav,
          sampleId: sample.id,
          config,
          pace,
          timeoutMs
        });
        row.streaming = {
          ...result,
          transcriptPath: result.ok ? writeTranscript(args['transcripts-dir'], sample.id, 'streaming', result.hypothesis) : null,
          accuracy: referenceText !== null ? calculateWer(referenceText, result.hypothesis || '') : null
        };
        if (!result.ok) hadFailure = true;
      } catch (error) {
        hadFailure = true;
        row.streaming = {
          ok: false,
          error: error.message,
          hypothesis: null,
          accuracy: referenceText !== null ? calculateWer(referenceText, '') : null
        };
      }
    }

    report.samples.push(row);
    report.aggregate = {
      streaming: aggregateReport(report.samples, 'streaming'),
      offline: aggregateReport(report.samples, 'offline')
    };
    if (out) writeJsonAtomic(out, report);
    console.log(JSON.stringify({
      sample: sample.id,
      offlineWer: row.offline?.accuracy?.wer ?? null,
      streamingWer: row.streaming?.accuracy?.wer ?? null,
      streamingComputeLoad: row.streaming?.performance?.computeLoadFactor ?? null,
      ok: Boolean((!row.offline || row.offline.ok) && (!row.streaming || row.streaming.ok))
    }, null, 2));
  }

  report.completedAt = new Date().toISOString();
  if (out) {
    writeJsonAtomic(out, report);
    console.log(`Wrote benchmark report: ${out}`);
  }
  if (hadFailure) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  calculateWer,
  cleanHypothesis,
  normalizeForWer,
  parsePcmWav,
  summarize,
  validateSampleId,
  validateStreamingWav
};
