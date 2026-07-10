const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { NativeSttManager } = require('./stt/sidecar-manager');

if (process.env.ELECTRON_USER_DATA_DIR) {
  app.setPath('userData', process.env.ELECTRON_USER_DATA_DIR);
}

let mainWindow;
let backendProcess;
let runtimeConfig;
let sttManager;
const activeModelDownloads = new Map();

const LOCAL_BACKEND_ENABLED = process.env.MEETSUMMARIZER_LOCAL_BACKEND === '1';

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

  if (!LOCAL_BACKEND_ENABLED && !process.env.MEETSUMMARIZER_API_URL) {
    console.error(
      'MEETSUMMARIZER_API_URL is not set.\n' +
      'For local development, use: npm run dev:local\n' +
      'Or set MEETSUMMARIZER_API_URL to your backend URL (e.g. http://localhost:4000)'
    );
    app.quit();
    return;
  }

  const apiBaseUrl = LOCAL_BACKEND_ENABLED
    ? await startLocalBackend()
    : normalizeBaseUrl(process.env.MEETSUMMARIZER_API_URL);

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
    const setResult = sttManager.setModel(destination);
    const startResult = sttManager.startSidecar();
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
  return { ok: true, status };
});

ipcMain.handle('desktop-stt:set-backend', (_event, backendId) => {
  if (typeof backendId !== 'string' || backendId.length > 32) {
    return { ok: false, error: 'Invalid backend id' };
  }
  return sttManager.setBackend(backendId);
});

ipcMain.handle('desktop-stt:set-model', (_event, modelPath) => {
  if (typeof modelPath !== 'string' || modelPath.length > 1000) {
    return { ok: false, error: 'Invalid model path' };
  }
  return sttManager.setModel(modelPath);
});

ipcMain.handle('desktop-stt:send-audio-frame', (_event, frame) => {
  if (!frame || typeof frame !== 'object') {
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
    const sttBaseDir = app.isPackaged
      ? path.join(process.resourcesPath, 'stt')
      : path.join(__dirname, 'stt');
    sttManager = new NativeSttManager({
      baseDir: sttBaseDir,
      modelDirs: [getDownloadedModelsDir()]
    });
    sttManager.detectBackends();
    sttManager.startSidecar();
    sttManager.on('transcript', (event) => {
      mainWindow?.webContents.send('desktop-stt:transcript', event);
    });
    sttManager.on('status', (status) => {
      mainWindow?.webContents.send('desktop-stt:status', status);
    });

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
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  sttManager?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
