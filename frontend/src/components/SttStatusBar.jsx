import React, { useMemo } from 'react';
import { Cpu, Download, Zap, Circle } from 'lucide-react';

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatModelName = (name) => {
  if (!name) return 'Unknown model';
  return name.replace(/\.(bin|gguf)$/i, '');
};

const SttStatusBar = ({
  sttStatus = null,
  modelDownloadProgress = {}
}) => {
  const isRunning = sttStatus?.status === 'running';
  const isInferring = sttStatus?.inferenceRunning === true;
  const modelName = formatModelName(sttStatus?.modelDisplayName);
  const backend = sttStatus?.selectedBackend?.toUpperCase() || 'CPU';
  const rtf = sttStatus?.realtimeFactor;

  const activeDownload = useMemo(() => {
    return Object.values(modelDownloadProgress).find(
      (p) => p?.state === 'starting' || p?.state === 'downloading'
    ) || null;
  }, [modelDownloadProgress]);

  const statusLabel = !sttStatus
    ? 'Initializing…'
    : isRunning
      ? (isInferring ? 'Inferring' : 'Idle')
      : sttStatus?.status === 'unavailable'
        ? 'Unavailable'
        : sttStatus?.status === 'stopped'
          ? 'Stopped'
          : 'Starting…';

  const statusColor = !sttStatus || sttStatus?.status === 'unavailable'
    ? 'bg-red-500'
    : isRunning
      ? (isInferring ? 'bg-amber-400' : 'bg-emerald-400')
      : 'bg-gray-500';

  const statusPulse = isInferring ? 'animate-pulse' : '';

  if (activeDownload) {
    return (
      <div className="shrink-0 border-t border-white/10 bg-white/[0.03] px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-bold text-blue-200/80">
          <Download size={14} className="text-blue-400 animate-bounce" />
          <span>Downloading {formatModelName(activeDownload.modelId)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
              style={{ width: `${activeDownload.percent || 0}%` }}
            />
          </div>
          <span className="text-[10px] font-bold text-gray-400 tabular-nums w-8 text-right">
            {activeDownload.percent || 0}%
          </span>
        </div>
        {activeDownload.downloadedBytes !== undefined && activeDownload.totalBytes > 0 && (
          <p className="text-[10px] text-gray-500 tabular-nums">
            {formatBytes(activeDownload.downloadedBytes)} / {formatBytes(activeDownload.totalBytes)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Model pill */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/10">
          {backend === 'VULKAN' ? (
            <Zap size={11} className="text-purple-400" />
          ) : (
            <Cpu size={11} className="text-blue-400" />
          )}
          <span className="text-[10px] font-bold text-gray-200">{modelName}</span>
          <span className="text-[9px] font-black text-gray-500">{backend}</span>
        </div>

        {/* Status dot + label */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${statusColor} ${statusPulse}`} />
          <span className="text-[10px] font-bold text-gray-400">{statusLabel}</span>
        </div>

        {/* RTF */}
        {rtf !== null && rtf !== undefined && (
          <div className="flex items-center gap-1 ml-auto">
            <Circle size={8} className="text-gray-600" />
            <span className="text-[10px] font-bold text-gray-500 tabular-nums">
              RTF {rtf.toFixed(2)}x
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SttStatusBar;
