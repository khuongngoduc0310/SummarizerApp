const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { NativeSttManager } = require('./stt/sidecar-manager');
const { WHISPER_CPP_CUDA_11_8_WINDOWS_X64 } = require('./stt/backend-catalog');
const { createBackendInstaller } = require('./stt/backend-installer');
const { BACKEND_PREFERENCES, createSttPreferences } = require('./stt/stt-preferences');

if (process.env.ELECTRON_USER_DATA_DIR) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA_DIR);
}

let mainWindow;
let backendProcess;
let runtimeConfig;
let sttManager;
let backendInstaller;
let sttPreferences;
const activeModelDownloads = new Map();
const activeBackendInstalls = new Map();

const LOCAL_BACKEND_ENABLED = process.env.MEETSUMMARIZER_LOCAL_BACKEND === '1';

const PRODUCTION_API_URL = 'https://summarizerapp-production.up.railway.app';
const CUDA_BACKEND_ID = 'cuda';
const CUDA_CATALOG_ID = WHISPER_CPP_CUDA_11_8_WINDOWS_X64.id;

const WHISPER_MODEL_CATALOG = [
  {
    id: 'tiny.en',
    label: 'Tiny English',
    size: '78 MB',
    fileName: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    description: 'Fastest, lowest disk usage, least accurate.'
  },
  {
    id: 'base.en',
    label: 'Base English',
    size: '148 MB',
    fileName: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    description: 'Recommended balance for a small installer and usable quality.'
  },
  {
    id: 'small.en',
    label: 'Small English',
    size: '488 MB',
    fileName: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    description: 'Better accuracy, slower and larger.'
  },
  {
    id: 'medium.en',
    label: 'Medium English',
    size: '1.5 GB',
    fileName: 'ggml-medium.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    description: 'Best bundled option quality, very large download.'
  }
];

function getDownloadedModelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

function getDownloadedBackendsDir() {
  return path.join(app.getPath('userData'), 'stt', 'backends');
}

function getSttBaseDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'stt') : path.join(__dirname, 'stt');
}

function getSttPreferencesPath() {
  return path.join(app.getPath('userData'), 'stt', 'preferences.json');
}

function getCudaInstallPath() {
  const backend = WHISPER_CPP_CUDA_11_8_WINDOWS_X64;
  return path.join(getDownloadedBackendsDir(), backend.id, backend.version);
}

function getNativeBackendDescriptors(sttBaseDir, cudaInstalled) {
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  return [
    {
      id: CUDA_BACKEND_ID,
      catalogId: CUDA_CATALOG_ID,
      label: 'NVIDIA CUDA 11.8',
      acceleration: 'gpu',
      priority: 15,
      installable: true,
      binary: path.join(getCudaInstallPath(), 'whisper-cli.exe'),
      requiredFiles: [...WHISPER_CPP_CUDA_11_8_WINDOWS_X64.requiredFiles],
      installed: cudaInstalled,
      available: process.platform === 'win32' && process.arch === 'x64'
    },
    {
      id: 'vulkan',
      label: 'Vulkan GPU',
      acceleration: 'gpu',
      priority: 10,
      binary: path.join(sttBaseDir, 'bin', 'vulkan', executable),
      requiredFiles: process.platform === 'win32' ? [executable, 'ggml-vulkan.dll'] : [executable]
    },
    {
      id: 'cpu',
      label: 'CPU',
      acceleration: 'cpu',
      priority: 5,
      binary: path.join(sttBaseDir, 'bin', 'cpu', executable),
      requiredFiles: [executable]
    }
  ];
}

function emitBackendInstallProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop-stt:backend-install-progress', payload);
  }
}

function validateInstalledBackend({ installPath, signal }) {
  const binary = path.join(installPath, 'whisper-cli.exe');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const isolatedPath = [installPath, path.join(systemRoot, 'System32')].join(path.delimiter);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('CUDA backend validation was cancelled'));
      return;
    }
    const child = spawn(binary, ['--help'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PATH: isolatedPath, Path: isolatedPath }
    });
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      child.kill();
      finish(new Error('CUDA backend validation was cancelled'));
    };
    child.stderr.on('data', (data) => {
      if (stderr.length < 8192) stderr += data.toString();
    });
    child.on('error', finish);
    child.on('close', (code, closeSignal) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `CUDA backend validation exited: code=${code} signal=${closeSignal}`));
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('CUDA backend validation timed out'));
    }, 30000);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function refreshManagerBackends(sttBaseDir) {
  const cudaStatus = await backendInstaller.status(CUDA_CATALOG_ID);
  sttManager.installedBackends = getNativeBackendDescriptors(sttBaseDir, cudaStatus.installed);
  sttManager.detectBackends();
  return cudaStatus;
}

