const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

let _koffiAvailable = null;
function isKoffiAvailable() {
  if (_koffiAvailable !== null) return _koffiAvailable;
  try { require('koffi'); _koffiAvailable = true; }
  catch { _koffiAvailable = false; }
  return _koffiAvailable;
}

function killProcessTree(child) {
  if (process.platform !== 'win32') {
    child.kill();
    return;
  }

  const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore'
  });
  killer.on('error', () => {
    try { child.kill(); } catch {}
  });
  killer.unref();
}

function defaultBackendDescriptors(baseDir) {
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const serverExecutable = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  const ffiDll = process.platform === 'win32' ? 'whisper.dll' : 'libwhisper.so';
  const koffiOk = isKoffiAvailable();
  return [
    {
      id: 'cuda', label: 'CUDA GPU', acceleration: 'gpu', priority: 15,
      binary: path.join(baseDir, 'bin', 'cuda', executable),
      serverBinary: path.join(baseDir, 'bin', 'cuda', serverExecutable),
      hasFFI: false,
      requiredFiles: [executable]
    },
    {
      id: 'vulkan', label: 'Vulkan GPU', acceleration: 'gpu', priority: 10,
      binary: path.join(baseDir, 'bin', 'vulkan', executable),
      serverBinary: path.join(baseDir, 'bin', 'vulkan', serverExecutable),
      hasFFI: koffiOk && fs.existsSync(path.join(baseDir, 'bin', 'vulkan', ffiDll)),
      ffiDir: path.join(baseDir, 'bin', 'vulkan'),
      requiredFiles: process.platform === 'win32' ? [executable, 'ggml-vulkan.dll'] : [executable]
    },
    {
      id: 'cpu', label: 'CPU', acceleration: 'cpu', priority: 5,
      binary: path.join(baseDir, 'bin', 'cpu', executable),
      serverBinary: path.join(baseDir, 'bin', 'cpu', serverExecutable),
      hasFFI: koffiOk && fs.existsSync(path.join(baseDir, 'bin', 'cpu', ffiDll)),
      ffiDir: path.join(baseDir, 'bin', 'cpu'),
      requiredFiles: [executable]
    }
  ];
}

function createPreflightWav() {
  const sampleRate = 16000;
  const sampleCount = 1600;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 256), 44 + index * 2);
  }
  return wav;
}

class NativeSttManager extends EventEmitter {
  constructor({
    baseDir,
    modelDirs = [],
    installedBackends,
    backendPreference = 'auto',
    nodeBinary = process.execPath,
    nodeEnv = {},
    spawn: spawnProcess = spawn,
    preflight = null,
    timeouts = {},
    killProcess = killProcessTree
  }) {
    super();
    this.baseDir = baseDir;
    this.modelDirs = [path.join(baseDir, 'models'), ...modelDirs];
    this.installedBackends = installedBackends === undefined
      ? defaultBackendDescriptors(baseDir)
      : installedBackends;
    this.backendPreference = backendPreference;
    this.nodeBinary = nodeBinary;
    this.nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...nodeEnv };
    this.spawnProcess = spawnProcess;
    this.preflight = preflight;
    this.timeouts = {
      preflightMs: timeouts.preflightMs ?? 30000,
      readinessMs: timeouts.readinessMs ?? 10000
    };
    this.killProcess = killProcess;

