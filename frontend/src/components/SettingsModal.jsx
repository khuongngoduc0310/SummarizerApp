import React from 'react';
import {
  MessageSquare,
  Monitor,
  PanelRightClose,
  Settings,
  Sparkles,
  Video
} from 'lucide-react';
import { getActiveApiKey, getProviderConfig, getSelectedModel, LLM_PROVIDERS } from '../config/llmModels';

const formatMiB = (bytes) => `${Math.round(Number(bytes || 0) / 1024 / 1024)} MiB`;

const SettingsModal = ({
  onClose,
  devices = { video: [], audio: [], output: [] },
  selectedDevices = { video: '', audio: '', output: '' },
  onDeviceChange,
  sttConfig,
  setSttConfig,
  sttStatus,
  modelCatalog = [],
  modelDownloadProgress = {},
  backendCatalog = [],
  backendInstallProgress = {},
  onDownloadModel,
  onUseModel,
  onDeleteModel,
  onBackendPreference,
  onInstallBackend,
  onCancelBackendInstall,
  onRemoveBackend,
  sttModeLabel = 'Speech-to-text',
  sttModeDetail = 'Not available',
  nativeSttRunning = false,
  llmConfig,
  setLlmConfig
}) => {
  const providerConfig = getProviderConfig(llmConfig?.provider);
  const selectedModel = getSelectedModel(llmConfig);
  const activeApiKey = getActiveApiKey(llmConfig);

  const updateDevice = (type, value) => {
    if (onDeviceChange) {
      onDeviceChange(type, value);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden bg-[#111] border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-400">
              <Settings size={20} />
            </div>
            <h2 className="text-xl font-bold">Device Settings</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors">
            <PanelRightClose size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Video size={14} /> Camera
            </label>
            <select
              value={selectedDevices.video}
              onChange={e => updateDevice('video', e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
            >
              {devices.video.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>)}
              {devices.video.length === 0 && <option value="">No camera detected</option>}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Monitor size={14} /> Microphone
            </label>
            <select
              value={selectedDevices.audio}
              onChange={e => updateDevice('audio', e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
            >
              {devices.audio.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 4)}`}</option>)}
              {devices.audio.length === 0 && <option value="">No microphone detected</option>}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Monitor size={14} /> Speaker
            </label>
            <select
              value={selectedDevices.output}
              onChange={e => updateDevice('output', e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
            >
              {devices.output.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 4)}`}</option>)}
              {devices.output.length === 0 && <option value="">No speaker detected</option>}
            </select>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 space-y-6 mt-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-400">
              <MessageSquare size={16} />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Speech-to-Text Settings</h3>
          </div>

          <div className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Active STT Engine</p>
              <p className="text-sm font-bold text-white mt-1">{sttModeLabel}</p>
              <p className="text-[11px] text-gray-500 mt-1">{sttModeDetail}</p>
            </div>
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${nativeSttRunning ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              {nativeSttRunning ? 'Native' : 'Fallback'}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Backend Preference</label>
            <select
              value={sttStatus?.backendPreference || 'auto'}
              onChange={(event) => onBackendPreference?.(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
            >
              <option value="auto">Auto (CUDA, Vulkan, CPU)</option>
              {(sttStatus?.backends || []).map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.label} {backend.available ? 'available' : 'not available'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500">
              Active backend: <span className="font-bold text-gray-300">{sttStatus?.activeBackend?.toUpperCase() || 'WebGPU fallback'}</span>
              {sttStatus?.attemptBackend ? ` · Trying ${sttStatus.attemptBackend.toUpperCase()}` : ''}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {(sttStatus?.backends || []).map((backend) => {
                const catalogBackend = backendCatalog.find((candidate) => candidate.id === backend.id);
                const progress = backendInstallProgress[backend.id];
                const installing = ['starting', 'download', 'extract'].includes(progress?.phase) || catalogBackend?.installing;
                return (
                  <div key={backend.id} className="rounded-xl bg-white/[0.03] border border-white/10 px-3 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold text-gray-300">{backend.label}</span>
                        {catalogBackend && (
                          <p className="text-[10px] text-gray-600 mt-1">
                            {formatMiB(catalogBackend.downloadSize)} download · {formatMiB(catalogBackend.installedSize)} installed
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${backend.available ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {backend.available ? backend.validationStatus || 'available' : catalogBackend?.installed ? backend.validationError || 'invalid' : 'not installed'}
                        </span>
                        {catalogBackend && !catalogBackend.installed && !installing && (
                          <button onClick={() => onInstallBackend?.(backend.id)} disabled={!catalogBackend.compatible} className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[10px] font-black uppercase text-blue-300 disabled:opacity-40">
                            Install
                          </button>
                        )}
                        {catalogBackend && installing && (
                          <button onClick={() => onCancelBackendInstall?.(backend.id)} className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase text-amber-300">
                            Cancel
                          </button>
                        )}
                        {catalogBackend?.installed && !installing && (
                          <button onClick={() => onRemoveBackend?.(backend.id)} className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] font-black uppercase text-red-300">
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {installing && (
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-blue-400 transition-all" style={{ width: `${progress?.percent || 0}%` }} />
                      </div>
                    )}
                    {progress?.phase === 'error' && <p className="text-[10px] font-bold text-red-300">{progress.error}</p>}
                  </div>
                );
              })}
            </div>
            {backendCatalog.length > 0 && (
              <p className="text-[10px] text-gray-600 leading-relaxed">
                CUDA installs executable code from the official whisper.cpp release and requires an NVIDIA GPU. At least 1.2 GB free disk space is required during installation. Audio remains local.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Whisper Models</label>
            <div className="grid grid-cols-1 gap-3">
              {modelCatalog.map((model) => {
                const progress = modelDownloadProgress[model.id];
                const isDownloading = progress?.state === 'starting' || progress?.state === 'downloading' || model.downloading;
                const isSelected = model.selected || (sttStatus?.selectedModel && model.path === sttStatus.selectedModel);
                return (
                  <div key={model.id} className={`rounded-xl border p-4 ${isSelected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.03] border-white/10'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">{model.label}</p>
                        <p className="text-[11px] text-gray-500 mt-1">{model.size} · {model.description}</p>
                        {isDownloading && <p className="text-[11px] text-blue-300 mt-2 font-bold">Downloading {progress?.percent ?? 0}%</p>}
                        {progress?.state === 'error' && <p className="text-[11px] text-red-300 mt-2 font-bold">{progress.error}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {model.downloaded ? (
                          <>
                            <button onClick={() => onUseModel?.(model.path)} disabled={isSelected} className="px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest text-emerald-300 disabled:opacity-50">
                              {isSelected ? 'Selected' : 'Use'}
                            </button>
                            <button onClick={() => onDeleteModel?.(model.id)} className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-black uppercase tracking-widest text-red-300">
                              Delete
                            </button>
                          </>
                        ) : (
                          <button onClick={() => onDownloadModel?.(model.id)} disabled={isDownloading} className="px-3 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-[10px] font-black uppercase tracking-widest text-blue-300 disabled:opacity-50">
                            {isDownloading ? 'Downloading' : 'Download'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {modelCatalog.length === 0 && <div className="p-4 rounded-xl border border-dashed border-white/10 text-xs text-gray-500 font-bold">No Whisper models found.</div>}
            </div>
            <p className="text-[10px] text-gray-600 font-medium leading-relaxed italic">
              Models download after install to keep the app package light. Smaller models are faster; larger models are more accurate.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Window</label>
              <select
                value={sttConfig.windowSec}
                onChange={e => setSttConfig(prev => ({ ...prev, windowSec: Number(e.target.value), overlapSec: Math.min(prev.overlapSec, Number(e.target.value) - 0.5) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
              >
                <option value={3}>3.0 sec</option>
                <option value={4}>4.0 sec</option>
                <option value={5}>5.0 sec</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Overlap</label>
              <select
                value={sttConfig.overlapSec}
                onChange={e => setSttConfig(prev => ({ ...prev, overlapSec: Math.min(Number(e.target.value), prev.windowSec - 0.5) }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
              >
                <option value={0}>0.0 sec (none)</option>
                <option value={0.25}>0.25 sec</option>
                <option value={0.5}>0.5 sec</option>
                <option value={0.75}>0.75 sec</option>
                <option value={1}>1.0 sec</option>
                <option value={1.25}>1.25 sec</option>
                <option value={1.5}>1.5 sec</option>
                <option value={2}>2.0 sec</option>
                <option value={2.5}>2.5 sec</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Step</label>
              <div className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300">
                {Math.max(0.5, sttConfig.windowSec - sttConfig.overlapSec).toFixed(1)} sec
              </div>
            </div>
          </div>

          <p className="text-[10px] text-gray-600 font-medium leading-relaxed italic">
            Lower overlap reduces repeated captions. Higher overlap can protect words at chunk boundaries but may increase duplicate text.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
              <input type="checkbox" checked={sttConfig.highPassFilter ?? true} onChange={e => setSttConfig(prev => ({ ...prev, highPassFilter: e.target.checked }))} />
              High-pass filter
            </label>
            <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
              <input type="checkbox" checked={sttConfig.silenceTrim ?? true} onChange={e => setSttConfig(prev => ({ ...prev, silenceTrim: e.target.checked }))} />
              Trim silence
            </label>
            <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
              <input type="checkbox" checked={sttConfig.normalizeAudio ?? true} onChange={e => setSttConfig(prev => ({ ...prev, normalizeAudio: e.target.checked }))} />
              Normalize quiet speech
            </label>
            <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
              <input type="checkbox" checked={sttConfig.dcOffsetRemoval ?? true} onChange={e => setSttConfig(prev => ({ ...prev, dcOffsetRemoval: e.target.checked }))} />
              Remove DC offset
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">VAD threshold</label>
              <select value={sttConfig.vadThreshold ?? 0.008} onChange={e => setSttConfig(prev => ({ ...prev, vadThreshold: Number(e.target.value) }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none">
                <option value={0.004}>Low</option>
                <option value={0.008}>Medium</option>
                <option value={0.014}>High</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">High-pass cutoff</label>
              <select value={sttConfig.highPassCutoffHz ?? 100} onChange={e => setSttConfig(prev => ({ ...prev, highPassCutoffHz: Number(e.target.value) }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none">
                <option value={80}>80 Hz</option>
                <option value={100}>100 Hz</option>
                <option value={120}>120 Hz</option>
                <option value={150}>150 Hz</option>
              </select>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 space-y-6 mt-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center text-purple-400">
              <Sparkles size={16} />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">AI Summary Settings</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">AI Provider</label>
              <select value={llmConfig.provider} onChange={e => setLlmConfig(prev => ({ ...prev, provider: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 appearance-none">
                {Object.entries(LLM_PROVIDERS).map(([providerId, provider]) => (
                  <option key={providerId} value={providerId}>{provider.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Summary Model</label>
              <select
                value={selectedModel.id}
                onChange={e => setLlmConfig(prev => ({
                  ...prev,
                  models: { ...prev.models, [prev.provider]: e.target.value }
                }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 appearance-none"
              >
                {providerConfig.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label} · {model.tier}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-xl border border-purple-400/10 bg-purple-400/[0.05] px-4 py-3">
            <p className="text-xs font-bold text-purple-200">{selectedModel.label} · {selectedModel.tier}</p>
            <p className="mt-1 text-[11px] leading-5 text-gray-500">{selectedModel.description}</p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">{providerConfig.label} API Key</label>
            <input
              type="password"
              value={activeApiKey}
              onChange={e => setLlmConfig(prev => ({
                ...prev,
                apiKeys: { ...prev.apiKeys, [prev.provider]: e.target.value }
              }))}
              placeholder={providerConfig.keyPlaceholder}
              autoComplete="off"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <p className="text-[10px] text-gray-600 font-medium leading-relaxed italic">
            * Keys are stored locally and sent to the configured backend only when you generate a summary. They are not saved with meeting summaries.
          </p>
        </div>

        </div>

        <div className="shrink-0 px-8 py-4 border-t border-white/5 bg-[#111]/95 backdrop-blur flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-[#0E71EB] hover:bg-blue-600 text-white text-sm font-bold rounded-xl transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
