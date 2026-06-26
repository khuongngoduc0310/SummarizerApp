const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopConfig', {
  getRuntimeConfig: () => ipcRenderer.invoke('desktop-config:get-runtime-config')
});

contextBridge.exposeInMainWorld('desktopStt', {
  getStatus: () => ipcRenderer.invoke('desktop-stt:get-status'),
  sendAudioFrame: (frame) => ipcRenderer.invoke('desktop-stt:send-audio-frame', frame),
  onTranscript: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const listener = (_event, transcriptEvent) => callback(transcriptEvent);
    ipcRenderer.on('desktop-stt:transcript', listener);
    return () => ipcRenderer.removeListener('desktop-stt:transcript', listener);
  },
  setModel: (modelPath) => ipcRenderer.invoke('desktop-stt:set-model', modelPath),
  setBackend: (backendId) => ipcRenderer.invoke('desktop-stt:set-backend', backendId),
  updateConfig: (config) => ipcRenderer.invoke('desktop-stt:update-config', config),
  stop: () => ipcRenderer.invoke('desktop-stt:stop')
});
