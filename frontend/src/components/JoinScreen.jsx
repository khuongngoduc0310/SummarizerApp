import React, { useState, useEffect, useRef } from 'react';
import {
    Video,
    VideoOff,
    Mic,
    MicOff,
    Settings,
    ShieldCheck,
    AlertCircle,
    Camera,
    Speaker,
    ArrowRight,
    Check,
    ChevronDown,
    Sparkles,
    Zap,
    User,
    Plus,
    LogIn,
    History,
    Trash2
} from 'lucide-react';

const JoinScreen = ({ onCreateMeeting, onJoinMeeting, recentRooms = [], onClearHistory, llmConfig, setLlmConfig }) => {
    const [displayName, setDisplayName] = useState('');
    const [meetingId, setMeetingId] = useState('');
    const [isMuted, setIsMuted] = useState(true);
    const [isVideoOff, setIsVideoOff] = useState(true);
    const [devices, setDevices] = useState({ video: [], audio: [], output: [] });
    const [selectedDevices, setSelectedDevices] = useState({ video: '', audio: '', output: '' });
    const [permissionError, setPermissionError] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

    useEffect(() => {
        const initMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;

                // Physical Sync: If preferences are OFF, stop the tracks entirely (turns off hardware light)
                if (isMuted) {
                    stream.getAudioTracks().forEach(t => { t.enabled = false; });
                }
                if (isVideoOff) {
                    stream.getVideoTracks().forEach(t => { t.stop(); });
                }

                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const organized = {
                    video: allDevices.filter(d => d.kind === 'videoinput'),
                    audio: allDevices.filter(d => d.kind === 'audioinput'),
                    output: allDevices.filter(d => d.kind === 'audiooutput')
                };
                setDevices(organized);

                setSelectedDevices({
                    video: organized.video[0]?.deviceId || '',
                    audio: organized.audio[0]?.deviceId || '',
                    output: organized.output[0]?.deviceId || ''
                });
            } catch (err) {
                console.error("Permission error:", err);
                setPermissionError("Camera or microphone access was denied. Please check your browser permissions.");
                setIsVideoOff(true);
                setIsMuted(true);
            }
        };

        initMedia();

        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleDeviceChange = async (kind, deviceId) => {
        setSelectedDevices(prev => ({ ...prev, [kind]: deviceId }));

        if (kind === 'video' || kind === 'audio') {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: kind === 'video' ? { deviceId: { exact: deviceId } } : !isVideoOff,
                    audio: kind === 'audio' ? { deviceId: { exact: deviceId } } : !isMuted
                });
                streamRef.current = newStream;
                if (videoRef.current) videoRef.current.srcObject = newStream;
            } catch (err) {
                console.error("Device switch error:", err);
            }
        }
    };

    const toggleMute = async () => {
        if (isMuted) {
            // Turning Mic ON
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    audio: selectedDevices.audio ? { deviceId: { exact: selectedDevices.audio } } : true
                });
                const audioTrack = newStream.getAudioTracks()[0];
                if (streamRef.current) {
                    streamRef.current.getAudioTracks().forEach(t => { t.stop(); streamRef.current.removeTrack(t); });
                    streamRef.current.addTrack(audioTrack);
                }
                setIsMuted(false);
            } catch (err) {
                console.error("Error starting audio:", err);
            }
        } else {
            // Turning Mic OFF
            if (streamRef.current) {
                streamRef.current.getAudioTracks().forEach(t => { t.stop(); });
            }
            setIsMuted(true);
        }
    };

    const toggleVideo = async () => {
        if (isVideoOff) {
            // Turning Camera ON
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: selectedDevices.video ? { deviceId: { exact: selectedDevices.video } } : true
                });
                const videoTrack = newStream.getVideoTracks()[0];
                if (streamRef.current) {
                    streamRef.current.getVideoTracks().forEach(t => { t.stop(); streamRef.current.removeTrack(t); });
                    streamRef.current.addTrack(videoTrack);
                    // Re-assign srcObject to ensure the video element picks up the new track
                    if (videoRef.current) videoRef.current.srcObject = streamRef.current;
                }
                setIsVideoOff(false);
            } catch (err) {
                console.error("Error starting video:", err);
            }
        } else {
            // Turning Camera OFF
            if (streamRef.current) {
                streamRef.current.getVideoTracks().forEach(t => { t.stop(); });
            }
            setIsVideoOff(true);
        }
    };

    const handleCreateRoom = () => {
        if (!displayName.trim()) return;
        onCreateMeeting({
            displayName,
            isMuted,
            isVideoOff,
            selectedDevices
        });
    };

    const handleJoinRoom = () => {
        if (!displayName.trim() || !meetingId.trim()) return;
        onJoinMeeting({
            meetingId,
            displayName,
            isMuted,
            isVideoOff,
            selectedDevices
        });
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col font-sans selection:bg-blue-500/30 overflow-hidden relative">
            {/* Animated Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-40">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-[128px] animate-pulse-slow"></div>
                <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-[128px] animate-pulse-slow" style={{ animationDelay: '3s' }}></div>
            </div>

            {/* Navigation */}
            <nav className="h-16 border-b border-white/10 px-8 flex justify-between items-center glass-card-strong shrink-0 z-50 relative">
                <div className="flex items-center gap-3">
                    <div className="relative w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <Video size={20} className="text-white" />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold text-lg tracking-tight">MeetSummarizer</span>
                        <span className="text-[9px] font-semibold text-blue-400 tracking-wider uppercase">Preview Room</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Secure</span>
                </div>
            </nav>

            {/* Main Content - Centered with proper padding */}
            <main className="flex-1 flex items-center justify-center px-8 py-16 overflow-y-auto relative z-10">
                <div className="w-full max-w-7xl mx-auto flex flex-col items-center space-y-12">

                    {/* Video Preview - Perfectly Centered */}
                    <div className="w-full max-w-5xl">
                        <div className="relative bg-slate-950 rounded-[2rem] shadow-2xl overflow-hidden group border border-white/10 aspect-video w-full">
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-blue-500/20 rounded-[2rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                            <div className="relative w-full h-full rounded-3xl overflow-hidden bg-gradient-to-br from-slate-900 to-slate-950">
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className={`w-full h-full object-contain mirror transition-opacity duration-500 ${isVideoOff || permissionError ? 'opacity-0' : 'opacity-100'}`}
                                    aria-label="Camera preview"
                                />

                                {(isVideoOff || permissionError) && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center animate-in fade-in duration-500">
                                        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-white/10 flex items-center justify-center shadow-2xl">
                                            <User size={64} className="text-slate-600" />
                                        </div>
                                        {permissionError && (
                                            <div className="mt-8 px-8 text-center max-w-md">
                                                <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-full mb-3">
                                                    <AlertCircle size={16} className="text-red-400" />
                                                    <p className="text-red-400 text-xs font-bold uppercase tracking-wider">Permission Required</p>
                                                </div>
                                                <p className="text-slate-400 text-sm font-medium leading-relaxed">{permissionError}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Status Badges */}
                                <div className="absolute top-6 left-6 flex gap-2">
                                    {isMuted && (
                                        <div className="px-4 py-2 bg-red-500/90 backdrop-blur-md text-white text-xs font-bold uppercase rounded-lg flex items-center gap-2 shadow-lg">
                                            <MicOff size={14} /> Muted
                                        </div>
                                    )}
                                    {isVideoOff && !permissionError && (
                                        <div className="px-4 py-2 bg-slate-800/90 backdrop-blur-md text-white text-xs font-bold uppercase rounded-lg flex items-center gap-2 shadow-lg">
                                            <VideoOff size={14} /> Camera Off
                                        </div>
                                    )}
                                </div>

                                {/* Floating Controls */}
                                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3">
                                    <button
                                        onClick={toggleMute}
                                        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                                        className={`p-4 rounded-xl transition-all shadow-xl transform hover:scale-105 active:scale-95 ${isMuted
                                            ? 'bg-red-500 text-white'
                                            : 'glass-card text-white hover:bg-white/20'
                                            }`}
                                    >
                                        {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                                    </button>
                                    <button
                                        onClick={toggleVideo}
                                        aria-label={isVideoOff ? "Start camera" : "Stop camera"}
                                        className={`p-4 rounded-xl transition-all shadow-xl transform hover:scale-105 active:scale-95 ${isVideoOff
                                            ? 'bg-red-500 text-white'
                                            : 'glass-card text-white hover:bg-white/20'
                                            }`}
                                    >
                                        {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                                    </button>
                                    <button
                                        onClick={() => setShowSettings(!showSettings)}
                                        aria-label="Settings"
                                        className={`p-4 rounded-xl transition-all shadow-xl transform hover:scale-105 active:scale-95 ${showSettings
                                            ? 'bg-blue-500 text-white'
                                            : 'glass-card text-white hover:bg-white/20'
                                            }`}
                                    >
                                        <Settings size={24} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Device Settings - Centered */}
                    {showSettings && (
                        <div className="w-full max-w-5xl glass-card-strong rounded-2xl p-10 shadow-2xl border border-white/10 animate-in slide-in-from-top-4 fade-in">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400">
                                    <Settings size={22} />
                                </div>
                                <h3 className="text-2xl font-bold tracking-tight">Device Settings</h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {[
                                    { icon: Camera, label: 'Camera', type: 'video', devices: devices.video },
                                    { icon: Mic, label: 'Microphone', type: 'audio', devices: devices.audio },
                                    { icon: Speaker, label: 'Speakers', type: 'output', devices: devices.output }
                                ].map((item, idx) => (
                                    <div key={idx} className="space-y-3">
                                        <label className="text-sm font-bold text-slate-300 uppercase tracking-wider ml-1 flex items-center gap-2">
                                            <item.icon size={14} /> {item.label}
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={selectedDevices[item.type]}
                                                onChange={(e) => handleDeviceChange(item.type, e.target.value)}
                                                className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-5 py-4 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer hover:bg-slate-900/70 transition-all"
                                                aria-label={`Select ${item.label.toLowerCase()}`}
                                            >
                                                {item.devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `${item.label} ${d.deviceId.slice(0, 5)}`}</option>)}
                                                {item.devices.length === 0 && <option>No {item.label.toLowerCase()} detected</option>}
                                            </select>
                                            <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* LLM Configuration */}
                            {llmConfig && (
                                <div className="mt-10 pt-10 border-t border-white/10 space-y-8">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center text-purple-400">
                                            <Sparkles size={22} />
                                        </div>
                                        <div className="flex flex-col">
                                            <h3 className="text-2xl font-bold tracking-tight">AI Summary Settings</h3>
                                            <p className="text-slate-500 text-sm font-medium italic">Configure your AI provider for meeting notes</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <label className="text-sm font-bold text-slate-300 uppercase tracking-wider ml-1 flex items-center gap-2">
                                                Provider
                                            </label>
                                            <div className="relative">
                                                <select
                                                    value={llmConfig.provider}
                                                    onChange={(e) => setLlmConfig(prev => ({ ...prev, provider: e.target.value }))}
                                                    className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-5 py-4 text-sm text-slate-200 focus:outline-none focus:border-purple-500/50 appearance-none cursor-pointer hover:bg-slate-900/70 transition-all font-semibold"
                                                >
                                                    <option value="openai">OpenAI (GPT-4o)</option>
                                                    <option value="anthropic">Anthropic (Claude 3.5)</option>
                                                    <option value="deepseek">DeepSeek (V3)</option>
                                                </select>
                                                <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <label className="text-sm font-bold text-slate-300 uppercase tracking-wider ml-1 flex items-center gap-2">
                                                API Key
                                            </label>
                                            <input
                                                type="password"
                                                value={llmConfig.apiKey}
                                                onChange={(e) => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                                placeholder="sk-..."
                                                className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-6 py-4 text-white placeholder-slate-700 focus:outline-none focus:border-purple-500/50 transition-all font-mono"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest pl-1">
                                        * Keys are stored locally in your browser and never touch our database.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Join/Create Form - Perfectly Centered with Better Padding */}
                    <div className="w-full max-w-4xl glass-card-strong rounded-3xl p-14 shadow-2xl border border-white/10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

                        <div className="space-y-5 relative z-10 text-center mb-12">
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-bold uppercase tracking-wider text-slate-400">
                                <Sparkles size={14} className="text-blue-400" />
                                Ready to connect
                            </div>
                            <h1 className="text-6xl font-black tracking-tight leading-tight">
                                Join the <span className="gradient-text">conversation</span>
                            </h1>
                            <p className="text-slate-400 font-medium text-lg leading-relaxed max-w-2xl mx-auto">
                                Configure your identity and choose how to join.
                            </p>
                        </div>

                        <div className="space-y-10 relative z-10">
                            {/* Display Name */}
                            <div className="space-y-4">
                                <label htmlFor="display-name" className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center justify-center gap-2">
                                    <User size={14} />
                                    Your Display Name
                                </label>
                                <input
                                    id="display-name"
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder="e.g. Alex Johnson"
                                    className="w-full bg-slate-900/50 border border-white/10 rounded-2xl px-8 py-6 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all text-xl font-semibold text-center"
                                    aria-required="true"
                                />
                            </div>

                            {/* Divider */}
                            <div className="relative py-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-white/10"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="px-6 text-sm font-bold text-slate-500 uppercase tracking-wider bg-slate-900/80 rounded-full py-2">Choose an option</span>
                                </div>
                            </div>

                            {/* Two Column Layout for Actions */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Create Room */}
                                <div className="space-y-5">
                                    <div className="text-center space-y-3">
                                        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/10 rounded-2xl mb-2 border border-blue-500/20">
                                            <Plus size={32} className="text-blue-400" />
                                        </div>
                                        <h3 className="text-2xl font-bold">Create Room</h3>
                                        <p className="text-sm text-slate-400 leading-relaxed">Start a new meeting instantly</p>
                                    </div>
                                    <button
                                        onClick={handleCreateRoom}
                                        disabled={!displayName.trim()}
                                        className="w-full relative group overflow-hidden py-6 rounded-2xl font-bold text-lg transition-all transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-2xl"
                                    >
                                        <div className={`absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-600 transition-all ${!displayName.trim() ? 'opacity-40' : 'opacity-100 group-hover:from-blue-600 group-hover:to-blue-500'}`}></div>
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-600 opacity-0 group-hover:opacity-50 blur-xl transition-opacity"></div>
                                        <span className="relative flex items-center justify-center gap-3 text-white">
                                            <Zap size={20} className="fill-current" />
                                            Create Meeting
                                        </span>
                                    </button>
                                </div>

                                {/* Join Room */}
                                <div className="space-y-5">
                                    <div className="text-center space-y-3">
                                        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-500/10 rounded-2xl mb-2 border border-purple-500/20">
                                            <LogIn size={32} className="text-purple-400" />
                                        </div>
                                        <h3 className="text-2xl font-bold">Join Room</h3>
                                        <p className="text-sm text-slate-400 leading-relaxed">Enter an existing meeting ID</p>
                                    </div>
                                    <div className="space-y-4">
                                        <input
                                            type="text"
                                            value={meetingId}
                                            onChange={(e) => setMeetingId(e.target.value)}
                                            placeholder="Meeting ID (e.g. abc-123-xyz)"
                                            className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-6 py-5 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all text-center font-mono tracking-wider text-base"
                                        />
                                        <button
                                            onClick={handleJoinRoom}
                                            disabled={!displayName.trim() || !meetingId.trim()}
                                            className="w-full relative group overflow-hidden py-6 rounded-2xl font-bold text-lg transition-all transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-2xl"
                                        >
                                            <div className={`absolute inset-0 bg-gradient-to-r from-purple-500 to-purple-600 transition-all ${(!displayName.trim() || !meetingId.trim()) ? 'opacity-40' : 'opacity-100 group-hover:from-purple-600 group-hover:to-purple-500'}`}></div>
                                            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-purple-600 opacity-0 group-hover:opacity-50 blur-xl transition-opacity"></div>
                                            <span className="relative flex items-center justify-center gap-3 text-white">
                                                Join Meeting
                                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Privacy Notice */}
                            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-7 flex gap-5 mt-10">
                                <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-400 shrink-0">
                                    <ShieldCheck size={26} />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Local Processing</p>
                                    <p className="text-sm text-slate-400 font-medium leading-relaxed">
                                        Your audio is transcribed on your device. Only text summaries are sent to the cloud.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-8 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                <Check size={14} className="text-emerald-400" />
                                <span>No account required • Free forever</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recent Rooms Sidebar */}
                {recentRooms.length > 0 && (
                    <div className="fixed right-8 top-1/2 -translate-y-1/2 w-72 space-y-4 z-40 hidden xl:block">
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-2 text-[#0E71EB]">
                                <History size={16} />
                                <span className="text-[10px] font-black uppercase tracking-wider">Recent Rooms</span>
                            </div>
                            <button
                                onClick={onClearHistory}
                                className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                                title="Clear all history"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>

                        <div className="space-y-2 max-h-[400px] overflow-y-auto no-scrollbar pr-1">
                            {recentRooms.map((id) => (
                                <button
                                    key={id}
                                    onClick={() => setMeetingId(id)}
                                    className="w-full text-left p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-[#0E71EB]/5 hover:border-[#0E71EB]/30 transition-all group relative overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <ArrowRight size={14} className="text-[#0E71EB]" />
                                    </div>
                                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Meeting ID</p>
                                    <p className="text-xs font-mono text-slate-300 truncate">{id}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <footer className="h-16 border-t border-white/10 px-8 flex items-center justify-center glass-card-strong relative z-10">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">© 2026 MeetSummarizer • Enterprise-Grade Privacy</p>
            </footer>
        </div>
    );
};

export default JoinScreen;
