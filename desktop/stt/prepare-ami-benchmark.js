#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { parsePcmWav, validateSampleId, validateStreamingWav } = require('./benchmark-whisper.cpp');
const { parseArgs } = require('./args-utils');
const { sha256File } = require('./hash-utils');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  processEntities: true
});

function usage() {
  console.log(`Usage:
  node desktop/stt/prepare-ami-benchmark.js \\
    --ami-root <directory-containing-AMI-audio-and-annotations> \\
    --profile <quick|release|profile.json> \\
    --out desktop/stt/samples/ami-ihm-quick

The AMI root must contain corpusResources/meetings.xml, words/*.words.xml,
and the selected individual headset WAV files.
`);
}

function indexFiles(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        const key = entry.name.toLowerCase();
        const matches = files.get(key) || [];
        matches.push(fullPath);
        files.set(key, matches);
      }
    }
  };
  visit(root);
  return files;
}

function findIndexedFile(index, basename) {
  const matches = index.get(basename.toLowerCase()) || [];
  if (matches.length !== 1) {
    throw new Error(`${basename}: expected one file under AMI root, found ${matches.length}`);
  }
  return matches[0];
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseXmlFile(filePath) {
  return xmlParser.parse(fs.readFileSync(filePath, 'latin1'));
}

function loadMeetingMap(meetingsPath) {
  const document = parseXmlFile(meetingsPath);
  const meetings = arrayOf(document['nite:root']?.meeting);
  return new Map(meetings.map((meeting) => [meeting.observation, meeting]));
}

function lexicalWords(wordsDocument) {
  return arrayOf(wordsDocument['nite:root']?.w)
    .filter((word) => word.punc !== 'true' && word.trunc !== 'true')
    .map((word) => ({
      text: decodeEntities(String(word['#text'] ?? '').trim()),
      start: Number(word.starttime),
      end: Number(word.endtime)
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function adjustRangeToWordBoundaries(wordsDocument, startSec, endSec) {
  let adjustedStart = startSec;
  let adjustedEnd = endSec;
  for (const word of lexicalWords(wordsDocument)) {
    if (word.start < adjustedStart && word.end > adjustedStart) adjustedStart = word.start;
    if (word.start < adjustedEnd && word.end > adjustedEnd) adjustedEnd = word.end;
  }
  return { startSec: adjustedStart, endSec: adjustedEnd };
}

function extractReferenceWords(wordsDocument, startSec, endSec) {
  return lexicalWords(wordsDocument)
    .filter((word) => word.start >= startSec && word.end <= endSec)
    .map((word) => word.text);
}

function writeMonoPcm16Wav(filePath, samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(Math.round(value), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function resolveProfile(profileArg) {
  const builtIn = path.join(__dirname, 'benchmark-datasets', `ami-ihm-${profileArg}.json`);
  const profilePath = fs.existsSync(builtIn) ? builtIn : path.resolve(profileArg);
  if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profileArg}`);
  return { profilePath, profile: JSON.parse(fs.readFileSync(profilePath, 'utf8')) };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args['ami-root'] || !args.profile || !args.out) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const amiRoot = path.resolve(args['ami-root']);
  const out = path.resolve(args.out);
  if (!fs.existsSync(amiRoot)) throw new Error(`AMI root not found: ${amiRoot}`);
  const { profilePath, profile } = resolveProfile(args.profile);
  if (profile.schemaVersion !== 1) throw new Error(`Unsupported profile schemaVersion: ${profile.schemaVersion}`);
  if (!Array.isArray(profile.samples) || !profile.samples.length) throw new Error(`Profile has no samples: ${profilePath}`);

  console.log(`Indexing AMI files under ${amiRoot}`);
  const fileIndex = indexFiles(amiRoot);
  const meetingsPath = findIndexedFile(fileIndex, 'meetings.xml');
  const meetings = loadMeetingMap(meetingsPath);
  const audioDirectory = path.join(out, 'audio');
  const referenceDirectory = path.join(out, 'references');
  fs.mkdirSync(audioDirectory, { recursive: true });
  fs.mkdirSync(referenceDirectory, { recursive: true });

  const generatedSamples = [];
  const generatedIds = new Set();
  for (const selection of profile.samples) {
    const meeting = meetings.get(selection.meetingId);
    if (!meeting) throw new Error(`Meeting not found in meetings.xml: ${selection.meetingId}`);
    const speaker = arrayOf(meeting.speaker).find((candidate) => candidate.nxt_agent === selection.speakerId);
    if (!speaker) throw new Error(`Speaker ${selection.speakerId} not found for ${selection.meetingId}`);

    const sourceAudio = findIndexedFile(fileIndex, `${selection.meetingId}.Headset-${speaker.channel}.wav`);
    const sourceWords = findIndexedFile(fileIndex, `${selection.meetingId}.${selection.speakerId}.words.xml`);
    const wav = parsePcmWav(sourceAudio);
    validateStreamingWav(wav, sourceAudio);
    const requestedStartSec = Number(selection.startSec || 0);
    const requestedEndSec = selection.endSec === null || selection.endSec === undefined
      ? wav.durationSec
      : Number(selection.endSec);
    const wordsDocument = parseXmlFile(sourceWords);
    const adjustedRange = adjustRangeToWordBoundaries(wordsDocument, requestedStartSec, requestedEndSec);
    const startSec = adjustedRange.startSec;
    const endSec = adjustedRange.endSec;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || endSec > wav.durationSec) {
      throw new Error(`Invalid range ${startSec}-${endSec} for ${selection.meetingId} (${wav.durationSec}s)`);
    }

    const startSample = Math.round(startSec * wav.sampleRate);
    const endSample = Math.round(endSec * wav.sampleRate);
    const id = selection.id || `${selection.meetingId}-${selection.speakerId}-${startSample}-${endSample}`;
    const idKey = validateSampleId(id).toLowerCase();
    if (generatedIds.has(idKey)) throw new Error(`Duplicate sample id: ${id}`);
    generatedIds.add(idKey);
    const audioName = `${id}.wav`;
    const referenceName = `${id}.txt`;
    const outputAudio = path.join(audioDirectory, audioName);
    const outputReference = path.join(referenceDirectory, referenceName);
    writeMonoPcm16Wav(outputAudio, wav.samples.subarray(startSample, endSample), wav.sampleRate);

    const words = extractReferenceWords(wordsDocument, startSec, endSec);
    if (!words.length) throw new Error(`No reference words selected for ${id}`);
    fs.writeFileSync(outputReference, `${words.join(' ')}\n`, 'utf8');
    generatedSamples.push({
      id,
      meetingId: selection.meetingId,
      speakerId: selection.speakerId,
      headsetChannel: Number(speaker.channel),
      role: speaker.role || null,
      startSec,
      endSec,
      audio: path.relative(out, outputAudio).replace(/\\/g, '/'),
      reference: path.relative(out, outputReference).replace(/\\/g, '/'),
      audioSha256: sha256File(outputAudio),
      referenceSha256: sha256File(outputReference),
      referenceWords: words.length
    });
    console.log(`Prepared ${id}: ${(endSec - startSec).toFixed(1)}s, ${words.length} reference words`);
  }

  const manifest = {
    schemaVersion: 1,
    dataset: {
      ...profile.dataset,
      source: 'AMI Meeting Corpus manual annotations v1.6.2 and individual headset audio',
      license: 'CC BY 4.0',
      profile: path.basename(profilePath),
      profileSha256: sha256File(profilePath),
      preparedAt: new Date().toISOString()
    },
    samples: generatedSamples
  };
  const manifestPath = path.join(out, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${manifestPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { adjustRangeToWordBoundaries, extractReferenceWords, loadMeetingMap, writeMonoPcm16Wav };
