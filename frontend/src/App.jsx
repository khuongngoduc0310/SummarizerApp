import React, { useState, useEffect, useCallback, useMemo } from 'react';
import io from 'socket.io-client';
import {
  Video,
  ShieldCheck,
  Users,
  Copy,
  Check,
  LogOut,
  Settings,
  MessageSquare,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  Monitor,
  Sparkles
} from 'lucide-react';

import JoinScreen from './components/JoinScreen';
import MeetingControls from './components/MeetingControls';
import CaptionPanel from './components/CaptionPanel';
import SummaryPanel from './components/SummaryPanel';
import VideoView from './components/VideoView';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudioPipeline } from './hooks/useAudioPipeline';


const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const getRuntimeConfig = async () => {
  if (window.desktopConfig?.getRuntimeConfig) {
    try {
      const config = await window.desktopConfig.getRuntimeConfig();
      if (config?.apiBaseUrl) return config;
    } catch (error) {
      console.warn('Failed to load Electron runtime config, falling back to Vite config:', error);
    }
  }

  return {
    apiBaseUrl: DEFAULT_API_URL,
    socketUrl: DEFAULT_API_URL,
    appMode: 'browser-dev',
    features: {
      nativeStt: false,
      browserSttFallback: true
    }
  };
};

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
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('summary'); // 'summary' or 'transcript'
  const [pinnedId, setPinnedId] = useState('local');
  const [showSettings, setShowSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
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

  // Device Management
  const [devices, setDevices] = useState({ video: [], audio: [], output: [] });
  const [selectedDevices, setSelectedDevices] = useState({ video: '', audio: '', output: '' });

  // LLM Configuration
  const [llmConfig, setLllmConfig] = useState(() => {
    return storage.get('llm_config') || { provider: 'openai', apiKey: '' };
  });

  const [isMuted, setIsMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [recentRooms, setRecentRooms] = useState([]);

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

  // Initialize Audio Pipeline for transcription
  useAudioPipeline(socket, meetingId, localStream, userId, runtimeConfig, sttConfig, handleSttMetric);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const toggleVideo = () => {
    setIsVideoOff(prev => !prev);
  };

  useEffect(() => {
    let cancelled = false;

    getRuntimeConfig().then((config) => {
      if (!cancelled) setRuntimeConfig(config);
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
      setCaptions((prev) => [...prev, data]);
    });

    newSocket.on('joined-successfully', (data) => {
      setUserId(data.userId);
      console.log('Successfully joined as:', data.displayName);
    });

    newSocket.on('user-joined', (data) => {
      console.log('Another user joined:', data.displayName);
    });

    // Load recent rooms
    const saved = storage.get('recent_rooms') || [];
    setRecentRooms(saved);

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
      } catch {
        if (!cancelled) setSttStatus(runtimeConfig.stt || null);
      }
    };

    refreshSttStatus();
    const interval = setInterval(refreshSttStatus, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runtimeConfig]);

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

  const addRecentRoom = (id) => {
    const updated = [id, ...recentRooms.filter(r => r !== id)].slice(0, 5);
    setRecentRooms(updated);
    storage.set('recent_rooms', updated, 24);
  };

  const clearRecentRooms = () => {
    setRecentRooms([]);
    storage.remove('recent_rooms');
  };

  const handleCreateMeeting = async (userData) => {
    try {
      const res = await fetch(`${runtimeConfig.apiBaseUrl}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: userData.displayName })
      });
      const data = await res.json();

      setMeetingId(data.meetingId);
      setUserDisplayName(userData.displayName);
      setIsMuted(userData.isMuted);
      setIsVideoOff(userData.isVideoOff);

      // Track as recent and active
      addRecentRoom(data.meetingId);

      // Join the room via socket
      socket.emit('join-meeting', {
        meetingId: data.meetingId,
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
  };

  const handleJoinMeeting = (userData) => {

    setMeetingId(userData.meetingId);
    setUserDisplayName(userData.displayName);
    setIsMuted(userData.isMuted);
    setIsVideoOff(userData.isVideoOff);

    // Track as recent and active
    addRecentRoom(userData.meetingId);

    // Join the room via socket
    socket.emit('join-meeting', {
      meetingId: userData.meetingId,
      displayName: userData.displayName,
      isMuted: userData.isMuted,
      isVideoOff: userData.isVideoOff
    });

    if (userData.selectedDevices) {
      setSelectedDevices(userData.selectedDevices);
    }

  };

  const handleLeave = () => {
    leave();
    setMeetingId(null);
    setCaptions([]);
    setSummary(null);
    setUserId(null);
    setSttMetrics([]);
  };

  const copyToClipboard = () => {
    if (!meetingId) return;
    navigator.clipboard.writeText(meetingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  const nativeSttRunning = runtimeConfig?.features?.nativeStt && sttStatus?.status === 'running';
  const sttModeLabel = nativeSttRunning
    ? `Whisper.cpp ${sttStatus?.selectedBackend ? `(${sttStatus.selectedBackend.toUpperCase()})` : ''}`
    : 'WebGPU';
  const sttModeDetail = nativeSttRunning
    ? (sttStatus?.selectedModel?.split(/[\\/]/).pop() || 'Native model')
    : 'Browser fallback';
  const formatMetric = (value, suffix = '', digits = 2) => (
    Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—'
  );

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
              <main className={`flex-1 flex flex-col relative transition-all duration-300 ease-in-out min-w-0`}>
                <div className="flex-1 flex p-3 sm:p-5 md:p-7 gap-4 md:gap-6 overflow-hidden min-h-0 pb-28">
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
                      <div className="flex-1 lg:flex-[3] flex items-center justify-center min-w-0">
                        {main && (
                          <VideoView
                            {...main}
                            pinned={true}
                            className="w-full h-full max-h-full lg:max-h-[80vh] object-contain"
                            onClick={() => setPinnedId(main.id)}
                            isMuted={main.isMuted}
                            isVideoOff={main.isVideoOff}
                          />
                        )}
                      </div>

                      {/* Sidebar Mini Streams (Desktop Only) */}
                      {miniParticipants.length > 0 && (
                        <div className="hidden lg:flex lg:flex-col gap-4 min-w-[280px] max-w-[320px] overflow-y-auto no-scrollbar">
                          {miniParticipants.map(participant => (
                            <VideoView
                              key={participant.id}
                              {...participant}
                              pinned={false}
                              className="w-full shadow-lg"
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
                      onGenerate={async () => {
                        setGenerating(true);
                        try {
                          const res = await fetch(`${runtimeConfig.apiBaseUrl}/meetings/${meetingId}/summary`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: userId,
                              llmConfig: llmConfig
                            })
                          });
                          const data = await res.json();
                          if (data.error) {
                            alert(data.error);
                          } else {
                            setSummary(data);
                          }
                        } catch (err) {
                          console.error("Failed to generate summary:", err);
                        } finally {
                          setGenerating(false);
                        }
                      }}
                    />
                  ) : sidebarTab === 'transcript' ? (
                    <CaptionPanel
                      captions={captions}
                      participantNames={participantNames}
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

                {/* Sidebar Footer */}
                <div className="shrink-0 border-t border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-200/80">
                    <ShieldCheck size={14} className="text-emerald-300" />
                    <span>Audio local · Text-only AI summaries</span>
                  </div>
                </div>
              </aside>
            </>
          );
        })()}
      </div>

      {/* Settings Modal (Overlay) */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-400">
                  <Settings size={20} />
                </div>
                <h2 className="text-xl font-bold">Device Settings</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors">
                <PanelRightClose size={20} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Camera */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Video size={14} /> Camera
                </label>
                <div className="relative">
                  <select
                    value={selectedDevices.video}
                    onChange={e => setSelectedDevices(prev => ({ ...prev, video: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                  >
                    {devices.video.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>)}
                  </select>
                </div>
              </div>

              {/* Microphone */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Monitor size={14} /> Microphone
                </label>
                <div className="relative">
                  <select
                    value={selectedDevices.audio}
                    onChange={e => setSelectedDevices(prev => ({ ...prev, audio: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                  >
                    {devices.audio.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 4)}`}</option>)}
                  </select>
                </div>
              </div>

              {/* Audio Output */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Monitor size={14} /> Speaker
                </label>
                <div className="relative">
                  <select
                    value={selectedDevices.output}
                    onChange={e => setSelectedDevices(prev => ({ ...prev, output: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 appearance-none"
                  >
                    {devices.output.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 4)}`}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* STT Configuration */}
            <div className="pt-6 border-t border-white/5 space-y-6">
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
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Native Backend</label>
                <select
                  value={sttStatus?.selectedBackend || ''}
                  onChange={async (e) => {
                    const backendId = e.target.value;
                    if (!backendId || !window.desktopStt?.setBackend) return;
                    const result = await window.desktopStt.setBackend(backendId);
                    if (!result?.ok) {
                      alert(result?.error || 'Failed to switch STT backend');
                    }
                    const status = await window.desktopStt.getStatus?.();
                    if (status) setSttStatus(status);
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
                >
                  {(sttStatus?.backends || []).map((backend) => (
                    <option key={backend.id} value={backend.id} disabled={!backend.available}>
                      {backend.label} {backend.available ? 'available' : `missing ${backend.missingFiles?.join(', ') || 'files'}`}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-1 gap-2">
                  {(sttStatus?.backends || []).map((backend) => (
                    <div key={backend.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2">
                      <span className="text-xs font-bold text-gray-300">{backend.label}</span>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${backend.available ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {backend.available ? backend.validationStatus || 'available' : backend.validationError || 'missing'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Window</label>
                  <select
                    value={sttConfig.windowSec}
                    onChange={e => setSttConfig(prev => ({
                      ...prev,
                      windowSec: Number(e.target.value),
                      overlapSec: Math.min(prev.overlapSec, Number(e.target.value) - 0.5)
                    }))}
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
                    onChange={e => setSttConfig(prev => ({
                      ...prev,
                      overlapSec: Math.min(Number(e.target.value), prev.windowSec - 0.5)
                    }))}
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
                  <input
                    type="checkbox"
                    checked={sttConfig.highPassFilter ?? true}
                    onChange={e => setSttConfig(prev => ({ ...prev, highPassFilter: e.target.checked }))}
                  />
                  High-pass filter
                </label>
                <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
                  <input
                    type="checkbox"
                    checked={sttConfig.silenceTrim ?? true}
                    onChange={e => setSttConfig(prev => ({ ...prev, silenceTrim: e.target.checked }))}
                  />
                  Trim silence
                </label>
                <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
                  <input
                    type="checkbox"
                    checked={sttConfig.normalizeAudio ?? true}
                    onChange={e => setSttConfig(prev => ({ ...prev, normalizeAudio: e.target.checked }))}
                  />
                  Normalize quiet speech
                </label>
                <label className="flex items-center gap-3 text-xs font-bold text-gray-400">
                  <input
                    type="checkbox"
                    checked={sttConfig.dcOffsetRemoval ?? true}
                    onChange={e => setSttConfig(prev => ({ ...prev, dcOffsetRemoval: e.target.checked }))}
                  />
                  Remove DC offset
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">VAD threshold</label>
                  <select
                    value={sttConfig.vadThreshold ?? 0.008}
                    onChange={e => setSttConfig(prev => ({ ...prev, vadThreshold: Number(e.target.value) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
                  >
                    <option value={0.004}>Low</option>
                    <option value={0.008}>Medium</option>
                    <option value={0.014}>High</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">High-pass cutoff</label>
                  <select
                    value={sttConfig.highPassCutoffHz ?? 100}
                    onChange={e => setSttConfig(prev => ({ ...prev, highPassCutoffHz: Number(e.target.value) }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none"
                  >
                    <option value={80}>80 Hz</option>
                    <option value={100}>100 Hz</option>
                    <option value={120}>120 Hz</option>
                    <option value={150}>150 Hz</option>
                  </select>
                </div>
              </div>
            </div>

            {/* LLM Configuration */}
            <div className="pt-6 border-t border-white/5 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center text-purple-400">
                  <Sparkles size={16} />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">AI Summary Settings</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">AI Provider</label>
                  <select
                    value={llmConfig.provider}
                    onChange={e => setLllmConfig(prev => ({ ...prev, provider: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 appearance-none"
                  >
                    <option value="openai">OpenAI (GPT-4o)</option>
                    <option value="anthropic">Anthropic (Claude 3.5)</option>
                    <option value="deepseek">DeepSeek (V3)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">API Key</label>
                  <input
                    type="password"
                    value={llmConfig.apiKey}
                    onChange={e => setLllmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="sk-..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-purple-500/50"
                  />
                </div>
              </div>
              <p className="text-[10px] text-gray-600 font-medium leading-relaxed italic">
                * Your API key is stored locally in your browser and never saved on our servers.
              </p>
            </div>

            <div className="pt-4 flex justify-end">
              <button onClick={() => setShowSettings(false)} className="px-6 py-2 bg-[#0E71EB] hover:bg-blue-600 text-white text-sm font-bold rounded-xl transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default App;
