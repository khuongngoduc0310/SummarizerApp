import React, { useState, useEffect } from 'react';
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


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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
    } catch (e) {
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

  // Initialize Audio Pipeline for transcription
  useAudioPipeline(socket, meetingId, localStream, userId);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const toggleVideo = () => {
    setIsVideoOff(prev => !prev);
  };

  useEffect(() => {
    const newSocket = io(API_URL);
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

    return () => newSocket.close();
  }, []);

  // Persist LLM Config
  useEffect(() => {
    storage.set('llm_config', llmConfig);
  }, [llmConfig]);

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
      const res = await fetch(`${API_URL}/meetings`, {
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
  };

  const copyToClipboard = () => {
    if (!meetingId) return;
    navigator.clipboard.writeText(meetingId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!meetingId) {
    return (
      <JoinScreen
        onCreateMeeting={handleCreateMeeting}
        onJoinMeeting={handleJoinMeeting}
        recentRooms={recentRooms}
        onClearHistory={clearRecentRooms}
        llmConfig={llmConfig}
        setLlmConfig={setLllmConfig}
      />
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0a] text-white flex flex-col font-sans overflow-hidden">
      {/* Top Header - Unified Professional Style */}
      <header className="h-16 bg-[#111] border-b border-white/5 flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#0E71EB] to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video size={20} className="text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight leading-none">MeetSummarizer</span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Live Meeting</span>
            </div>
          </div>

          <div className="h-8 w-px bg-white/5 mx-2"></div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 group cursor-pointer bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl border border-white/5 transition-all" onClick={copyToClipboard}>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">ID: <span className="text-gray-200 font-mono tracking-normal ml-1">{meetingId}</span></span>
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-gray-500 group-hover:text-blue-400 transition-colors" />}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
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
              <main className={`flex-1 flex flex-col relative bg-[#0a0a0a] transition-all duration-300 ease-in-out`}>
                <div className="flex-1 flex p-4 md:p-8 gap-4 md:gap-6 overflow-hidden min-h-0">
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
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
                  <div className="bg-[#111]/80 backdrop-blur-2xl border border-white/10 rounded-[24px] p-2.5 flex items-center gap-2 shadow-[0_30px_70px_rgba(0,0,0,0.6)]">
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
              <aside className={`bg-[#0d0d0d] border-l border-white/5 flex flex-col transition-all duration-500 ease-in-out ${showSidebar ? 'w-[450px]' : 'w-0 opacity-0 pointer-events-none overflow-hidden'}`}>
                {/* Tabs */}
                <div className="flex border-b border-white/5 bg-[#111]">
                  <button
                    onClick={() => setSidebarTab('summary')}
                    className={`flex-1 py-5 text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 ${sidebarTab === 'summary' ? 'text-[#0E71EB] bg-[#0E71EB]/5 border-b-2 border-[#0E71EB]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                  >
                    <FileText size={16} />
                    Summary
                  </button>
                  <button
                    onClick={() => setSidebarTab('transcript')}
                    className={`flex-1 py-5 text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 ${sidebarTab === 'transcript' ? 'text-[#0E71EB] bg-[#0E71EB]/5 border-b-2 border-[#0E71EB]' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                  >
                    <MessageSquare size={16} />
                    Transcript
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 scrollbar-thin">
                  {sidebarTab === 'summary' ? (
                    <SummaryPanel
                      summary={summary}
                      generating={generating}
                      llmConfig={llmConfig}
                      onOpenSettings={() => setShowSettings(true)}
                      onGenerate={async () => {
                        setGenerating(true);
                        try {
                          const res = await fetch(`${API_URL}/meetings/${meetingId}/summary`, {
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
                  ) : (
                    <CaptionPanel
                      captions={captions}
                      participantNames={participantNames}
                    />
                  )}
                </div>

                {/* Sidebar Footer */}
                <div className="p-6 border-t border-white/5 bg-[#111]/30">
                  <div className="flex items-start gap-4 p-4 bg-blue-500/5 border border-blue-500/10 rounded-[20px]">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <ShieldCheck size={18} className="text-[#0E71EB]" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-[#0E71EB] uppercase tracking-wider">Privacy Guaranteed</p>
                      <p className="text-[11px] font-medium text-gray-500 leading-relaxed">
                        Audio is processed on your local hardware. Only text summaries are sent to secure cloud servers.
                      </p>
                    </div>
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
          <div className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-2xl shadow-2xl p-8 animate-in zoom-in-95 duration-200">
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
