import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import io from 'socket.io-client';
import {
  Video,
  ShieldCheck,
  Users,
  Copy,
  Check,
  MessageSquare,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Monitor
} from 'lucide-react';

import JoinScreen from './components/JoinScreen';
import MeetingControls from './components/MeetingControls';
import CaptionPanel from './components/CaptionPanel';
import SummaryPanel from './components/SummaryPanel';
import SettingsModal from './components/SettingsModal';
import SttStatusBar from './components/SttStatusBar';
import VideoView from './components/VideoView';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudioPipeline } from './hooks/useAudioPipeline';
import { getActiveApiKey, getSelectedModelId, normalizeLlmConfig } from './config/llmModels';
import { mergeCaptions } from './utils/captions';


const getRuntimeConfig = async () => {
  if (!window.desktopConfig?.getRuntimeConfig) {
    throw new Error('MeetSummarizer must be launched from the desktop app.');
  }

  const config = await window.desktopConfig.getRuntimeConfig();
  if (!config?.apiBaseUrl) {
    throw new Error('Desktop runtime config did not include an API URL.');
  }

  return config;
};

const requestCaptionHistory = (socket, payload) => new Promise((resolve, reject) => {
  socket.timeout(10000).emit('get-caption-history', payload, (timeoutError, response) => {
    if (timeoutError) {
      reject(new Error('Caption history request timed out.'));
      return;
    }
    if (!response?.ok) {
      reject(new Error(response?.error || 'Failed to load caption history.'));
      return;
    }
    resolve(response);
  });
});

const createJoinRequestId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Storage Utilities (LocalStorage with Expiry)
const storage = {
  set(name, value, hours = 24) {
    const item = {
      value,
      expiry: Date.now() + hours * 3600 * 1000,
    };
    localStorage.setItem(name, JSON.stringify(item));
  },
  get(name) {
    const str = localStorage.getItem(name);
    if (!str) return null;
    try {
      const item = JSON.parse(str);
      if (Date.now() > item.expiry) {
        localStorage.removeItem(name);
        return null;
      }
      return item.value;
    } catch {
      return null;
    }
  },
  remove(name) {
    localStorage.removeItem(name);
  }
};