async function getBackendCatalogWithStatus() {
  const cudaStatus = await backendInstaller.status(CUDA_CATALOG_ID);
  const managerStatus = sttManager?.getStatus();
  const managerBackend = managerStatus?.backends?.find((backend) => backend.id === CUDA_BACKEND_ID);
  const operation = activeBackendInstalls.get(CUDA_BACKEND_ID);
  return [{
    id: CUDA_BACKEND_ID,
    catalogId: CUDA_CATALOG_ID,
    label: 'NVIDIA CUDA 11.8',
    description: 'Fast NVIDIA GPU inference using the official whisper.cpp CUDA 11.8 runtime.',
    version: WHISPER_CPP_CUDA_11_8_WINDOWS_X64.version,
    sourceUrl: WHISPER_CPP_CUDA_11_8_WINDOWS_X64.asset.url,
    downloadSize: WHISPER_CPP_CUDA_11_8_WINDOWS_X64.downloadSize,
    installedSize: WHISPER_CPP_CUDA_11_8_WINDOWS_X64.installedSize,
    requiredFreeSpace: WHISPER_CPP_CUDA_11_8_WINDOWS_X64.requiredFreeSpace,
    compatible: process.platform === 'win32' && process.arch === 'x64',
    installed: cudaStatus.installed,
    installPath: cudaStatus.installPath,
    installing: Boolean(operation),
    validationStatus: managerBackend?.validationStatus || (cudaStatus.installed ? 'not-run' : 'not-installed'),
    validationError: managerBackend?.validationError || null
  }];
}

function getModelCatalogWithStatus() {
  const downloadedDir = getDownloadedModelsDir();
  const selectedModel = sttManager?.getStatus?.().selectedModel || null;
  return WHISPER_MODEL_CATALOG.map((model) => {
    const modelPath = path.join(downloadedDir, model.fileName);
    const downloaded = fs.existsSync(modelPath);
    return {
      ...model,
      path: modelPath,
      downloaded,
      selected: selectedModel ? path.resolve(selectedModel) === path.resolve(modelPath) : false,
      downloading: activeModelDownloads.has(model.id)
    };
  });
}

function emitModelDownloadProgress(payload) {
  mainWindow?.webContents.send('desktop-stt:model-download-progress', payload);
}

function downloadFile(url, destination, onProgress, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects while downloading model'));

  return new Promise((resolve, reject) => {
    const tempDestination = `${destination}.download`;
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, onProgress, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers['content-length'] || 0);
      let downloadedBytes = 0;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const file = fs.createWriteStream(tempDestination);

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        onProgress({ downloadedBytes, totalBytes, percent: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : null });
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tempDestination, destination);
          resolve();
        });
      });
      file.on('error', (error) => {
        fs.rm(tempDestination, { force: true }, () => reject(error));
      });
    });

    request.on('error', (error) => {
      fs.rm(`${destination}.download`, { force: true }, () => reject(error));
    });
  });
}