    this.process = null;
    this.processBinding = null;
    this.preflightBinding = null;
    this.selectedBackend = backendPreference === 'auto' ? null : backendPreference;
    this.activeBackend = null;
    this.attemptBackend = null;
    this.selectedModel = null;
    this.modelDisplayName = null;
    this.fallbackReason = null;
    this.backends = [];
    this.models = [];
    this.backendFailures = [];
    this.inferenceRunning = false;
    this.consecutiveInferenceFailures = 0;
    this.failedInferenceIds = new Set();
    this.lastRealtimeFactor = null;
    this.nativeReady = false;
    this.phase = 'idle';
    this.status = 'not-started';
    this.desiredRunning = false;
    this.attemptGeneration = 0;
    this.config = {
      windowSec: 4,
      overlapSec: 1,
      stepSec: 3,
      maxBufferSec: 8,
      vadThreshold: 0.003,
      nThreads: 4,
      dcOffsetRemoval: true,
      highPassFilter: true,
      highPassCutoffHz: 100,
      normalizeAudio: true,
      silenceTrim: true
    };
  }

  detectBackends() {
    this.backends = this.installedBackends.map((descriptor) => {
      const binary = path.resolve(descriptor.binary);
      const binaryDir = path.dirname(binary);
      const requiredFiles = descriptor.requiredFiles?.length
        ? descriptor.requiredFiles
        : [path.basename(binary)];
      const missingFiles = requiredFiles.filter((name) => {
        const requiredPath = path.isAbsolute(name) ? name : path.join(binaryDir, name);
        return !fs.existsSync(requiredPath);
      });
      const available = descriptor.available !== false && missingFiles.length === 0;
      const validationStatus = available ? 'not-run' : 'missing-files';
      const validationError = available ? null : `Missing ${missingFiles.join(', ')}`;
      return {
        ...descriptor,
        binary,
        requiredFiles: [...requiredFiles],
        available,
        missingFiles,
        validationStatus,
        validationError,
        validation: { status: validationStatus, error: validationError, missingFiles: [...missingFiles] }
      };
    });

    const seenModelPaths = new Set();
    this.models = this.modelDirs.flatMap((modelsDir) => {
      if (!fs.existsSync(modelsDir)) return [];
      return fs.readdirSync(modelsDir)
        .filter((name) => /\.(bin|gguf)$/i.test(name))
        .map((name) => {
          const modelPath = path.join(modelsDir, name);
          return {
            id: name,
            path: modelPath,
            available: true,
            source: path.resolve(modelsDir) === path.resolve(path.join(this.baseDir, 'models')) ? 'bundled' : 'downloaded'
          };
        });
    }).filter((model) => {
      const resolved = path.resolve(model.path);
      if (seenModelPaths.has(resolved)) return false;
      seenModelPaths.add(resolved);
      return true;
    });

    if (this.selectedModel && !fs.existsSync(this.selectedModel)) this.selectedModel = null;
    this.selectedModel = this.selectedModel || this.models[0]?.path || null;
    this.modelDisplayName = this.selectedModel ? path.basename(this.selectedModel) : null;

    if (!this.backends.some((backend) => backend.available)) {
      this.fallbackReason = 'No native STT binaries found';
      this.status = 'unavailable';
      this.phase = 'unavailable';
    } else if (!this.selectedModel) {
      this.fallbackReason = 'No Whisper model found';
      this.status = 'unavailable';
      this.phase = 'unavailable';
    } else if (!this.nativeReady && !this.desiredRunning) {
      this.fallbackReason = null;
      this.status = 'detected';
      this.phase = 'idle';
    }

    return this.backends;
  }

  getStatus() {
    const selectedBackend = this.backendPreference === 'auto'
      ? (this.activeBackend || this.attemptBackend || this.selectedBackend)
      : this.backendPreference;
    return {
      available: this.backends.some((backend) => backend.available),
      status: this.status,
      selectedBackend,
      selectedModel: this.selectedModel,
      fallbackReason: this.fallbackReason,
      backendPreference: this.backendPreference,
      activeBackend: this.activeBackend,
      attemptBackend: this.attemptBackend,
      nativeReady: this.nativeReady,
      phase: this.phase,
      attemptGeneration: this.attemptGeneration,
      backendFailures: this.backendFailures.map((failure) => ({ ...failure })),
      failures: this.backendFailures.map((failure) => ({ ...failure })),
      backends: this.backends.map((backend) => ({
        ...backend,
        requiredFiles: [...backend.requiredFiles],
        missingFiles: [...backend.missingFiles],
        validation: { ...backend.validation, missingFiles: [...backend.validation.missingFiles] }
      })),
      models: this.models,
      realtimeFactor: this.lastRealtimeFactor,
      inferenceRunning: this.inferenceRunning,
      modelDisplayName: this.modelDisplayName,
      config: this.config
    };
  }

  validateConfig(config) {
    const windowSec = Number(config.windowSec ?? this.config.windowSec);
    const overlapSecRaw = Number(config.overlapSec ?? this.config.overlapSec);
    const maxBufferSec = Number(config.maxBufferSec ?? this.config.maxBufferSec);
    if (!Number.isFinite(windowSec) || windowSec < 2 || windowSec > 10) return { ok: false, error: 'windowSec must be between 2 and 10 seconds' };
    if (!Number.isFinite(overlapSecRaw) || overlapSecRaw < 0 || overlapSecRaw >= windowSec) return { ok: false, error: 'overlapSec must be >= 0 and less than windowSec' };
    const stepSec = Math.max(0.5, windowSec - overlapSecRaw);
    const overlapSec = windowSec - stepSec;
    if (!Number.isFinite(maxBufferSec) || maxBufferSec < windowSec || maxBufferSec > 30) return { ok: false, error: 'maxBufferSec must be between windowSec and 30 seconds' };
    const vadThreshold = Number(config.vadThreshold ?? this.config.vadThreshold ?? 0.003);
    const highPassCutoffHz = Number(config.highPassCutoffHz ?? this.config.highPassCutoffHz ?? 100);
    if (!Number.isFinite(vadThreshold) || vadThreshold < 0 || vadThreshold > 0.1) return { ok: false, error: 'vadThreshold must be between 0 and 0.1' };
    if (!Number.isFinite(highPassCutoffHz) || highPassCutoffHz < 20 || highPassCutoffHz > 300) return { ok: false, error: 'highPassCutoffHz must be between 20 and 300 Hz' };
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
    if (this.process && this.nativeReady) this._writeMessage({ type: 'config', ...this.config });
    return { ok: true, status: this.getStatus() };
  }

  async setBackendPreference(backendPreference) {
    if (backendPreference !== 'auto' && !this.backends.some((backend) => backend.id === backendPreference)) {
      return { ok: false, error: `Unknown STT backend: ${backendPreference}` };
    }
    this.backendPreference = backendPreference;
    this.selectedBackend = backendPreference === 'auto' ? this.activeBackend : backendPreference;
    this.backendFailures = [];
    this._invalidateAttempt();
    if (this.desiredRunning) {
      const result = await this.reconcile();
      if (!result.ok && !result.stale) {
        return { ok: true, warning: result.error || result.reason, status: this.getStatus() };
      }
      return result;
    }
    this._setIdleStatus();
    return { ok: true, status: this.getStatus() };
  }

  async setBackend(backendId) {
    return this.setBackendPreference(backendId);
  }

  async setModel(modelPath) {
    if (typeof modelPath !== 'string' || modelPath.length === 0) return { ok: false, error: 'Model path is required' };
    const resolved = path.resolve(modelPath);
    if (!fs.existsSync(resolved)) return { ok: false, error: `Model not found: ${resolved}` };
    this.selectedModel = resolved;
    this.modelDisplayName = path.basename(resolved);
    this.backendFailures = [];
    this._invalidateAttempt();
    if (this.desiredRunning) return this.reconcile();
    this._setIdleStatus();
    return { ok: true, status: this.getStatus() };
  }

  refreshModels() {
    this.detectBackends();
    return this.getStatus();
  }

  async startSidecar() {
    if (this.nativeReady && this.process) return { ok: true, status: this.getStatus() };
    this.desiredRunning = true;
    this.backendFailures = [];
    return this.reconcile();
  }

  async reconcile({ excludeBackends = [] } = {}) {
    if (!this.desiredRunning) return { ok: true, status: this.getStatus() };
    const generation = ++this.attemptGeneration;
    this._disposePreflight();
    this._disposeCurrentProcess(true);
    this.activeBackend = null;
    this.nativeReady = false;
    this.inferenceRunning = false;

    if (!this.backends.length) this.detectBackends();
    if (!this.selectedModel || !fs.existsSync(this.selectedModel)) {
      return this._failGeneration(generation, 'No selected Whisper model is available');
    }

    const excluded = new Set(excludeBackends);
    const rank = { cuda: 0, vulkan: 1, cpu: 2 };
    const candidates = this.backends
      .filter((backend) => backend.available && !excluded.has(backend.id))
      .filter((backend) => this.backendPreference === 'auto' || backend.id === this.backendPreference)
      .sort((left, right) => (rank[left.id] ?? 100) - (rank[right.id] ?? 100));
    if (!candidates.length) {
      const reason = this.backendPreference === 'auto'
        ? 'No native STT backend is available'
        : `STT backend is not installed: ${this.backendPreference}`;
      return this._failGeneration(generation, reason);
    }

    for (const backend of candidates) {
      if (!this._isCurrent(generation)) return { ok: false, stale: true, status: this.getStatus() };
      this.attemptBackend = backend.id;
      this.phase = 'preflighting';
      this.status = 'starting';
      this.emit('status', this.getStatus());
      const preflightResult = await this._runPreflight(backend, generation);
      if (!this._isCurrent(generation)) return { ok: false, stale: true, status: this.getStatus() };
      if (!preflightResult.ok) {
        this._recordFailure(backend.id, 'preflight', preflightResult.error, generation);
        this._setBackendValidation(backend, 'failed', preflightResult.error);
        if (this.backendPreference !== 'auto') break;
        continue;
      }
      this._setBackendValidation(backend, 'passed', null);

      const ffiSidecar = path.join(this.baseDir, 'whisper-ffi-sidecar.js');
      const cliSidecar = path.join(this.baseDir, 'whisper-streaming-sidecar.js');
      const useFFI = backend.hasFFI && process.env.STT_SIDECAR_SCRIPT === undefined && fs.existsSync(ffiSidecar);
      const sidecarScript = process.env.STT_SIDECAR_SCRIPT
        ? path.resolve(process.env.STT_SIDECAR_SCRIPT)
        : useFFI ? ffiSidecar : cliSidecar;
      if (!fs.existsSync(sidecarScript)) {
        this._recordFailure(backend.id, 'startup', `STT sidecar script not found: ${sidecarScript}`, generation);
        if (this.backendPreference !== 'auto') break;
        continue;
      }

      this.phase = 'starting';
      this.emit('status', this.getStatus());
      const launchResult = await this._launchSidecar(backend, sidecarScript, generation);
      if (!this._isCurrent(generation)) return { ok: false, stale: true, status: this.getStatus() };
      if (launchResult.ok) {
        this.activeBackend = backend.id;
        this.selectedBackend = backend.id;
        this.attemptBackend = null;
        this.nativeReady = true;
        this.phase = 'running';
        this.status = 'running';
        this.fallbackReason = this.backendFailures.length ? this.backendFailures.at(-1).error : null;
        this.consecutiveInferenceFailures = 0;
        this.emit('status', this.getStatus());
        return { ok: true, status: this.getStatus() };
      }
      this._disposeCurrentProcess(true);
      this._recordFailure(backend.id, 'startup', launchResult.error, generation);
      if (this.backendPreference !== 'auto') break;
    }

    const reason = this.backendFailures.at(-1)?.error || 'No native STT backend could be started';
    return this._failGeneration(generation, reason);
  }

  async _runPreflight(backend, generation) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetsummarizer-stt-preflight-'));
    const wavPath = path.join(tempDir, 'preflight.wav');
    fs.writeFileSync(wavPath, createPreflightWav());
    try {
      if (this.preflight) {
        const result = await this._withTimeout(
          Promise.resolve(this.preflight({ backend, model: this.selectedModel, wavPath, generation })),
          this.timeouts.preflightMs,
          `STT ${backend.id} preflight timed out`
        );
        if (result === false || result?.ok === false) return { ok: false, error: result?.error || `STT ${backend.id} preflight failed` };
        return { ok: true };
      }
      return await this._spawnPreflight(backend, wavPath, generation);
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  _spawnPreflight(backend, wavPath, generation) {
    return new Promise((resolve) => {
      let child;
      try {
        child = this.spawnProcess(backend.binary, ['-m', this.selectedModel, '-f', wavPath, '-nt', '-np'], {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
          env: this._getBackendEnv(backend)
        });
      } catch (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      let settled = false;
      let stderr = '';
      let timer;
      const finish = (result, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        child.stderr?.removeListener('data', onStderr);
        if (kill && !child.killed) this.killProcess(child);
        if (this.preflightBinding?.child === child) this.preflightBinding = null;
        resolve(result);
      };
      const onStderr = (data) => { stderr += data.toString(); };
      const onError = (error) => finish({ ok: false, error: error.message });
      const onClose = (code, signal) => finish(code === 0
        ? { ok: true }
        : { ok: false, error: stderr.trim() || `Preflight exited: code=${code} signal=${signal}` });
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
      timer = setTimeout(() => finish({ ok: false, error: `STT ${backend.id} preflight timed out` }, true), this.timeouts.preflightMs);
      timer.unref?.();
      this.preflightBinding = {
        child,
        cancel: () => finish({ ok: false, error: 'STT preflight attempt was superseded' }, true)
      };
      if (!this._isCurrent(generation)) finish({ ok: false, error: 'Stale STT preflight' }, true);
    });
  }

  _launchSidecar(backend, sidecarScript, generation) {
    return new Promise((resolve) => {
      const isFFI = path.basename(sidecarScript).includes('ffi');
      const args = [
        sidecarScript,
        '--model', this.selectedModel,
        '--backend', backend.id,
        '--windowSec', String(this.config.windowSec),
        '--overlapSec', String(this.config.overlapSec),
        '--stepSec', String(this.config.stepSec),
        '--maxBufferSec', String(this.config.maxBufferSec),
        '--vadThreshold', String(this.config.vadThreshold),
        '--highPassCutoffHz', String(this.config.highPassCutoffHz)
      ];
      if (isFFI) {
        if (backend.ffiDir) args.push('--ffi-dir', backend.ffiDir);
        args.push('--n-threads', String(this.config.nThreads ?? 4));
      } else {
        args.push('--binary', backend.binary);
        const serverBinary = backend.serverBinary ? path.resolve(backend.serverBinary) : null;
        if (serverBinary && fs.existsSync(serverBinary)) {
          args.push('--server-binary', serverBinary);
        }
      }
      let child;
      try {
        child = this.spawnProcess(this.nodeBinary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: this.nodeEnv
        });
      } catch (error) {
        resolve({ ok: false, error: `Failed to start STT sidecar: ${error.message}` });
        return;
      }

      this.process = child;
      let stdoutBuffer = '';
      let readySettled = false;
      const finishReady = (result) => {
        if (readySettled) return;
        readySettled = true;
        clearTimeout(readinessTimer);
        resolve(result);
      };
      const onStdout = (data) => {
        if (!this._isCurrentChild(child, generation)) return;
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        for (const line of lines.filter(Boolean)) {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            process.stdout.write(`[stt] ${line}\n`);
            continue;
          }
          const matchingReady = event?.type === 'status'
            && event.status === 'ready'
            && event.backend === backend.id
            && path.resolve(event.model || '') === path.resolve(this.selectedModel);
          if (matchingReady) finishReady({ ok: true });
          this._handleSidecarEvent(event, child, generation, backend.id);
        }
      };
      const onStderr = (data) => {
        if (this._isCurrentChild(child, generation)) process.stderr.write(`[stt] ${data}`);
      };
      const onStdinError = (error) => {
        if (this._isCurrentChild(child, generation)) this._handleRuntimeFailure(backend.id, `STT sidecar stdin error: ${error.message}`, generation);
      };
      const onError = (error) => {
        if (!this._isCurrentChild(child, generation)) return;
        if (!readySettled) finishReady({ ok: false, error: `Failed to start STT sidecar: ${error.message}` });
        else this._handleRuntimeFailure(backend.id, `STT sidecar error: ${error.message}`, generation);
      };
      const onExit = (code, signal) => {
        if (!this._isCurrentChild(child, generation)) return;
        const error = `STT sidecar exited: code=${code} signal=${signal}`;
        if (!readySettled) finishReady({ ok: false, error });
        else this._handleRuntimeFailure(backend.id, error, generation);
      };
      const readinessTimer = setTimeout(() => {
        if (!this._isCurrentChild(child, generation)) return;
        finishReady({ ok: false, error: `STT ${backend.id} sidecar readiness timed out` });
        this._disposeCurrentProcess(true);
      }, this.timeouts.readinessMs);
      readinessTimer.unref?.();
      this.processBinding = {
        child,
        onStdout,
        onStderr,
        onStdinError,
        onError,
        onExit,
        readinessTimer,
        cancel: () => finishReady({ ok: false, error: 'STT sidecar attempt was superseded' })
      };
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.stdin?.on('error', onStdinError);
      child.on('error', onError);
      child.on('exit', onExit);
    });
  }

  _handleSidecarEvent(event, child, generation, backendId) {
    if (!this._isCurrentChild(child, generation)) return;
    if (event?.type === 'partial' || event?.type === 'final') {
      if (event?.metrics?.realtimeFactor !== undefined) this.lastRealtimeFactor = event.metrics.realtimeFactor;
      if (event.type === 'final') this.consecutiveInferenceFailures = 0;
      this.emit('transcript', { backend: backendId, ...event });
    } else if (event?.type === 'status') {
      this.emit('status', this.getStatus());
    } else if (event?.type === 'telemetry') {
      if (event.event === 'inference-start') this.inferenceRunning = true;
      if (event.event === 'inference-end') {
        this.inferenceRunning = false;
        if (event.inferenceId && !this.failedInferenceIds.has(event.inferenceId)) {
          this.consecutiveInferenceFailures = 0;
        }
        this.failedInferenceIds.delete(event.inferenceId);
      }
      this.emit('status', this.getStatus());
      this.emit('telemetry', event);
    } else if (event?.type === 'error') {
      process.stderr.write(`[stt] ${event.error}\n`);
      this.emit('error-event', event);
      const explicitlyFatal = event.fatal === true || event.severity === 'fatal';
      if (explicitlyFatal) {
        this._handleRuntimeFailure(backendId, event.error || 'Fatal STT sidecar error', generation);
      } else if (event.inferenceId) {
        if (!this.failedInferenceIds.has(event.inferenceId)) {
          this.failedInferenceIds.add(event.inferenceId);
          this.consecutiveInferenceFailures += 1;
        }
        if (this.consecutiveInferenceFailures >= 2) {
          this._handleRuntimeFailure(backendId, event.error || 'Repeated STT inference failures', generation);
        }
      }
    }
  }

  _handleRuntimeFailure(backendId, error, generation) {
    if (!this._isCurrent(generation) || this.activeBackend !== backendId) return;
    this._recordFailure(backendId, 'runtime', error, generation);
    this._disposeCurrentProcess(true);
    this.activeBackend = null;
    this.nativeReady = false;
    this.inferenceRunning = false;
    if (this.backendPreference === 'auto' && this.desiredRunning) {
      const failedBackends = [...new Set(this.backendFailures.map((failure) => failure.backend))];
      void this.reconcile({ excludeBackends: failedBackends });
      return;
    }
    this.attemptGeneration += 1;
    this.attemptBackend = null;
    this.phase = 'failed';
    this.status = 'unavailable';
    this.fallbackReason = error;
    this.emit('status', this.getStatus());
  }

  sendAudioFrame(frame) {
    if (!this.process || !this.nativeReady || this.status !== 'running') return { ok: false, error: 'Native STT sidecar is not running' };
    const result = this._writeMessage({ type: 'audio', ...frame });
    if (!result.ok && this.activeBackend) {
      queueMicrotask(() => this._handleRuntimeFailure(
        this.activeBackend,
        result.error || 'Native STT sidecar rejected an audio frame',
        this.attemptGeneration
      ));
    }
    return result;
  }

  _writeMessage(message) {
    if (!this.process?.stdin || this.process.stdin.destroyed || this.process.stdin.writable === false) {
      return { ok: false, error: 'Native STT sidecar stdin is not writable' };
    }
    try {
      const accepted = this.process.stdin.write(`${JSON.stringify(message)}\n`);
      return accepted ? { ok: true } : { ok: true, backpressure: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  _getBackendEnv(backend) {
    if (process.platform !== 'win32') return this.nodeEnv;
    const systemRoot = this.nodeEnv.SystemRoot || process.env.SystemRoot || 'C:\\Windows';
    const isolatedPath = [path.dirname(backend.binary), path.join(systemRoot, 'System32')].join(path.delimiter);
    return { ...this.nodeEnv, PATH: isolatedPath, Path: isolatedPath };
  }

  stop() {
    this.desiredRunning = false;
    this._invalidateAttempt();
    this.activeBackend = null;
    this.attemptBackend = null;
    this.nativeReady = false;
    this.inferenceRunning = false;
    this.lastRealtimeFactor = null;
    this.phase = 'stopped';
    this.status = this.backends.some((backend) => backend.available) && this.selectedModel ? 'detected' : 'unavailable';
    return { ok: true, status: this.getStatus() };
  }

  _invalidateAttempt() {
    this.attemptGeneration += 1;
    this._disposePreflight();
    this._disposeCurrentProcess(true);
    this.activeBackend = null;
    this.attemptBackend = null;
    this.nativeReady = false;
    this.inferenceRunning = false;
    this.consecutiveInferenceFailures = 0;
    this.failedInferenceIds.clear();
  }

  _disposeCurrentProcess(kill) {
    const binding = this.processBinding;
    const child = binding?.child || this.process;
    if (binding) {
      binding.cancel();
      clearTimeout(binding.readinessTimer);
      child.stdout?.removeListener('data', binding.onStdout);
      child.stderr?.removeListener('data', binding.onStderr);
      child.stdin?.removeListener('error', binding.onStdinError);
      child.removeListener('error', binding.onError);
      child.removeListener('exit', binding.onExit);
    }
    this.processBinding = null;
    if (child && kill && !child.killed) this.killProcess(child);
    if (this.process === child) this.process = null;
  }

  _disposePreflight() {
    const binding = this.preflightBinding;
    this.preflightBinding = null;
    binding?.cancel();
  }

  _setIdleStatus() {
    const usable = this.selectedModel && this.backends.some((backend) => backend.available);
    this.phase = usable ? 'idle' : 'unavailable';
    this.status = usable ? 'detected' : 'unavailable';
    this.fallbackReason = usable ? null : this.fallbackReason;
  }

  _failGeneration(generation, reason) {
    if (!this._isCurrent(generation)) return { ok: false, stale: true, status: this.getStatus() };
    this._disposeCurrentProcess(true);
    this.activeBackend = null;
    this.attemptBackend = null;
    this.nativeReady = false;
    this.phase = 'failed';
    this.status = 'unavailable';
    this.fallbackReason = reason;
    this.emit('status', this.getStatus());
    return { ok: false, reason, error: reason, status: this.getStatus() };
  }

  _recordFailure(backend, stage, error, generation) {
    this.backendFailures.push({ backend, stage, error, generation });
  }

  _setBackendValidation(backend, status, error) {
    backend.validationStatus = status;
    backend.validationError = error;
    backend.validation = { status, error, missingFiles: [...backend.missingFiles] };
  }

  _isCurrent(generation) {
    return this.desiredRunning && this.attemptGeneration === generation;
  }

  _isCurrentChild(child, generation) {
    return this._isCurrent(generation) && this.process === child;
  }

  _withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }
}

module.exports = { NativeSttManager };
