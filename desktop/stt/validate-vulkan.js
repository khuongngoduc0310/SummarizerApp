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
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node desktop/stt/validate-vulkan.js \
    --binary desktop/stt/bin/vulkan/whisper-cli.exe \
    --model desktop/stt/models/ggml-base.en.bin \
    --sample desktop/stt/samples/clean.wav

Optional:
  --timeoutMs 15000
  --out benchmark-results/vulkan-validation.json
`);
}

function readWavDurationSec(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
    const byteRate = header.readUInt32LE(28);
    const dataSize = header.readUInt32LE(40);
    if (!byteRate || !dataSize) return null;
    return dataSize / byteRate;
  } finally {
    fs.closeSync(fd);
  }
}

function runWhisper({ binary, model, sample, timeoutMs }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(binary, ['-m', model, '-f', sample, '-nt', '-np'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr, timedOut });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = performance.now() - started;
      resolve({ ok: code === 0 && !timedOut, code, signal, elapsedMs, stdout, stderr, timedOut });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.binary || !args.model || !args.sample) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const binary = path.resolve(args.binary);
  const model = path.resolve(args.model);
  const sample = path.resolve(args.sample);
  const timeoutMs = Number(args.timeoutMs || 15000);
  const binaryDir = path.dirname(binary);
  const requiredFiles = process.platform === 'win32' ? ['whisper-cli.exe', 'ggml-vulkan.dll'] : [path.basename(binary)];
  const missingFiles = requiredFiles.filter((name) => !fs.existsSync(path.join(binaryDir, name)));

  if (missingFiles.length) {
    throw new Error(`Vulkan backend is missing required files: ${missingFiles.join(', ')}`);
  }
  if (!fs.existsSync(model)) throw new Error(`Model not found: ${model}`);
  if (!fs.existsSync(sample)) throw new Error(`Sample not found: ${sample}`);

  const durationSec = /\.wav$/i.test(sample) ? readWavDurationSec(sample) : null;
  const result = await runWhisper({ binary, model, sample, timeoutMs });
  const realtimeFactor = durationSec ? result.elapsedMs / (durationSec * 1000) : null;
  const combinedOutput = `${result.stderr}\n${result.stdout}`;

  const report = {
    backend: 'vulkan',
    ok: result.ok,
    binary,
    model,
    sample,
    durationSec,
    elapsedMs: result.elapsedMs,
    realtimeFactor,
    timedOut: result.timedOut,
    code: result.code,
    signal: result.signal,
    error: result.error,
    sawVulkanLog: /vulkan|gpu/i.test(combinedOutput),
    stdoutTail: result.stdout?.slice(-4000),
    stderrTail: result.stderr?.slice(-4000),
    recordedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.out) {
    const out = path.resolve(args.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
  }

  process.exit(report.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
