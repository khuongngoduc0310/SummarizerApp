const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { NativeSttManager } = require('./stt/sidecar-manager');

let mainWindow;
let backendProcess;
let runtimeConfig;
let sttManager;

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

async function startBackend() {
  const port = process.env.BACKEND_PORT || String(await getFreePort());
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const backendDir = app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.resolve(__dirname, '..', 'backend');

  backendProcess = spawn(process.env.NODE_BINARY || 'node', ['index.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: port,
      CORS_ORIGIN: process.env.FRONTEND_DEV_URL || 'http://localhost:5173'
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

  await waitForHealth(`${apiBaseUrl}/health`);

  const nativeSttStatus = sttManager?.getStatus();
  const nativeSttAvailable = nativeSttStatus?.status === 'running';

  runtimeConfig = {
    apiBaseUrl,
    socketUrl: apiBaseUrl,
    appMode: 'desktop-local',
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigins = new Set([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
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

  if (app.isPackaged) {
    mainWindow.loadFile(path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(process.env.FRONTEND_DEV_URL || 'http://localhost:5173');
  }
}

ipcMain.handle('desktop-config:get-runtime-config', () => runtimeConfig);

ipcMain.handle('desktop-stt:get-status', () => sttManager.getStatus());

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
    sttManager = new NativeSttManager({ baseDir: sttBaseDir });
    sttManager.detectBackends();
    sttManager.startSidecar();
    sttManager.on('transcript', (event) => {
      mainWindow?.webContents.send('desktop-stt:transcript', event);
    });

    await startBackend();
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
