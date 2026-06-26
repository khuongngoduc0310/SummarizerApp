const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class NativeSttManager extends EventEmitter {
  constructor({ baseDir }) {
    super();
    this.baseDir = baseDir;
    this.process = null;
    this.selectedBackend = null;
    this.selectedModel = null;
    this.fallbackReason = null;
    this.backends = [];
    this.models = [];
    this.stdoutBuffer = '';
    this.config = {
      windowSec: 4,
      overlapSec: 1,
      stepSec: 3,
      maxBufferSec: 8,
      vadThreshold: 0.008,
      dcOffsetRemoval: true,
      highPassFilter: true,
      highPassCutoffHz: 100,
      normalizeAudio: true,
      silenceTrim: true
    };
    this.status = 'not-started';
  }

  detectBackends() {
    const candidates = [
      {
        id: 'cpu',
        label: 'CPU',
        binary: path.join(this.baseDir, 'bin', 'cpu', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
      },
      {
        id: 'vulkan',
        label: 'Vulkan GPU',
        binary: path.join(this.baseDir, 'bin', 'vulkan', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
      }
    ];

    this.backends = candidates.map((candidate) => ({
      ...candidate,
      available: fs.existsSync(candidate.binary)
    }));

    const modelsDir = path.join(this.baseDir, 'models');
    this.models = fs.existsSync(modelsDir)
      ? fs.readdirSync(modelsDir)
        .filter((name) => /\.(bin|gguf)$/i.test(name))
        .map((name) => ({ id: name, path: path.join(modelsDir, name), available: true }))
      : [];

    const preferred = this.backends.find((backend) => backend.id === 'vulkan' && backend.available)
      || this.backends.find((backend) => backend.id === 'cpu' && backend.available);

    this.selectedBackend = preferred?.id || null;
    this.selectedModel = this.selectedModel || this.models[0]?.path || null;

    if (!preferred) {
      this.fallbackReason = 'No native STT binaries found in desktop/stt/bin';
      this.status = 'unavailable';
    } else if (!this.selectedModel) {
      this.fallbackReason = 'No Whisper model found in desktop/stt/models';
      this.status = 'unavailable';
    } else {
      this.fallbackReason = null;
      this.status = 'detected';
    }

    return this.backends;
  }

  getStatus() {
    return {
      available: this.backends.some((backend) => backend.available),
      status: this.status,
      selectedBackend: this.selectedBackend,
      selectedModel: this.selectedModel,
      fallbackReason: this.fallbackReason,
      backends: this.backends.map(({ id, label, binary, available }) => ({ id, label, binary, available })),
      models: this.models,
      realtimeFactor: null,
      config: this.config
    };
  }

  validateConfig(config) {
    const windowSec = Number(config.windowSec ?? this.config.windowSec);
    const overlapSecRaw = Number(config.overlapSec ?? this.config.overlapSec);
    const maxBufferSec = Number(config.maxBufferSec ?? this.config.maxBufferSec);

    if (!Number.isFinite(windowSec) || windowSec < 2 || windowSec > 10) {
      return { ok: false, error: 'windowSec must be between 2 and 10 seconds' };
    }

    if (!Number.isFinite(overlapSecRaw) || overlapSecRaw < 0 || overlapSecRaw >= windowSec) {
      return { ok: false, error: 'overlapSec must be >= 0 and less than windowSec' };
    }

    const stepSec = Math.max(0.5, windowSec - overlapSecRaw);
    const overlapSec = windowSec - stepSec;

    if (!Number.isFinite(maxBufferSec) || maxBufferSec < windowSec || maxBufferSec > 30) {
      return { ok: false, error: 'maxBufferSec must be between windowSec and 30 seconds' };
    }

    const vadThreshold = Number(config.vadThreshold ?? this.config.vadThreshold ?? 0.008);
    const highPassCutoffHz = Number(config.highPassCutoffHz ?? this.config.highPassCutoffHz ?? 100);

    if (!Number.isFinite(vadThreshold) || vadThreshold < 0 || vadThreshold > 0.1) {
      return { ok: false, error: 'vadThreshold must be between 0 and 0.1' };
    }
    if (!Number.isFinite(highPassCutoffHz) || highPassCutoffHz < 20 || highPassCutoffHz > 300) {
      return { ok: false, error: 'highPassCutoffHz must be between 20 and 300 Hz' };
    }

    return {
      ok: true,
      config: {
        windowSec,
        overlapSec,
        stepSec,
        maxBufferSec,
        vadThreshold,
        dcOffsetRemoval: config.dcOffsetRemoval ?? this.config.dcOffsetRemoval ?? true,
        highPassFilter: config.highPassFilter ?? this.config.highPassFilter ?? true,
        highPassCutoffHz,
        normalizeAudio: config.normalizeAudio ?? this.config.normalizeAudio ?? true,
        silenceTrim: config.silenceTrim ?? this.config.silenceTrim ?? true
      }
    };
  }

  updateConfig(config) {
    const validated = this.validateConfig(config);
    if (!validated.ok) return validated;

    this.config = validated.config;

    if (this.process && this.status === 'running') {
      this.process.stdin.write(JSON.stringify({ type: 'config', ...this.config }) + '\n');
    }

    return { ok: true, status: this.getStatus() };
  }

  setBackend(backendId) {
    const backend = this.backends.find((candidate) => candidate.id === backendId);
    if (!backend) {
      return { ok: false, error: `Unknown STT backend: ${backendId}` };
    }
    if (!backend.available) {
      return { ok: false, error: `STT backend is not installed: ${backendId}` };
    }

    this.selectedBackend = backendId;
    this.fallbackReason = null;
    this.status = 'detected';
    return { ok: true, status: this.getStatus() };
  }

  setModel(modelPath) {
    if (typeof modelPath !== 'string' || modelPath.length === 0) {
      return { ok: false, error: 'Model path is required' };
    }

    const resolved = path.resolve(modelPath);
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `Model not found: ${resolved}` };
    }

    this.selectedModel = resolved;
    return { ok: true, status: this.getStatus() };
  }

  startSidecar() {
    if (this.process && this.status === 'running') {
      return { ok: true, status: this.getStatus() };
    }

    const backend = this.backends.find((candidate) => candidate.id === this.selectedBackend);
    if (!backend?.available) {
      this.status = 'unavailable';
      this.fallbackReason = 'No selected native STT backend is available';
      return { ok: false, reason: this.fallbackReason };
    }

    if (!this.selectedModel || !fs.existsSync(this.selectedModel)) {
      this.status = 'unavailable';
      this.fallbackReason = 'No selected Whisper model is available';
      return { ok: false, reason: this.fallbackReason };
    }

    const sidecarScript = process.env.STT_SIDECAR_SCRIPT
      ? path.resolve(process.env.STT_SIDECAR_SCRIPT)
      : path.join(this.baseDir, 'whisper-streaming-sidecar.js');

    if (!fs.existsSync(sidecarScript)) {
      this.status = 'unavailable';
      this.fallbackReason = `STT sidecar script not found: ${sidecarScript}`;
      return { ok: false, reason: this.fallbackReason };
    }

    const nodeBinary = process.env.NODE_BINARY || 'node';
    const args = [
      sidecarScript,
      '--binary', backend.binary,
      '--model', this.selectedModel,
      '--backend', backend.id,
      '--windowSec', String(this.config.windowSec),
      '--overlapSec', String(this.config.overlapSec),
      '--stepSec', String(this.config.stepSec),
      '--maxBufferSec', String(this.config.maxBufferSec),
      '--vadThreshold', String(this.config.vadThreshold),
      '--highPassCutoffHz', String(this.config.highPassCutoffHz)
    ];

    this.process = spawn(nodeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.stdout.on('data', (data) => this.handleStdout(data));
    this.process.stderr.on('data', (data) => process.stderr.write(`[stt] ${data}`));
    this.process.on('error', (error) => {
      this.status = 'unavailable';
      this.fallbackReason = `Failed to start STT sidecar: ${error.message}`;
      this.process = null;
      this.emit('status', this.getStatus());
    });
    this.process.on('exit', (code, signal) => {
      this.status = 'stopped';
      this.fallbackReason = `STT sidecar exited: code=${code} signal=${signal}`;
      this.process = null;
      this.emit('status', this.getStatus());
    });

    this.status = 'running';
    this.emit('status', this.getStatus());
    return { ok: true, status: this.getStatus() };
  }

  handleStdout(data) {
    this.stdoutBuffer += data.toString();
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines.filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event?.type === 'partial' || event?.type === 'final') {
          this.emit('transcript', event);
        } else if (event?.type === 'status') {
          this.emit('status', this.getStatus());
        } else if (event?.type === 'telemetry') {
          this.emit('telemetry', event);
        } else if (event?.type === 'error') {
          process.stderr.write(`[stt] ${event.error}\n`);
          this.emit('error-event', event);
        }
      } catch {
        process.stdout.write(`[stt] ${line}\n`);
      }
    }
  }

  sendAudioFrame(frame) {
    if (!this.process || this.status !== 'running') {
      return { ok: false, error: 'Native STT sidecar is not running' };
    }

    try {
      this.process.stdin.write(JSON.stringify({ type: 'audio', ...frame }) + '\n');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.status = this.selectedBackend ? 'detected' : 'unavailable';
    return { ok: true, status: this.getStatus() };
  }
}

module.exports = { NativeSttManager };
