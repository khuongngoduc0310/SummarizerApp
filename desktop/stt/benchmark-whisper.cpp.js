#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
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

function usage() {
  console.log(`Usage:
  node desktop/stt/benchmark-whisper.cpp.js \\
    --binary <path-to-whisper-cli> \\
    --model <path-to-ggml-model.bin> \\
    --samples <wav-file-or-directory> \\
    --backend <cpu|vulkan|cuda|openvino> \\
    --out benchmark-results/native-cpu.json

Notes:
  - The binary should be a whisper.cpp CLI executable, commonly whisper-cli.exe or main.exe.
  - Use a CPU binary for --backend cpu and a Vulkan-enabled binary for --backend vulkan.
  - WAV duration is parsed for PCM WAV files. Other formats can run but may not get realtime factor.
`);
}

function listSamples(input) {
  const resolved = path.resolve(input);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return [resolved];

  return fs.readdirSync(resolved)
    .filter((name) => /\.(wav|mp3|m4a|flac)$/i.test(name))
    .map((name) => path.join(resolved, name));
}

function readWavDurationSec(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }

    const byteRate = header.readUInt32LE(28);
    const dataSize = header.readUInt32LE(40);
    if (!byteRate || !dataSize) return null;
    return dataSize / byteRate;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function runWhisper({ binary, model, sample }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(binary, ['-m', model, '-f', sample, '-nt', '-np'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (error) => {
      resolve({ ok: false, error: error.message, stdout, stderr });
    });

    child.on('exit', (code, signal) => {
      const elapsedMs = performance.now() - started;
      resolve({ ok: code === 0, code, signal, elapsedMs, stdout, stderr });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.binary || !args.model || !args.samples) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const binary = path.resolve(args.binary);
  const model = path.resolve(args.model);
  const samples = listSamples(args.samples);
  const backend = args.backend || 'unknown';
  const out = args.out ? path.resolve(args.out) : null;

  if (!fs.existsSync(binary)) throw new Error(`Binary not found: ${binary}`);
  if (!fs.existsSync(model)) throw new Error(`Model not found: ${model}`);
  if (samples.length === 0) throw new Error(`No audio samples found: ${args.samples}`);

  const results = [];
  for (const sample of samples) {
    const durationSec = /\.wav$/i.test(sample) ? readWavDurationSec(sample) : null;
    console.log(`[whisper.cpp benchmark] backend=${backend} sample=${path.basename(sample)}`);
    const result = await runWhisper({ binary, model, sample });
    const realtimeFactor = durationSec ? result.elapsedMs / (durationSec * 1000) : null;

    const row = {
      backend,
      binary,
      model,
      sample,
      durationSec,
      elapsedMs: result.elapsedMs,
      realtimeFactor,
      ok: result.ok,
      code: result.code,
      signal: result.signal,
      error: result.error,
      stdoutTail: result.stdout?.slice(-4000),
      stderrTail: result.stderr?.slice(-4000),
      recordedAt: new Date().toISOString()
    };

    results.push(row);
    console.log(JSON.stringify({
      sample: path.basename(sample),
      ok: row.ok,
      elapsedMs: Math.round(row.elapsedMs),
      durationSec: row.durationSec,
      realtimeFactor: row.realtimeFactor
    }, null, 2));
  }

  const report = {
    tool: 'whisper.cpp',
    backend,
    binary,
    model,
    sampleCount: samples.length,
    results
  };

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`Wrote benchmark report: ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
