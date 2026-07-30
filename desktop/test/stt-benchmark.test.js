const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  calculateWer,
  cleanHypothesis,
  normalizeForWer,
  parsePcmWav,
  summarize,
  validateSampleId,
  validateStreamingWav
} = require('../stt/benchmark-whisper.cpp');
const { SessionState, normalizeForCompare } = require('../stt/whisper-streaming-sidecar');
const {
  adjustRangeToWordBoundaries,
  extractReferenceWords,
  writeMonoPcm16Wav
} = require('../stt/prepare-ami-benchmark');

function wavChunk(id, data) {
  const padding = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, padding]);
}

function createPcmWav({ sampleRate = 16000, channels = 1, samples = [0, 1000, -1000] } = {}) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * channels * 2, 8);
  fmt.writeUInt16LE(channels * 2, 12);
  fmt.writeUInt16LE(16, 14);

  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const chunks = [wavChunk('JUNK', Buffer.from([1, 2, 3])), wavChunk('fmt ', fmt), wavChunk('data', data)];
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

test('normalizes AMI transcript markers consistently', () => {
  assert.equal(
    normalizeForWer("\uFEFFThat's $ [sound imitating beep] basi- TEST@ twenty."),
    "that's twenty"
  );
  assert.equal(normalizeForWer('complete unfinished-'), 'complete');
  assert.equal(normalizeForCompare('Crème brûlée!'), 'crème brûlée');
});

test('calculates substitutions, insertions, and corpus-safe counts', () => {
  const result = calculateWer('one two three', 'one too three four');
  assert.deepEqual(
    {
      substitutions: result.substitutions,
      deletions: result.deletions,
      insertions: result.insertions,
      errors: result.errors,
      referenceWords: result.referenceWords,
      hypothesisWords: result.hypothesisWords,
      wer: result.wer
    },
    {
      substitutions: 1,
      deletions: 0,
      insertions: 1,
      errors: 2,
      referenceWords: 3,
      hypothesisWords: 4,
      wer: 2 / 3
    }
  );
});

test('handles empty WER inputs explicitly', () => {
  assert.equal(calculateWer('', '').wer, 0);
  const insertionOnly = calculateWer('', 'hallucinated words');
  assert.equal(insertionOnly.wer, null);
  assert.equal(insertionOnly.insertions, 2);
  const deletionOnly = calculateWer('missing words', '');
  assert.equal(deletionOnly.deletions, 2);
  assert.equal(deletionOnly.wer, 1);
});

test('cleans complete Whisper hypotheses without changing lexical text', () => {
  assert.equal(cleanHypothesis('  Hello,   世界!\n'), 'Hello, 世界!');
  assert.equal(cleanHypothesis('[BLANK_AUDIO] (music)'), '');
});

test('summarizes finite benchmark values', () => {
  assert.deepEqual(summarize([1, 2, 3, null]), {
    count: 3,
    average: 2,
    p50: 2,
    p95: 3,
    max: 3
  });
});

test('parses PCM WAV files with extra and odd-sized chunks', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-benchmark-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'sample.wav');
  fs.writeFileSync(filePath, createPcmWav());

  const wav = parsePcmWav(filePath);
  assert.equal(wav.sampleRate, 16000);
  assert.equal(wav.channels, 1);
  assert.equal(wav.sampleFrames, 3);
  assert.doesNotThrow(() => validateStreamingWav(wav, filePath));
});

test('rejects non-mono streaming WAV input', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-benchmark-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'stereo.wav');
  fs.writeFileSync(filePath, createPcmWav({ channels: 2, samples: [0, 0, 100, 100] }));

  const wav = parsePcmWav(filePath);
  assert.throws(() => validateStreamingWav(wav, filePath), /mono 16 kHz/);
});

test('SessionState permits a pending short tail only when forced', () => {
  const session = new SessionState({
    meetingId: 'meeting',
    speakerId: 'speaker',
    sampleRate: 100,
    config: { windowSec: 2, overlapSec: 1, maxBufferSec: 2 }
  });
  session.push(new Array(50).fill(0.1));
  assert.equal(session.shouldRun(), false);
  assert.equal(session.shouldRun({ force: true }), true);
});

test('SessionState counts only unprocessed buffer overflow', () => {
  const session = new SessionState({
    meetingId: 'meeting',
    speakerId: 'speaker',
    sampleRate: 100,
    config: { windowSec: 2, overlapSec: 1, maxBufferSec: 2 }
  });
  session.push(new Array(300).fill(0.1));
  assert.equal(session.bufferOverflowSamples, 100);

  session.lastInferenceAtSample = 300;
  session.push(new Array(100).fill(0.1));
  assert.equal(session.bufferOverflowSamples, 100);
});

test('SessionState reports gaps between covered inference windows', () => {
  const session = new SessionState({
    meetingId: 'meeting',
    speakerId: 'speaker',
    sampleRate: 100,
    config: { windowSec: 2, overlapSec: 1, maxBufferSec: 4 }
  });
  session.push(new Array(300).fill(0.1));
  const window = session.getWindow();
  session.recordCoverage(window.startSample, window.endSample);
  assert.equal(session.uncoveredSamples, 100);
  assert.equal(session.lastCoveredSample, 300);
});

test('extracts lexical AMI words inside the selected interval', () => {
  const document = {
    'nite:root': {
      w: [
        { '#text': 'before', starttime: '1', endtime: '2' },
        { '#text': 'hello', starttime: '5', endtime: '5.5' },
        { '#text': ',', starttime: '5.5', endtime: '5.5', punc: 'true' },
        { '#text': 'wor', starttime: '6', endtime: '6.2', trunc: 'true' },
        { '#text': 'world', starttime: '6.2', endtime: '7' }
      ]
    }
  };
  assert.deepEqual(extractReferenceWords(document, 5, 8), ['hello', 'world']);
});

test('expands AMI clips to avoid cutting a reference word', () => {
  const document = {
    'nite:root': {
      w: [
        { '#text': 'hello', starttime: '4.8', endtime: '5.2' },
        { '#text': 'world', starttime: '7.8', endtime: '8.2' }
      ]
    }
  };
  assert.deepEqual(adjustRangeToWordBoundaries(document, 5, 8), { startSec: 4.8, endSec: 8.2 });
});

test('writes canonical streaming WAV output', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-benchmark-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'written.wav');
  writeMonoPcm16Wav(filePath, new Float32Array([0, 0.5, -0.5]), 16000);
  const wav = parsePcmWav(filePath);
  assert.equal(wav.sampleFrames, 3);
  assert.doesNotThrow(() => validateStreamingWav(wav, filePath));
});

test('rejects non-portable and colliding Windows sample names', () => {
  assert.equal(validateSampleId('ES2004a-A'), 'ES2004a-A');
  assert.throws(() => validateSampleId('../escape'), /Unsafe sample id/);
  assert.throws(() => validateSampleId('CON'), /Reserved sample id/);
  assert.throws(() => validateSampleId('sample.'), /Unsafe sample id/);
});