function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/$/, '');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForHealth(url, timeoutMs = 30000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        retry();
      });

      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for backend health at ${url}`));
        return;
      }
      setTimeout(check, 500);
    };

    check();
  });
}

async function startLocalBackend() {
  const port = process.env.BACKEND_PORT || String(await getFreePort());
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const healthUrl = `${apiBaseUrl}/health`;

  if (process.env.BACKEND_PORT) {
    try {
      await waitForHealth(healthUrl, 1000);
      console.log(`Reusing local backend at ${apiBaseUrl}`);
      return apiBaseUrl;
    } catch {
      console.log(`No local backend found at ${apiBaseUrl}; starting one.`);
    }
  }

  const backendDir = path.resolve(__dirname, '..', 'backend');

  backendProcess = spawn(process.env.NODE_BINARY || 'node', ['index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: port,
      CORS_ORIGIN: 'null'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  backendProcess.stdout.on('data', (data) => process.stdout.write(`[backend] ${data}`));
  backendProcess.stderr.on('data', (data) => process.stderr.write(`[backend] ${data}`));
  backendProcess.on('exit', (code, signal) => {
    if (!app.isQuiting) {
      console.error(`Backend exited unexpectedly: code=${code} signal=${signal}`);
    }
  });

  await waitForHealth(healthUrl);
  return apiBaseUrl;
}

async function initializeRuntimeConfig() {
  const nativeSttStatus = sttManager?.getStatus();
  const nativeSttAvailable = nativeSttStatus?.status === 'running';

  const apiBaseUrl = LOCAL_BACKEND_ENABLED
    ? await startLocalBackend()
    : normalizeBaseUrl(process.env.MEETSUMMARIZER_API_URL || PRODUCTION_API_URL);

  runtimeConfig = {
    apiBaseUrl,
    socketUrl: apiBaseUrl,
    appMode: LOCAL_BACKEND_ENABLED ? 'desktop-local-test' : 'desktop-remote',
    features: {
      nativeStt: nativeSttAvailable,
      browserSttFallback: true
    },
    stt: nativeSttStatus
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigins = new Set([
      runtimeConfig?.apiBaseUrl
    ]);

    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }

    if (!allowedOrigins.has(origin) && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  const rendererIndex = app.isPackaged
    ? path.join(process.resourcesPath, 'frontend', 'dist', 'index.html')
    : path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html');

  mainWindow.loadFile(rendererIndex);
}

ipcMain.handle('desktop-config:get-runtime-config', () => runtimeConfig);

ipcMain.handle('desktop-stt:get-status', () => sttManager.getStatus());

ipcMain.handle('desktop-stt:list-model-catalog', () => getModelCatalogWithStatus());

ipcMain.handle('desktop-stt:list-backend-catalog', () => getBackendCatalogWithStatus());

ipcMain.handle('desktop-stt:install-backend', async (_event, backendId) => {
  if (backendId !== CUDA_BACKEND_ID) return { ok: false, error: `Unknown installable backend: ${backendId}` };
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    return { ok: false, error: 'The CUDA backend requires Windows x64' };
  }
  if (activeBackendInstalls.has(backendId)) return { ok: false, error: 'Backend installation is already running' };

  const controller = new AbortController();
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  activeBackendInstalls.set(backendId, { controller, done });
  emitBackendInstallProgress({ backendId, phase: 'starting', percent: 0 });
  try {
    const installed = await backendInstaller.install(CUDA_CATALOG_ID, {
      signal: controller.signal,
      validator: validateInstalledBackend,
      progress: (progress) => {
        const totalBytes = progress.totalBytes || 0;
        const completedBytes = progress.receivedBytes ?? progress.extractedBytes ?? 0;
        emitBackendInstallProgress({
          backendId,
          ...progress,
          percent: totalBytes ? Math.round((completedBytes / totalBytes) * 100) : null
        });
      }
    });
    await refreshManagerBackends(getSttBaseDir());
    const startResult = sttManager.desiredRunning
      ? await sttManager.reconcile()
      : await sttManager.startSidecar();
    emitBackendInstallProgress({ backendId, phase: 'done', percent: 100 });
    return { ok: true, backend: installed, status: startResult.status || sttManager.getStatus() };
  } catch (error) {
    const cancelled = error.name === 'AbortError' || controller.signal.aborted;
    emitBackendInstallProgress({ backendId, phase: cancelled ? 'cancelled' : 'error', error: error.message });
    return { ok: false, cancelled, error: error.message };
  } finally {
    activeBackendInstalls.delete(backendId);
    resolveDone();
  }
});

ipcMain.handle('desktop-stt:cancel-backend-install', (_event, backendId) => {
  if (backendId !== CUDA_BACKEND_ID) return { ok: false, error: `Unknown installable backend: ${backendId}` };
  const operation = activeBackendInstalls.get(backendId);
  if (!operation) return { ok: false, error: 'Backend installation is not running' };
  operation.controller.abort();
  return { ok: true };
});

ipcMain.handle('desktop-stt:remove-backend', async (_event, backendId) => {
  if (backendId !== CUDA_BACKEND_ID) return { ok: false, error: `Unknown installable backend: ${backendId}` };
  const operation = activeBackendInstalls.get(backendId);
  operation?.controller.abort();
  if (operation) await operation.done;
  const shouldRestart = sttManager.desiredRunning;
  const currentStatus = sttManager.getStatus();
  if (currentStatus.activeBackend === backendId || currentStatus.attemptBackend === backendId) sttManager.stop();
  await backendInstaller.remove(CUDA_CATALOG_ID);
  await refreshManagerBackends(getSttBaseDir());
  const result = shouldRestart ? await sttManager.startSidecar() : { status: sttManager.getStatus() };
  return { ok: true, status: result.status || sttManager.getStatus() };
});

ipcMain.handle('desktop-stt:download-model', async (_event, modelId) => {
  const model = WHISPER_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
  if (!model) return { ok: false, error: `Unknown model: ${modelId}` };
  if (activeModelDownloads.has(modelId)) return { ok: false, error: 'Model download is already running' };

  const destination = path.join(getDownloadedModelsDir(), model.fileName);
  if (fs.existsSync(destination)) {
    return { ok: true, model: { ...model, path: destination, downloaded: true }, status: sttManager.refreshModels() };
  }

  activeModelDownloads.set(modelId, true);
  emitModelDownloadProgress({ modelId, state: 'starting', percent: 0 });

  try {
    await downloadFile(model.url, destination, (progress) => {
      emitModelDownloadProgress({ modelId, state: 'downloading', ...progress });
    });
    const status = sttManager.refreshModels();
    const setResult = await sttManager.setModel(destination);
    const startResult = await sttManager.startSidecar();
    emitModelDownloadProgress({ modelId, state: 'done', percent: 100 });
    return { ok: true, path: destination, status: startResult?.status || setResult?.status || status };
  } catch (error) {
    emitModelDownloadProgress({ modelId, state: 'error', error: error.message });
    return { ok: false, error: error.message };
  } finally {
    activeModelDownloads.delete(modelId);
  }
});

ipcMain.handle('desktop-stt:delete-model', async (_event, modelId) => {
  const model = WHISPER_MODEL_CATALOG.find((candidate) => candidate.id === modelId);
  if (!model) return { ok: false, error: `Unknown model: ${modelId}` };

  const modelPath = path.join(getDownloadedModelsDir(), model.fileName);
  const selectedModel = sttManager.getStatus().selectedModel;
  const deletingSelected = selectedModel && path.resolve(selectedModel) === path.resolve(modelPath);

  if (deletingSelected) sttManager.stop();
  await fs.promises.rm(modelPath, { force: true });
  const status = sttManager.refreshModels();
  const startResult = deletingSelected ? await sttManager.startSidecar() : null;
  return { ok: true, status: startResult?.status || status };
});

ipcMain.handle('desktop-stt:set-backend-preference', async (_event, backendPreference) => {
  if (!BACKEND_PREFERENCES.includes(backendPreference)) {
    return { ok: false, error: 'Invalid backend preference' };
  }
  await sttPreferences.save(backendPreference);
  return sttManager.setBackendPreference(backendPreference);
});

ipcMain.handle('desktop-stt:set-model', (_event, modelPath) => {
  if (typeof modelPath !== 'string' || modelPath.length > 1000) {
    return { ok: false, error: 'Invalid model path' };
  }
  return sttManager.setModel(modelPath);
});

ipcMain.handle('desktop-stt:send-audio-frame', (_event, frame) => {
  const validIdentity = typeof frame?.meetingId === 'string' && frame.meetingId.length > 0 && frame.meetingId.length <= 200 &&
    typeof frame?.speakerId === 'string' && frame.speakerId.length > 0 && frame.speakerId.length <= 200;
  const validAudio = Array.isArray(frame?.audio) && frame.audio.length > 0 && frame.audio.length <= 32000 &&
    frame.audio.every((sample) => Number.isFinite(sample) && sample >= -2 && sample <= 2);
  if (!validIdentity || !validAudio || frame.sampleRate !== 16000 || !Number.isSafeInteger(frame.sequence)) {
    return { ok: false, error: 'Invalid audio frame' };
  }
  return sttManager.sendAudioFrame(frame);
});

ipcMain.handle('desktop-stt:update-config', (_event, config) => {
  if (!config || typeof config !== 'object') {
    return { ok: false, error: 'Invalid STT config' };
  }
  return sttManager.updateConfig(config);
});

ipcMain.handle('desktop-stt:stop', () => sttManager.stop());

app.whenReady().then(async () => {
  try {
    const sttBaseDir = getSttBaseDir();
    backendInstaller = createBackendInstaller({ installRoot: getDownloadedBackendsDir() });
    sttPreferences = createSttPreferences(getSttPreferencesPath());
    await backendInstaller.cleanupStaging();
    const [preferences, cudaStatus] = await Promise.all([
      sttPreferences.load(),
      backendInstaller.status(CUDA_CATALOG_ID)
    ]);
    sttManager = new NativeSttManager({
      baseDir: sttBaseDir,
      modelDirs: [getDownloadedModelsDir()],
      installedBackends: getNativeBackendDescriptors(sttBaseDir, cudaStatus.installed),
      backendPreference: preferences.backend,
      nodeBinary: process.execPath
    });
    sttManager.on('transcript', (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-stt:transcript', event);
    });
    sttManager.on('status', (status) => {
      if (runtimeConfig) {
        runtimeConfig.stt = status;
        runtimeConfig.features.nativeStt = status.nativeReady === true;
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-stt:status', status);
    });
    sttManager.detectBackends();
    await sttManager.startSidecar();

    await initializeRuntimeConfig();
    createWindow();
  } catch (error) {
    console.error('Failed to start desktop app:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
  for (const operation of activeBackendInstalls.values()) operation.controller.abort();
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  sttManager?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