function App() {
  const [meetingId, setMeetingId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [socket, setSocket] = useState(null);
  const [captions, setCaptions] = useState([]);
  const [captionHistoryCursor, setCaptionHistoryCursor] = useState(null);
  const [hasOlderCaptions, setHasOlderCaptions] = useState(false);
  const [loadingCaptionHistory, setLoadingCaptionHistory] = useState(false);
  const [captionHistoryError, setCaptionHistoryError] = useState(null);
  const activeMeetingIdRef = useRef(null);
  const activeSessionStartedAtRef = useRef(null);
  const activeJoinRequestIdRef = useRef(null);
  const captionHistoryRequestIdRef = useRef(0);
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('summary'); // 'summary' or 'transcript'
  const [pinnedId, setPinnedId] = useState('local');
  const [showSettings, setShowSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [startupError, setStartupError] = useState(null);
  const [sttConfig, setSttConfig] = useState(() => {
    return storage.get('stt_config') || {
      windowSec: 4,
      overlapSec: 1,
      maxBufferSec: 8,
      vadThreshold: 0.008,
      highPassCutoffHz: 100,
      dcOffsetRemoval: true,
      highPassFilter: true,
      normalizeAudio: true,
      silenceTrim: true
    };
  });
  const [sttStatus, setSttStatus] = useState(null);
  const [sttMetrics, setSttMetrics] = useState([]);
  const [modelCatalog, setModelCatalog] = useState([]);
  const [modelDownloadProgress, setModelDownloadProgress] = useState({});
  const [backendCatalog, setBackendCatalog] = useState([]);
  const [backendInstallProgress, setBackendInstallProgress] = useState({});

  // Device Management
  const [devices, setDevices] = useState({ video: [], audio: [], output: [] });
  const [selectedDevices, setSelectedDevices] = useState({ video: '', audio: '', output: '' });

  // LLM Configuration
  const [llmConfig, setLllmConfig] = useState(() => {
    return normalizeLlmConfig(storage.get('llm_config'));
  });

  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [recentRooms, setRecentRooms] = useState([]);

  const effectiveRuntimeConfig = useMemo(() => (
    runtimeConfig
      ? {
        ...runtimeConfig,
        features: {
          ...runtimeConfig.features,
          nativeStt: sttStatus ? sttStatus.nativeReady === true : runtimeConfig.features.nativeStt
        },
        stt: sttStatus || runtimeConfig.stt
      }
      : runtimeConfig
  ), [runtimeConfig, sttStatus]);

  const {
    localStream,
    remoteStreams,
    remoteStatus,
    isHost,
    hostId,
    leave
  } = useWebRTC(socket, meetingId, userDisplayName, isMuted, isVideoOff, selectedDevices.video, selectedDevices.audio);

  const handleSttMetric = useCallback((metric) => {
    setSttMetrics((prev) => [...prev.slice(-199), { id: `${Date.now()}-${Math.random()}`, ...metric }]);
  }, []);

  const refreshModelCatalog = useCallback(async () => {
    const catalog = await window.desktopStt?.listModelCatalog?.();
    if (catalog) setModelCatalog(catalog);
    return catalog;
  }, []);

  const refreshBackendCatalog = useCallback(async () => {
    const catalog = await window.desktopStt?.listBackendCatalog?.();
    if (catalog) setBackendCatalog(catalog);
    return catalog;
  }, []);

  // Initialize Audio Pipeline for transcription
  useAudioPipeline(socket, meetingId, localStream, userId, effectiveRuntimeConfig, sttConfig, handleSttMetric);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    setIsVideoOff(prev => !prev);
  }, []);

  useEffect(() => {
    let cancelled = false;

    getRuntimeConfig()
      .then((config) => {
        if (!cancelled) setRuntimeConfig(config);
      })
      .catch((error) => {
        if (!cancelled) setStartupError(error.message || 'Failed to start MeetSummarizer.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtimeConfig) return;

    const newSocket = io(runtimeConfig.socketUrl || runtimeConfig.apiBaseUrl);
    setSocket(newSocket);

    newSocket.on('caption', (data) => {
      if (data.meetingId !== activeMeetingIdRef.current) return;
      if (data.sessionStartedAt && data.sessionStartedAt !== activeSessionStartedAtRef.current) return;
      setCaptions((prev) => mergeCaptions(prev, [data]));
    });

    newSocket.on('joined-successfully', async (data) => {
      if (
        data.meetingId !== activeMeetingIdRef.current
        || data.joinRequestId !== activeJoinRequestIdRef.current
      ) return;
      setUserId(data.userId);
      activeSessionStartedAtRef.current = data.sessionStartedAt;
      console.log('Successfully joined as:', data.displayName);

      const historyRequestId = ++captionHistoryRequestIdRef.current;
      setLoadingCaptionHistory(true);
      setCaptionHistoryError(null);
      try {
        const response = await requestCaptionHistory(newSocket, {
          meetingId: data.meetingId,
          limit: 200
        });
        if (
          activeMeetingIdRef.current !== response.meetingId
          || activeSessionStartedAtRef.current !== response.sessionStartedAt
          || activeJoinRequestIdRef.current !== data.joinRequestId
          || captionHistoryRequestIdRef.current !== historyRequestId
        ) return;

        setCaptions((prev) => mergeCaptions(prev, response.captions));
        setCaptionHistoryCursor(response.nextCursor);
        setHasOlderCaptions(response.hasMore);
      } catch (error) {
        if (
          activeMeetingIdRef.current === data.meetingId
          && activeSessionStartedAtRef.current === data.sessionStartedAt
          && activeJoinRequestIdRef.current === data.joinRequestId
          && captionHistoryRequestIdRef.current === historyRequestId
        ) {
          setCaptionHistoryError(error.message);
        }
      } finally {
        if (
          activeMeetingIdRef.current === data.meetingId
          && activeSessionStartedAtRef.current === data.sessionStartedAt
          && activeJoinRequestIdRef.current === data.joinRequestId
          && captionHistoryRequestIdRef.current === historyRequestId
        ) {
          setLoadingCaptionHistory(false);
        }
      }
    });

    newSocket.on('join-error', (data) => {
      if (
        data?.meetingId !== activeMeetingIdRef.current
        || data?.joinRequestId !== activeJoinRequestIdRef.current
      ) return;
      console.error('Failed to join meeting:', data?.error);
      captionHistoryRequestIdRef.current += 1;
      activeMeetingIdRef.current = null;
      activeSessionStartedAtRef.current = null;
      activeJoinRequestIdRef.current = null;
      setMeetingId(null);
      setCaptions([]);
      alert(data?.error || 'Failed to join meeting.');
    });

    newSocket.on('user-joined', (data) => {
      console.log('Another user joined:', data.displayName);
    });

    // Load recent rooms and filter out active ones
    const saved = storage.get('recent_rooms') || [];
    setRecentRooms(saved);

    // Filter out rooms that are still active
    (async () => {
      if (saved.length > 0 && runtimeConfig?.apiBaseUrl) {
        try {
          const statuses = await Promise.allSettled(
            saved.map(async (id) => {
              const res = await fetch(`${runtimeConfig.apiBaseUrl}/meetings/${id}/status`);
              if (!res.ok) return null;
              const { active } = await res.json();
              return active ? null : id;
            })
          );
          const filtered = statuses
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);
          if (filtered.length !== saved.length) {
            setRecentRooms(filtered);
            storage.set('recent_rooms', filtered, 24);
          }
        } catch {
          // If status check fails, keep the existing list
        }
      }
    })();

    return () => {
      newSocket.close();
      setSocket(null);
    };
  }, [runtimeConfig]);

  // Persist LLM Config
  useEffect(() => {
    storage.set('llm_config', llmConfig);
  }, [llmConfig]);

  // Persist STT Config and notify native sidecar when available
  useEffect(() => {
    storage.set('stt_config', sttConfig);
    if (window.desktopStt?.updateConfig) {
      window.desktopStt.updateConfig(sttConfig).catch((error) => {
        console.warn('Failed to update native STT config:', error);
      });
    }
  }, [sttConfig]);

  useEffect(() => {
    if (!runtimeConfig) return;

    let cancelled = false;
    const refreshSttStatus = async () => {
      try {
        const nativeStatus = await window.desktopStt?.getStatus?.();
        if (!cancelled) setSttStatus(nativeStatus || runtimeConfig.stt || null);
        if (!cancelled) await Promise.all([refreshModelCatalog(), refreshBackendCatalog()]);
      } catch {
        if (!cancelled) setSttStatus(runtimeConfig.stt || null);
      }
    };

    refreshSttStatus();
    const interval = setInterval(refreshSttStatus, 5000);
    const unsubscribeStatus = window.desktopStt?.onStatus?.((status) => {
      setSttStatus(status);
      Promise.all([refreshModelCatalog(), refreshBackendCatalog()]).catch(() => {});
    });
    const unsubscribeProgress = window.desktopStt?.onModelDownloadProgress?.((progress) => {
      setModelDownloadProgress((prev) => ({ ...prev, [progress.modelId]: progress }));
      if (progress.state === 'done' || progress.state === 'error') {
        refreshSttStatus();
      }
    });
    const unsubscribeBackendProgress = window.desktopStt?.onBackendInstallProgress?.((progress) => {
      setBackendInstallProgress((prev) => ({ ...prev, [progress.backendId]: progress }));
      if (['done', 'cancelled', 'error'].includes(progress.phase)) refreshSttStatus();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribeStatus?.();
      unsubscribeProgress?.();
      unsubscribeBackendProgress?.();
    };
  }, [runtimeConfig, refreshBackendCatalog, refreshModelCatalog]);

  // Poll for devices when settings are opened
  useEffect(() => {
    if (showSettings) {
      navigator.mediaDevices.enumerateDevices().then(startDevices => {
        const organized = {
          video: startDevices.filter(d => d.kind === 'videoinput'),
          audio: startDevices.filter(d => d.kind === 'audioinput'),
          output: startDevices.filter(d => d.kind === 'audiooutput')
        };
        setDevices(organized);
      });
    }
  }, [showSettings]);

  const addRecentRoom = useCallback((id) => {
    setRecentRooms(prev => {
      const updated = [id, ...prev.filter(r => r !== id)].slice(0, 5);
      storage.set('recent_rooms', updated, 24);
      return updated;
    });
  }, []);

  const clearRecentRooms = useCallback(() => {
    setRecentRooms([]);
    storage.remove('recent_rooms');
  }, []);

  const beginMeetingJoin = useCallback((nextMeetingId) => {
    const joinRequestId = createJoinRequestId();
    captionHistoryRequestIdRef.current += 1;
    activeMeetingIdRef.current = nextMeetingId;
    activeSessionStartedAtRef.current = null;
    activeJoinRequestIdRef.current = joinRequestId;
    setCaptions([]);
    setCaptionHistoryCursor(null);
    setHasOlderCaptions(false);
    setLoadingCaptionHistory(false);
    setCaptionHistoryError(null);
    return joinRequestId;
  }, []);

  const handleCreateMeeting = useCallback(async (userData) => {
    try {
      const res = await fetch(`${runtimeConfig.apiBaseUrl}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: userData.displayName })
      });
      const data = await res.json();

      const joinRequestId = beginMeetingJoin(data.meetingId);
      setMeetingId(data.meetingId);
      setUserDisplayName(userData.displayName);
      setIsMuted(userData.isMuted);
      setIsVideoOff(userData.isVideoOff);

      addRecentRoom(data.meetingId);

      socket.emit('join-meeting', {
        meetingId: data.meetingId,
        joinRequestId,
        displayName: userData.displayName,
        isMuted: userData.isMuted,
        isVideoOff: userData.isVideoOff
      });

      if (userData.selectedDevices) {
        setSelectedDevices(userData.selectedDevices);
      }
    } catch (error) {
      console.error('Failed to create meeting:', error);
    }
  }, [runtimeConfig, socket, beginMeetingJoin, addRecentRoom]);

  const handleJoinMeeting = useCallback((userData) => {
    const joinRequestId = beginMeetingJoin(userData.meetingId);
    setMeetingId(userData.meetingId);
    setUserDisplayName(userData.displayName);
    setIsMuted(userData.isMuted);
    setIsVideoOff(userData.isVideoOff);

    addRecentRoom(userData.meetingId);

    socket.emit('join-meeting', {
      meetingId: userData.meetingId,
      joinRequestId,
      displayName: userData.displayName,
      isMuted: userData.isMuted,
      isVideoOff: userData.isVideoOff
    });

    if (userData.selectedDevices) {
      setSelectedDevices(userData.selectedDevices);
    }
  }, [socket, beginMeetingJoin, addRecentRoom]);

  const handleLeave = useCallback(() => {
    leave();
    captionHistoryRequestIdRef.current += 1;
    activeMeetingIdRef.current = null;
    activeSessionStartedAtRef.current = null;
    activeJoinRequestIdRef.current = null;
    setMeetingId(null);
    setCaptions([]);
    setCaptionHistoryCursor(null);
    setHasOlderCaptions(false);
    setLoadingCaptionHistory(false);
    setCaptionHistoryError(null);
    setSummary(null);
    setUserId(null);
    setSttMetrics([]);
  }, [leave]);

  const loadOlderCaptions = useCallback(async () => {
    if (!socket || !captionHistoryCursor || loadingCaptionHistory || !activeMeetingIdRef.current) return false;

    const requestedMeetingId = activeMeetingIdRef.current;
    const requestedSessionStartedAt = activeSessionStartedAtRef.current;
    const requestedJoinRequestId = activeJoinRequestIdRef.current;
    const historyRequestId = ++captionHistoryRequestIdRef.current;
    setLoadingCaptionHistory(true);
    setCaptionHistoryError(null);

    try {
      const response = await requestCaptionHistory(socket, {
        meetingId: requestedMeetingId,
        cursor: captionHistoryCursor,
        limit: 200
      });
      if (
        activeMeetingIdRef.current !== response.meetingId
        || requestedSessionStartedAt !== response.sessionStartedAt
        || activeJoinRequestIdRef.current !== requestedJoinRequestId
        || captionHistoryRequestIdRef.current !== historyRequestId
      ) return false;

      setCaptions((prev) => mergeCaptions(prev, response.captions));
      setCaptionHistoryCursor(response.nextCursor);
      setHasOlderCaptions(response.hasMore);
      return true;
    } catch (error) {
      if (
        activeMeetingIdRef.current === requestedMeetingId
        && activeSessionStartedAtRef.current === requestedSessionStartedAt
        && activeJoinRequestIdRef.current === requestedJoinRequestId
        && captionHistoryRequestIdRef.current === historyRequestId
      ) {
        setCaptionHistoryError(error.message);
      }
      return false;
    } finally {
      if (
        activeMeetingIdRef.current === requestedMeetingId
        && activeSessionStartedAtRef.current === requestedSessionStartedAt
        && activeJoinRequestIdRef.current === requestedJoinRequestId
        && captionHistoryRequestIdRef.current === historyRequestId
      ) {
        setLoadingCaptionHistory(false);
      }
    }
  }, [socket, captionHistoryCursor, loadingCaptionHistory]);

  const copyToClipboard = useCallback(() => {
    if (!meetingId) return;
    navigator.clipboard.writeText(meetingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [meetingId]);

  const sttBenchmarkSummary = useMemo(() => {
    const numeric = (key) => sttMetrics
      .map((metric) => metric[key])
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const percentile = (values, p) => {
      if (!values.length) return null;
      return values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
    };
    const captionEvents = sttMetrics.filter((metric) => metric.event === 'caption-result');
    const lastCaption = captionEvents[captionEvents.length - 1];
    const rtf = numeric('realtimeFactor');
    const latency = numeric('captionLatencyMs');
    const inference = numeric('inferenceTimeMs');
    const droppedChunkCount = sttMetrics.reduce((max, metric) => Math.max(max, Number(metric.droppedChunkCount || 0)), 0);
    const duplicateSuppressedCount = sttMetrics.reduce((max, metric) => Math.max(max, Number(metric.duplicateSuppressedCount || 0)), 0);
    const errorCount = sttMetrics.filter((metric) => metric.event === 'error' || metric.event === 'send-failed').length;

    return {
      sampleCount: sttMetrics.length,
      captionCount: captionEvents.length,
      lastBackend: lastCaption?.backend || sttMetrics[sttMetrics.length - 1]?.backend || 'n/a',
      rtfP50: percentile(rtf, 0.5),
      rtfP95: percentile(rtf, 0.95),
      latencyP50: percentile(latency, 0.5),
      latencyP95: percentile(latency, 0.95),
      inferenceP50: percentile(inference, 0.5),
      inferenceP95: percentile(inference, 0.95),
      droppedChunkCount,
      duplicateSuppressedCount,
      errorCount
    };
  }, [sttMetrics]);

  const nativeSttRunning = sttStatus?.nativeReady === true;
  const sttModeLabel = nativeSttRunning
    ? `Whisper.cpp ${sttStatus?.activeBackend ? `(${sttStatus.activeBackend.toUpperCase()})` : ''}`
    : 'WebGPU';
  const sttModeDetail = nativeSttRunning
    ? (sttStatus?.selectedModel?.split(/[\\/]/).pop() || 'Native model')
    : 'Browser fallback';
  const formatMetric = (value, suffix = '', digits = 2) => (
    Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—'
  );

  const handleDownloadModel = useCallback(async (modelId) => {
    const result = await window.desktopStt?.downloadModel?.(modelId);
    if (!result?.ok) {
      alert(result?.error || 'Failed to download model');
    }
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshModelCatalog();
  }, [refreshModelCatalog]);

  const handleUseModel = useCallback(async (modelPath) => {
    const result = await window.desktopStt?.setModel?.(modelPath);
    if (!result?.ok) {
      alert(result?.error || 'Failed to switch Whisper model');
    }
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshModelCatalog();
  }, [refreshModelCatalog]);

  const handleDeleteModel = useCallback(async (modelId) => {
    const confirmed = window.confirm('Delete this downloaded model from this computer?');
    if (!confirmed) return;
    const result = await window.desktopStt?.deleteModel?.(modelId);
    if (!result?.ok) {
      alert(result?.error || 'Failed to delete model');
    }
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshModelCatalog();
  }, [refreshModelCatalog]);

  const handleBackendPreference = useCallback(async (backendPreference) => {
    const result = await window.desktopStt?.setBackendPreference?.(backendPreference);
    if (!result?.ok) alert(result?.error || 'Failed to change STT backend preference');
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshBackendCatalog();
  }, [refreshBackendCatalog]);

  const handleInstallBackend = useCallback(async (backendId) => {
    const backend = backendCatalog.find((candidate) => candidate.id === backendId);
    const downloadMiB = backend ? Math.round(backend.downloadSize / 1024 / 1024) : 266;
    const installedMiB = backend ? Math.round(backend.installedSize / 1024 / 1024) : 594;
    const confirmed = window.confirm(
      `Install ${backend?.label || backendId}? This downloads ${downloadMiB} MiB of executable code from the official whisper.cpp release and uses about ${installedMiB} MiB after installation.`
    );
    if (!confirmed) return;
    const result = await window.desktopStt?.installBackend?.(backendId);
    if (!result?.ok && !result?.cancelled) alert(result?.error || 'Failed to install STT backend');
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshBackendCatalog();
  }, [backendCatalog, refreshBackendCatalog]);

  const handleCancelBackendInstall = useCallback(async (backendId) => {
    const result = await window.desktopStt?.cancelBackendInstall?.(backendId);
    if (!result?.ok) alert(result?.error || 'Failed to cancel backend installation');
  }, []);

  const handleRemoveBackend = useCallback(async (backendId) => {
    if (!window.confirm('Remove this downloaded STT backend from this computer?')) return;
    const result = await window.desktopStt?.removeBackend?.(backendId);
    if (!result?.ok) alert(result?.error || 'Failed to remove STT backend');
    const status = await window.desktopStt?.getStatus?.();
    if (status) setSttStatus(status);
    await refreshBackendCatalog();
  }, [refreshBackendCatalog]);

  if (startupError) {
    return (
      <div className="h-screen bg-[#0a0a0a] text-white flex items-center justify-center font-sans p-6">
        <div className="max-w-md rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-center shadow-2xl shadow-red-950/30">
          <div className="text-sm font-black uppercase tracking-widest text-red-300">Desktop launch required</div>
          <p className="mt-3 text-sm leading-6 text-red-100/80">{startupError}</p>
        </div>
      </div>
    );
  }

  if (!runtimeConfig || !socket) {
    return (
      <div className="h-screen bg-[#0a0a0a] text-white flex items-center justify-center font-sans">
        <div className="text-sm font-bold uppercase tracking-widest text-gray-500">Starting MeetSummarizer...</div>
      </div>
    );
  }

  if (!meetingId) {
    return (
      <JoinScreen
        onCreateMeeting={handleCreateMeeting}
        onJoinMeeting={handleJoinMeeting}
        recentRooms={recentRooms}
        onClearHistory={clearRecentRooms}
        llmConfig={llmConfig}
        setLlmConfig={setLllmConfig}
        runtimeConfig={runtimeConfig}
        sttConfig={sttConfig}
        setSttConfig={setSttConfig}
        sttStatus={sttStatus}
        setSttStatus={setSttStatus}
        modelCatalog={modelCatalog}
        modelDownloadProgress={modelDownloadProgress}
        backendCatalog={backendCatalog}
        backendInstallProgress={backendInstallProgress}
        onDownloadModel={handleDownloadModel}
        onUseModel={handleUseModel}
        onDeleteModel={handleDeleteModel}
        onBackendPreference={handleBackendPreference}
        onInstallBackend={handleInstallBackend}
        onCancelBackendInstall={handleCancelBackendInstall}
        onRemoveBackend={handleRemoveBackend}
        sttModeLabel={sttModeLabel}
        sttModeDetail={sttModeDetail}
        nativeSttRunning={nativeSttRunning}
      />
    );
  }

  return (
    <div className="h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_30%),#080a10] text-white flex flex-col font-sans overflow-hidden">
      {/* Top Header */}
      <header className="min-h-16 bg-slate-950/70 backdrop-blur-xl border-b border-white/10 flex items-center justify-between px-4 sm:px-6 shrink-0 z-50 gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight leading-none">MeetSummarizer</span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Live Meeting</span>
            </div>
          </div>

          <div className="h-8 w-px bg-white/5 mx-2"></div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 group cursor-pointer bg-white/[0.06] hover:bg-white/10 px-4 py-2 rounded-2xl border border-white/10 transition-all" onClick={copyToClipboard}>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">ID: <span className="text-gray-200 font-mono tracking-normal ml-1">{meetingId}</span></span>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-gray-500 group-hover:text-blue-400 transition-colors" />}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border ${nativeSttRunning ? 'bg-purple-500/10 border-purple-500/20' : 'bg-blue-500/10 border-blue-500/20'}`} title={sttModeDetail}>
            <MessageSquare size={14} className={nativeSttRunning ? 'text-purple-400' : 'text-blue-400'} />
            <span className={`text-[10px] font-black uppercase tracking-widest ${nativeSttRunning ? 'text-purple-400' : 'text-blue-400'}`}>STT: {sttModeLabel}</span>
          </div>
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">End-to-End Encrypted</span>
          </div>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`p-2.5 rounded-xl transition-all border ${showSidebar ? 'bg-[#0E71EB]/10 border-[#0E71EB]/30 text-[#0E71EB]' : 'text-gray-500 border-transparent hover:bg-white/5 hover:text-gray-300'}`}
          >
            {showSidebar ? <PanelRightClose size={22} /> : <PanelRightOpen size={22} />}
          </button>
        </div>
      </header>

      {/* Workspace Area: Main Video + Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {(() => {
          // 1. Prepare all active participants (moved up for use in sidebar)
          const participants = [
            { id: 'local', stream: localStream, isLocal: true, displayName: userDisplayName, isHost: isHost, isMuted: isMuted, isVideoOff: isVideoOff, userId: userId },
            ...Object.entries(remoteStreams).map(([sid, stream]) => ({
              id: sid,
              stream,
              isLocal: false,
              displayName: remoteStatus[sid]?.displayName || 'Guest',
              isHost: sid === hostId,
              isMuted: remoteStatus[sid]?.isMuted,
              isVideoOff: remoteStatus[sid]?.isVideoOff,
              userId: remoteStatus[sid]?.userId // This is the database UUID
            }))
          ].filter(p => p.stream);

          // 2. Identify main and others
          let main = participants.find(p => p.id === pinnedId) || participants[0];
          const others = participants.filter(p => p.id !== main?.id);
          const miniParticipants = others.slice(0, 4);

          // 3. Create a clean mapping of userId (UUID) -> displayName for Captions
          const participantNames = {};
          participants.forEach(p => {
            if (p.userId) participantNames[p.userId] = p.displayName;
          });

          return (
            <>
              {/* Main Side: Video Feed */}
              <main className={`flex-1 flex flex-col relative transition-all duration-300 ease-in-out min-w-0 min-h-0 overflow-hidden`}>
                <div className="flex-1 flex p-3 sm:p-4 md:p-5 gap-3 md:gap-5 overflow-hidden min-h-0 pb-24 sm:pb-28">
                  {!main && participants.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="flex flex-col items-center space-y-4 opacity-20">
                        <Users size={64} />
                        <span className="text-sm font-bold uppercase tracking-widest">Waiting for others...</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Main Large Stream */}
                      <div className="flex-1 lg:flex-[3] flex items-center justify-center min-w-0 min-h-0 overflow-hidden">
                        {main && (
                          <VideoView
                            {...main}
                            pinned={true}
                            className="w-full h-full max-h-full object-contain"
                            onClick={() => setPinnedId(main.id)}
                            isMuted={main.isMuted}
                            isVideoOff={main.isVideoOff}
                          />
                        )}
                      </div>

                      {/* Sidebar Mini Streams (Desktop Only) */}
                      {miniParticipants.length > 0 && (
                        <div className="hidden lg:flex lg:flex-col gap-3 w-[clamp(220px,22vw,320px)] shrink-0 min-h-0 max-h-full overflow-y-auto overflow-x-hidden no-scrollbar pr-1">
                          {miniParticipants.map(participant => (
                            <VideoView
                              key={participant.id}
                              {...participant}
                              pinned={false}
                              className="w-full max-w-full shrink-0 shadow-lg"
                              onClick={() => setPinnedId(participant.id)}
                              isMuted={participant.isMuted}
                              isVideoOff={participant.isVideoOff}
                            />
                          ))}
                        </div>
                      )}

                      {/* Hidden background streams to keep audio alive */}
                      <div className="hidden">
                        {others.map(participant => (
                          <VideoView
                            key={participant.id}
                            {...participant}
                            isMuted={participant.isMuted}
                            isVideoOff={participant.isVideoOff}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Floating Controls - Bottom Centered */}
                <div className="absolute bottom-5 sm:bottom-7 left-1/2 -translate-x-1/2 z-20">
                  <div>
                    <MeetingControls
                      isMuted={isMuted}
                      isVideoOff={isVideoOff}
                      onToggleMute={toggleMute}
                      onToggleVideo={toggleVideo}
                      onLeave={handleLeave}
                      onSettingsClick={() => setShowSettings(true)}
                    />
                  </div>
                </div>
              </main>

              {/* Sidebar: Integrated Design */}
              <aside className={`h-full min-h-0 bg-slate-950/80 backdrop-blur-xl border-l border-white/10 flex flex-col transition-all duration-500 ease-in-out ${showSidebar ? 'w-[min(420px,40vw)] max-lg:absolute max-lg:right-0 max-lg:top-0 max-lg:bottom-0 max-lg:w-[min(390px,100vw)] max-lg:z-30' : 'w-0 opacity-0 pointer-events-none overflow-hidden'}`}>
                {/* Tabs */}
                <div className="shrink-0 flex border-b border-white/10 bg-slate-950/80 p-1.5 gap-1.5">
                  <button
                    onClick={() => setSidebarTab('summary')}
                    className={`flex-1 rounded-xl py-3 text-[10px] font-black uppercase tracking-[0.18em] transition-all flex items-center justify-center gap-2 ${sidebarTab === 'summary' ? 'text-blue-200 bg-blue-500/15 border border-blue-400/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'}`}
                  >
                    <FileText size={16} />
                    Summary
                  </button>
                  <button
                    onClick={() => setSidebarTab('transcript')}
                    className={`flex-1 rounded-xl py-3 text-[10px] font-black uppercase tracking-[0.18em] transition-all flex items-center justify-center gap-2 ${sidebarTab === 'transcript' ? 'text-blue-200 bg-blue-500/15 border border-blue-400/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'}`}
                  >
                    <MessageSquare size={16} />
                    Transcript
                  </button>
                  <button
                    onClick={() => setSidebarTab('benchmarks')}
                    className={`flex-1 rounded-xl py-3 text-[10px] font-black uppercase tracking-[0.18em] transition-all flex items-center justify-center gap-2 ${sidebarTab === 'benchmarks' ? 'text-blue-200 bg-blue-500/15 border border-blue-400/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'}`}
                  >
                    <Monitor size={16} />
                    Bench
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4">
                  {sidebarTab === 'summary' ? (
                    <SummaryPanel
                      summary={summary}
                      generating={generating}
                      llmConfig={llmConfig}
                      onOpenSettings={() => setShowSettings(true)}
                      onGenerate={async (minutes) => {
                        setGenerating(true);
                        try {
                          const url = new URL(`${runtimeConfig.apiBaseUrl}/meetings/${meetingId}/summary`);
                          if (minutes) url.searchParams.set('minutes', minutes);
                          const res = await fetch(url.toString(), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: userId,
                              llmConfig: {
                                provider: llmConfig.provider,
                                model: getSelectedModelId(llmConfig),
                                apiKey: getActiveApiKey(llmConfig)
                              }
                            })
                          });
                           const data = await res.json();
                           if (data.error) {
                             alert(data.error);
                             return false;
                           } else {
                             setSummary(data);
                             return true;
                           }
                         } catch (err) {
                           console.error("Failed to generate summary:", err);
                           return false;
                         } finally {
                          setGenerating(false);
                        }
                      }}
                    />
                  ) : sidebarTab === 'transcript' ? (
                    <CaptionPanel
                      captions={captions}
                      participantNames={participantNames}
                      hasOlderCaptions={hasOlderCaptions}
                      loadingHistory={loadingCaptionHistory}
                      historyError={captionHistoryError}
                      onLoadOlder={loadOlderCaptions}
                    />
                  ) : (
                    <div className="h-full overflow-y-auto no-scrollbar space-y-4">
                      <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">STT Benchmark Monitor</p>
                            <p className="text-sm font-bold text-white mt-1">{sttModeLabel}</p>
                            <p className="text-[11px] text-gray-500 mt-1">{sttBenchmarkSummary.sampleCount} telemetry events · {sttBenchmarkSummary.captionCount} captions</p>
                          </div>
                          <button
                            onClick={() => setSttMetrics([])}
                            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-400"
                          >
                            Reset
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {[
                          ['RTF p50', formatMetric(sttBenchmarkSummary.rtfP50, 'x')],
                          ['RTF p95', formatMetric(sttBenchmarkSummary.rtfP95, 'x')],
                          ['Latency p50', formatMetric(sttBenchmarkSummary.latencyP50, 'ms', 0)],
                          ['Latency p95', formatMetric(sttBenchmarkSummary.latencyP95, 'ms', 0)],
                          ['Infer p50', formatMetric(sttBenchmarkSummary.inferenceP50, 'ms', 0)],
                          ['Infer p95', formatMetric(sttBenchmarkSummary.inferenceP95, 'ms', 0)],
                          ['Dropped', sttBenchmarkSummary.droppedChunkCount],
                          ['Errors', sttBenchmarkSummary.errorCount]
                        ].map(([label, value]) => (
                          <div key={label} className="p-4 rounded-2xl bg-slate-900/70 border border-white/10">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{label}</p>
                            <p className="text-xl font-black text-white mt-1">{value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20">
                        <p className="text-[10px] font-black text-purple-300 uppercase tracking-widest">Resume Metrics</p>
                        <ul className="mt-3 space-y-2 text-xs text-purple-100/80 leading-relaxed list-disc pl-4">
                          <li>Realtime factor p50/p95 across WebGPU and whisper.cpp.</li>
                          <li>Caption latency p50/p95 from audio chunk to transcript.</li>
                          <li>Dropped chunks, inference time, duplicate suppression, and fallback errors.</li>
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Recent Events</p>
                        {sttMetrics.slice(-12).reverse().map((metric) => (
                          <div key={metric.id} className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-bold text-white">{metric.event || 'metric'}</span>
                              <span className="text-[10px] font-black uppercase text-blue-300">{metric.backend || 'n/a'}</span>
                            </div>
                            <p className="text-[11px] text-gray-500 mt-1">
                              RTF {formatMetric(metric.realtimeFactor, 'x')} · Infer {formatMetric(metric.inferenceTimeMs, 'ms', 0)} · Latency {formatMetric(metric.captionLatencyMs, 'ms', 0)}
                            </p>
                          </div>
                        ))}
                        {sttMetrics.length === 0 && (
                          <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center text-xs text-gray-500 font-bold">
                            Start speaking to collect STT benchmark events.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Sidebar Footer - STT Status Bar */}
                <SttStatusBar
                  sttStatus={sttStatus}
                  modelDownloadProgress={modelDownloadProgress}
                  backendInstallProgress={backendInstallProgress}
                />
              </aside>
            </>
          );
        })()}
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          devices={devices}
          selectedDevices={selectedDevices}
          onDeviceChange={(type, value) => setSelectedDevices(prev => ({ ...prev, [type]: value }))}
          sttConfig={sttConfig}
          setSttConfig={setSttConfig}
          sttStatus={sttStatus}
          setSttStatus={setSttStatus}
          modelCatalog={modelCatalog}
          modelDownloadProgress={modelDownloadProgress}
          backendCatalog={backendCatalog}
          backendInstallProgress={backendInstallProgress}
          onDownloadModel={handleDownloadModel}
          onUseModel={handleUseModel}
          onDeleteModel={handleDeleteModel}
          onBackendPreference={handleBackendPreference}
          onInstallBackend={handleInstallBackend}
          onCancelBackendInstall={handleCancelBackendInstall}
          onRemoveBackend={handleRemoveBackend}
          sttModeLabel={sttModeLabel}
          sttModeDetail={sttModeDetail}
          nativeSttRunning={nativeSttRunning}
          llmConfig={llmConfig}
          setLlmConfig={setLllmConfig}
        />
      )}

    </div>
  );
}


export default App;
