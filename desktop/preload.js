const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopConfig', {
  getRuntimeConfig: () => ipcRenderer.invoke('desktop-config:get-runtime-config')
});

contextBridge.exposeInMainWorld('desktopStt', {
  getStatus: () => ipcRenderer.invoke('desktop-stt:get-status'),
  listModelCatalog: () => ipcRenderer.invoke('desktop-stt:list-model-catalog'),
  listBackendCatalog: () => ipcRenderer.invoke('desktop-stt:list-backend-catalog'),
  installBackend: (backendId) => ipcRenderer.invoke('desktop-stt:install-backend', backendId),
  cancelBackendInstall: (backendId) => ipcRenderer.invoke('desktop-stt:cancel-backend-install', backendId),
  removeBackend: (backendId) => ipcRenderer.invoke('desktop-stt:remove-backend', backendId),
  downloadModel: (modelId) => ipcRenderer.invoke('desktop-stt:download-model', modelId),
  deleteModel: (modelId) => ipcRenderer.invoke('desktop-stt:delete-model', modelId),
  sendAudioFrame: (frame) => ipcRenderer.invoke('desktop-stt:send-audio-frame', frame),
  sendAudioFrames: (payload) => ipcRenderer.invoke('desktop-stt:send-audio-frames', payload),
  onTranscript: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, transcriptEvent) => callback(transcriptEvent);
    ipcRenderer.on('desktop-stt:transcript', listener);
    return () => ipcRenderer.removeListener('desktop-stt:transcript', listener);
  },
  onStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop-stt:status', listener);
    return () => ipcRenderer.removeListener('desktop-stt:status', listener);
  },
  onModelDownloadProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('desktop-stt:model-download-progress', listener);
    return () => ipcRenderer.removeListener('desktop-stt:model-download-progress', listener);
  },
  onBackendInstallProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('desktop-stt:backend-install-progress', listener);
    return () => ipcRenderer.removeListener('desktop-stt:backend-install-progress', listener);
  },
  setModel: (modelPath) => ipcRenderer.invoke('desktop-stt:set-model', modelPath),
  setBackendPreference: (backendPreference) => ipcRenderer.invoke('desktop-stt:set-backend-preference', backendPreference),
  updateConfig: (config) => ipcRenderer.invoke('desktop-stt:update-config', config),
  stop: () => ipcRenderer.invoke('desktop-stt:stop')
});
