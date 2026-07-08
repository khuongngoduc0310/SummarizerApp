import React, { useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    History,
    LogIn,
    Mic,
    MicOff,
    MonitorCog,
    Plus,
    Settings,
    ShieldCheck,
    Sparkles,
    Trash2,
    User,
    Video,
    VideoOff,
    Zap
} from 'lucide-react';
import SettingsModal from './SettingsModal';

const providerLabels = {
    openai: 'OpenAI GPT-4o',
    anthropic: 'Claude 3.5',
    deepseek: 'DeepSeek V3'
};

const FieldLabel = ({ icon: Icon, children }) => (
    <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        {Icon && <Icon size={13} />}
        {children}
    </label>
);

const JoinScreen = ({
    onCreateMeeting,
    onJoinMeeting,
    recentRooms = [],
    onClearHistory,
    llmConfig,
    setLlmConfig,
    runtimeConfig,
    sttConfig,
    setSttConfig,
    sttStatus,
    setSttStatus,
    modelCatalog,
    modelDownloadProgress,
    onDownloadModel,
    onUseModel,
    onDeleteModel,
    sttModeLabel,
    sttModeDetail,
    nativeSttRunning
}) => {
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
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                streamRef.current = stream;
                if (videoRef.current) videoRef.current.srcObject = stream;

                if (isMuted) stream.getAudioTracks().forEach((track) => { track.enabled = false; });
                if (isVideoOff) stream.getVideoTracks().forEach((track) => track.stop());

                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const organized = {
                    video: allDevices.filter((device) => device.kind === 'videoinput'),
                    audio: allDevices.filter((device) => device.kind === 'audioinput'),
                    output: allDevices.filter((device) => device.kind === 'audiooutput')
                };
                setDevices(organized);
                setSelectedDevices({
                    video: organized.video[0]?.deviceId || '',
                    audio: organized.audio[0]?.deviceId || '',
                    output: organized.output[0]?.deviceId || ''
                });
            } catch (err) {
                console.error('Permission error:', err);
                setPermissionError('Camera or microphone access was denied. Check browser permissions to preview devices.');
                setIsVideoOff(true);
                setIsMuted(true);
            }
        };

        initMedia();

        return () => {
            streamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    const handleDeviceChange = async (kind, deviceId) => {
        setSelectedDevices((prev) => ({ ...prev, [kind]: deviceId }));

        if (kind !== 'video' && kind !== 'audio') return;
        streamRef.current?.getTracks().forEach((track) => track.stop());

        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: kind === 'video' ? { deviceId: { exact: deviceId } } : !isVideoOff,
                audio: kind === 'audio' ? { deviceId: { exact: deviceId } } : !isMuted
            });
            streamRef.current = newStream;
            if (videoRef.current) videoRef.current.srcObject = newStream;
        } catch (err) {
            console.error('Device switch error:', err);
        }
    };

    const toggleMute = async () => {
        if (isMuted) {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    audio: selectedDevices.audio ? { deviceId: { exact: selectedDevices.audio } } : true
                });
                const audioTrack = newStream.getAudioTracks()[0];
                if (streamRef.current) {
                    streamRef.current.getAudioTracks().forEach((track) => {
                        track.stop();
                        streamRef.current.removeTrack(track);
                    });
                    streamRef.current.addTrack(audioTrack);
                }
                setIsMuted(false);
            } catch (err) {
                console.error('Error starting audio:', err);
            }
        } else {
            streamRef.current?.getAudioTracks().forEach((track) => track.stop());
            setIsMuted(true);
        }
    };

    const toggleVideo = async () => {
        if (isVideoOff) {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: selectedDevices.video ? { deviceId: { exact: selectedDevices.video } } : true
                });
                const videoTrack = newStream.getVideoTracks()[0];
                if (streamRef.current) {
                    streamRef.current.getVideoTracks().forEach((track) => {
                        track.stop();
                        streamRef.current.removeTrack(track);
                    });
                    streamRef.current.addTrack(videoTrack);
                    if (videoRef.current) videoRef.current.srcObject = streamRef.current;
                }
                setIsVideoOff(false);
            } catch (err) {
                console.error('Error starting video:', err);
            }
        } else {
            streamRef.current?.getVideoTracks().forEach((track) => track.stop());
            setIsVideoOff(true);
        }
    };

    const handleCreateRoom = () => {
        if (!displayName.trim()) return;
        onCreateMeeting({ displayName, isMuted, isVideoOff, selectedDevices });
    };

    const handleJoinRoom = () => {
        if (!displayName.trim() || !meetingId.trim()) return;
        onJoinMeeting({ meetingId, displayName, isMuted, isVideoOff, selectedDevices });
    };

    const runtimeLabel = runtimeConfig?.appMode === 'desktop' ? 'Desktop app' : 'Browser mode';
    const sttLabel = runtimeConfig?.features?.nativeStt ? 'Native STT' : 'WebGPU STT';

    return (
        <div className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.18),transparent_34%),#090b12] text-white selection:bg-blue-500/30">
            <header className="relative z-10 flex h-14 items-center justify-between border-b border-white/10 bg-slate-950/55 px-4 backdrop-blur-xl sm:px-6">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-blue-500/20">
                        <Video size={19} />
                    </div>
                    <div>
                        <p className="text-sm font-black tracking-tight">MeetSummarizer</p>
                        <p className="hidden text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500 sm:block">Private meeting intelligence</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300">
                    <ShieldCheck size={13} /> Audio local
                </div>
            </header>

            <main className="relative z-10 mx-auto grid h-[calc(100vh-3.5rem)] w-full max-w-7xl gap-4 overflow-hidden px-4 py-4 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1.05fr)_400px]">
                <section className="flex min-h-0 flex-col gap-3">
                    <div className="min-h-0 flex-1 rounded-3xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl shadow-black/30 backdrop-blur-xl">
                        <div className="relative h-full min-h-[260px] max-h-[calc(100vh-11rem)] overflow-hidden rounded-[1.35rem] bg-slate-950">
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className={`mirror h-full w-full object-cover transition-opacity duration-500 ${isVideoOff || permissionError ? 'opacity-0' : 'opacity-100'}`}
                                aria-label="Camera preview"
                            />

                            {(isVideoOff || permissionError) && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(30,41,59,0.95),#020617)] px-5 text-center">
                                    <div className="mb-3 flex size-20 items-center justify-center rounded-full border border-white/10 bg-white/5 shadow-2xl">
                                        <User size={38} className="text-slate-500" />
                                    </div>
                                    <p className="text-sm font-bold text-slate-200">Camera preview is off</p>
                                    {permissionError && (
                                        <div className="mt-3 flex max-w-md gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-left text-xs leading-5 text-amber-100">
                                            <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-300" />
                                            <span>{permissionError}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-bold text-slate-200 backdrop-blur-md">Preview</span>
                                {isMuted && <span className="rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-bold text-white">Muted</span>}
                                {isVideoOff && <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-bold text-white">Camera off</span>}
                            </div>

                            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-xl">
                                <button
                                    onClick={toggleMute}
                                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                                    className={`flex size-11 items-center justify-center rounded-xl transition hover:scale-105 active:scale-95 ${isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                >
                                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                                </button>
                                <button
                                    onClick={toggleVideo}
                                    aria-label={isVideoOff ? 'Start camera' : 'Stop camera'}
                                    className={`flex size-11 items-center justify-center rounded-xl transition hover:scale-105 active:scale-95 ${isVideoOff ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                                >
                                    {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
                                </button>
                                <button
                                    onClick={() => setShowSettings(true)}
                                    aria-label="Open device and AI settings"
                                    className="flex size-11 items-center justify-center rounded-xl bg-white/10 text-white transition hover:scale-105 hover:bg-white/20 active:scale-95"
                                >
                                    <Settings size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-bold text-slate-400 backdrop-blur-xl">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-300" /> Local audio</span>
                            <span className="inline-flex items-center gap-1.5"><Zap size={14} className="text-blue-300" /> {sttLabel}</span>
                            <span className="inline-flex items-center gap-1.5"><MonitorCog size={14} className="text-violet-300" /> {runtimeLabel}</span>
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-slate-950/75 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
                    <div className="shrink-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-[10px] font-bold text-blue-200">
                            <Sparkles size={13} /> AI meeting notes
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-white">Join with clarity.</h1>
                        <p className="mt-2 text-sm leading-5 text-slate-400">Live captions and action-focused summaries for every meeting.</p>
                    </div>

                    <div className="mt-4 shrink-0 space-y-3">
                        <div className="space-y-2">
                            <FieldLabel icon={User}>Your name</FieldLabel>
                            <input
                                id="display-name"
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder="e.g. Alex Johnson"
                                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white placeholder:text-slate-600 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20"
                                aria-required="true"
                            />
                        </div>

                        <button
                            onClick={handleCreateRoom}
                            disabled={!displayName.trim()}
                            className="group flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-3.5 text-left text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <span className="flex items-center gap-2"><Plus size={18} /> Create new meeting</span>
                            <ArrowRight size={18} className="transition group-hover:translate-x-1" />
                        </button>

                        <div className="flex items-center gap-3 py-0.5">
                            <div className="h-px flex-1 bg-white/10" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">or</span>
                            <div className="h-px flex-1 bg-white/10" />
                        </div>

                        <div className="space-y-2">
                            <FieldLabel icon={LogIn}>Meeting ID</FieldLabel>
                            <input
                                type="text"
                                value={meetingId}
                                onChange={(e) => setMeetingId(e.target.value)}
                                placeholder="abc-123-xyz"
                                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center font-mono text-sm tracking-wider text-white placeholder:text-slate-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/20"
                            />
                            <button
                                onClick={handleJoinRoom}
                                disabled={!displayName.trim() || !meetingId.trim()}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.1] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Join meeting <ArrowRight size={16} />
                            </button>
                        </div>

                        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-xs font-semibold text-emerald-100/80">
                            <CheckCircle2 size={15} className="shrink-0 text-emerald-300" />
                            <span>Audio local · summaries use {providerLabels[llmConfig?.provider] || 'selected AI'}</span>
                        </div>
                    </div>

                    <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                <History size={14} /> Recent
                            </div>
                            {recentRooms.length > 0 && (
                                <button
                                    onClick={onClearHistory}
                                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                                    title="Clear room history"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>

                        {recentRooms.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-white/10 p-3 text-xs leading-5 text-slate-500">Recent rooms appear here.</p>
                        ) : (
                            <div className="space-y-1.5 overflow-hidden">
                                {recentRooms.slice(0, 4).map((id) => (
                                    <button
                                        key={id}
                                        onClick={() => setMeetingId(id)}
                                        className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-left transition hover:border-blue-400/40 hover:bg-blue-500/10"
                                    >
                                        <span className="truncate font-mono text-xs text-slate-300">{id}</span>
                                        <ArrowRight size={14} className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-blue-300" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>
            </main>

            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    devices={devices}
                    selectedDevices={selectedDevices}
                    onDeviceChange={handleDeviceChange}
                    sttConfig={sttConfig}
                    setSttConfig={setSttConfig}
                    sttStatus={sttStatus}
                    setSttStatus={setSttStatus}
                    modelCatalog={modelCatalog}
                    modelDownloadProgress={modelDownloadProgress}
                    onDownloadModel={onDownloadModel}
                    onUseModel={onUseModel}
                    onDeleteModel={onDeleteModel}
                    sttModeLabel={sttModeLabel}
                    sttModeDetail={sttModeDetail}
                    nativeSttRunning={nativeSttRunning}
                    llmConfig={llmConfig}
                    setLlmConfig={setLlmConfig}
                />
            )}

        </div>
    );
};

export default JoinScreen;
