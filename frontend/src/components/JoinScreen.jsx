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
import ThemeToggle from './ThemeToggle';
import { getProviderConfig, getSelectedModel } from '../config/llmModels';
import { BACKGROUND_BLUR_STATUS, BackgroundBlurProcessor } from '../utils/backgroundBlur';

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
    backendCatalog,
    backendInstallProgress,
    onDownloadModel,
    onUseModel,
    onDeleteModel,
    onBackendPreference,
    onInstallBackend,
    onCancelBackendInstall,
    onRemoveBackend,
    sttModeLabel,
    sttModeDetail,
    nativeSttRunning,
    theme = 'dark',
    onThemeChange,
    backgroundBlurEnabled = false,
    backgroundBlurStatus = BACKGROUND_BLUR_STATUS.OFF,
    onBackgroundBlurChange
}) => {
    const [displayName, setDisplayName] = useState('');
    const [meetingId, setMeetingId] = useState('');
    const [isMuted, setIsMuted] = useState(true);
    const [isVideoOff, setIsVideoOff] = useState(true);
    const [devices, setDevices] = useState({ video: [], audio: [], output: [] });
    const [selectedDevices, setSelectedDevices] = useState({ video: '', audio: '', output: '' });
    const [permissionError, setPermissionError] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [rawPreviewStream, setRawPreviewStream] = useState(null);
    const [previewStream, setPreviewStream] = useState(null);
    const [previewBlurStatus, setPreviewBlurStatus] = useState(BACKGROUND_BLUR_STATUS.OFF);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const previewProcessorRef = useRef(null);
    const previewRequestRef = useRef(0);
    const mediaStateRef = useRef({ isMuted, isVideoOff });
    const summaryProvider = getProviderConfig(llmConfig?.provider);
    const summaryModel = getSelectedModel(llmConfig);
    const effectiveBackgroundBlurStatus = backgroundBlurStatus === BACKGROUND_BLUR_STATUS.OFF
        ? previewBlurStatus
        : backgroundBlurStatus;

    useEffect(() => {
        mediaStateRef.current = { isMuted, isVideoOff };
    }, [isMuted, isVideoOff]);

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = previewStream || rawPreviewStream;
    }, [previewStream, rawPreviewStream]);

    useEffect(() => {
        const requestId = ++previewRequestRef.current;
        previewProcessorRef.current?.dispose();
        previewProcessorRef.current = null;

        const rawVideoTrack = rawPreviewStream?.getVideoTracks?.().find((track) => track.readyState === 'live');
        if (!backgroundBlurEnabled || isVideoOff || !rawVideoTrack) {
            const frameId = requestAnimationFrame(() => {
                setPreviewStream(rawPreviewStream);
                setPreviewBlurStatus(BACKGROUND_BLUR_STATUS.OFF);
            });
            return () => cancelAnimationFrame(frameId);
        }

        const processor = new BackgroundBlurProcessor({
            onStatus: (status) => {
                if (previewRequestRef.current === requestId) setPreviewBlurStatus(status);
            },
            onFailure: () => {
                if (previewRequestRef.current !== requestId) return;
                setPreviewStream(rawPreviewStream);
                setPreviewBlurStatus(BACKGROUND_BLUR_STATUS.UNAVAILABLE);
                processor.dispose();
            }
        });
        processor.start(new MediaStream([rawVideoTrack]))
            .then((stream) => {
                if (previewRequestRef.current !== requestId) {
                    processor.dispose();
                    return;
                }
                previewProcessorRef.current = processor;
                setPreviewStream(stream);
                setPreviewBlurStatus(BACKGROUND_BLUR_STATUS.ACTIVE);
            })
            .catch((error) => {
                processor.dispose();
                console.warn('Background blur preview is unavailable:', error);
                if (previewRequestRef.current === requestId) {
                    setPreviewStream(rawPreviewStream);
                    setPreviewBlurStatus(BACKGROUND_BLUR_STATUS.UNAVAILABLE);
                }
            });

        return () => {
            previewRequestRef.current += 1;
            processor.dispose();
        };
    }, [backgroundBlurEnabled, isVideoOff, rawPreviewStream]);

    useEffect(() => {
        let cancelled = false;
        const initMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                setRawPreviewStream(stream);

                if (mediaStateRef.current.isMuted) stream.getAudioTracks().forEach((track) => { track.enabled = false; });
                if (mediaStateRef.current.isVideoOff) stream.getVideoTracks().forEach((track) => track.stop());

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
            cancelled = true;
            previewProcessorRef.current?.dispose();
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
            setRawPreviewStream(newStream);
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
                    setRawPreviewStream(new MediaStream(streamRef.current.getTracks()));
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
                    setRawPreviewStream(new MediaStream(streamRef.current.getTracks()));
                }
                setIsVideoOff(false);
            } catch (err) {
                console.error('Error starting video:', err);
            }
        } else {
            streamRef.current?.getVideoTracks().forEach((track) => track.stop());
            setRawPreviewStream(new MediaStream(streamRef.current?.getTracks() || []));
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

    const runtimeLabel = runtimeConfig?.appMode?.startsWith('desktop') ? 'Desktop app' : 'Browser mode';
    const sttLabel = sttStatus?.nativeReady ? 'Native STT' : 'WebGPU STT';

    return (
        <div className="theme-shell join-shell h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.18),transparent_34%),#090b12] text-white selection:bg-blue-500/30 light:bg-slate-100 light:text-slate-900">
            <header className="relative z-10 flex h-14 items-center justify-between border-b border-white/10 bg-slate-950/55 px-4 backdrop-blur-xl sm:px-6 light:bg-white/90 light:border-slate-200">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 shadow-lg shadow-blue-500/20">
                        <Video size={19} />
                    </div>
                    <div>
                        <p className="text-sm font-black tracking-tight">MeetSummarizer</p>
                        <p className="hidden text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500 light:text-slate-600 sm:block">Private meeting intelligence</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-800">
                        <ShieldCheck size={13} /> Audio local
                    </div>
                    <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
                </div>
            </header>

            <main className="relative z-10 mx-auto grid h-[calc(100vh-3.5rem)] w-full max-w-7xl gap-4 overflow-hidden px-4 py-4 lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1.05fr)_400px]">
                <section className="flex min-h-0 flex-col gap-3">
                    <div className="min-h-0 flex-1 rounded-3xl border border-white/10 bg-white/[0.04] p-2 shadow-2xl shadow-black/30 backdrop-blur-xl light:border-slate-200 light:bg-white light:shadow-slate-300/40">
                        <div className="media-surface relative h-full min-h-[260px] max-h-[calc(100vh-11rem)] overflow-hidden rounded-[1.35rem] bg-slate-950">
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

                            <div className="media-controls absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-black/40 p-1.5 backdrop-blur-xl">
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

                    <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-bold text-slate-400 backdrop-blur-xl light:border-slate-200 light:bg-white light:text-slate-700">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-300 light:text-emerald-700" /> Local audio</span>
                            <span className="inline-flex items-center gap-1.5"><Zap size={14} className="text-blue-300 light:text-blue-700" /> {sttLabel}</span>
                            <span className="inline-flex items-center gap-1.5"><MonitorCog size={14} className="text-violet-300 light:text-violet-700" /> {runtimeLabel}</span>
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-slate-950/75 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl light:border-slate-200 light:bg-white light:shadow-slate-300/40">
                    <div className="shrink-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-[10px] font-bold text-blue-200 light:border-blue-200 light:bg-blue-50 light:text-blue-800">
                            <Sparkles size={13} /> AI meeting notes
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-white light:text-slate-950">Join with clarity.</h1>
                        <p className="mt-2 text-sm leading-5 text-slate-400 light:text-slate-600">Live captions and action-focused summaries for every meeting.</p>
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
                                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white placeholder:text-slate-600 focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20 light:border-slate-500 light:bg-slate-50 light:text-slate-900 light:placeholder:text-slate-500"
                                aria-required="true"
                            />
                        </div>

                        <button
                            onClick={handleCreateRoom}
                            disabled={!displayName.trim()}
                            className="group flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 light:from-blue-700 light:to-violet-800 px-4 py-3.5 text-left text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <span className="flex items-center gap-2"><Plus size={18} /> Create new meeting</span>
                            <ArrowRight size={18} className="transition group-hover:translate-x-1" />
                        </button>

                        <div className="flex items-center gap-3 py-0.5">
                            <div className="h-px flex-1 bg-white/10 light:bg-slate-200" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 light:text-slate-500">or</span>
                            <div className="h-px flex-1 bg-white/10 light:bg-slate-200" />
                        </div>

                        <div className="space-y-2">
                            <FieldLabel icon={LogIn}>Meeting ID</FieldLabel>
                            <input
                                type="text"
                                value={meetingId}
                                onChange={(e) => setMeetingId(e.target.value)}
                                placeholder="abc-123-xyz"
                                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center font-mono text-sm tracking-wider text-white placeholder:text-slate-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/20 light:border-slate-500 light:bg-slate-50 light:text-slate-900 light:placeholder:text-slate-500"
                            />
                            <button
                                onClick={handleJoinRoom}
                                disabled={!displayName.trim() || !meetingId.trim()}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-black text-white transition hover:bg-white/[0.1] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 light:border-slate-300 light:bg-slate-100 light:text-slate-900 light:hover:bg-slate-200"
                            >
                                Join meeting <ArrowRight size={16} />
                            </button>
                        </div>

                        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-xs font-semibold text-emerald-100/80 light:border-emerald-200 light:bg-emerald-50 light:text-emerald-800">
                            <CheckCircle2 size={15} className="shrink-0 text-emerald-300 light:text-emerald-700" />
                            <span>Audio local · summaries use {summaryProvider.label} · {summaryModel.label}</span>
                        </div>
                    </div>

                    <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 light:border-slate-200 light:bg-slate-50">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 light:text-slate-600">
                                <History size={14} /> Recent
                            </div>
                            {recentRooms.length > 0 && (
                                <button
                                    onClick={onClearHistory}
                                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 light:hover:bg-red-50 light:hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                                    title="Clear room history"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>

                        {recentRooms.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-white/10 p-3 text-xs leading-5 text-slate-500 light:border-slate-300 light:text-slate-600">Recent rooms appear here.</p>
                        ) : (
                            <div className="space-y-1.5 overflow-hidden">
                                {recentRooms.slice(0, 4).map((id) => (
                                    <button
                                        key={id}
                                        onClick={() => setMeetingId(id)}
                                        className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-left transition hover:border-blue-400/40 hover:bg-blue-500/10 light:border-slate-200 light:bg-white light:hover:border-blue-300 light:hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                                    >
                                        <span className="truncate font-mono text-xs text-slate-300 light:text-slate-700">{id}</span>
                                        <ArrowRight size={14} className="text-slate-600 transition group-hover:translate-x-1 group-hover:text-blue-300 light:text-slate-500 light:group-hover:text-blue-700" />
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
                    backendCatalog={backendCatalog}
                    backendInstallProgress={backendInstallProgress}
                    onDownloadModel={onDownloadModel}
                    onUseModel={onUseModel}
                    onDeleteModel={onDeleteModel}
                    onBackendPreference={onBackendPreference}
                    onInstallBackend={onInstallBackend}
                    onCancelBackendInstall={onCancelBackendInstall}
                    onRemoveBackend={onRemoveBackend}
                    sttModeLabel={sttModeLabel}
                    sttModeDetail={sttModeDetail}
                    nativeSttRunning={nativeSttRunning}
                    theme={theme}
                    onThemeChange={onThemeChange}
                    backgroundBlurEnabled={backgroundBlurEnabled}
                    backgroundBlurStatus={effectiveBackgroundBlurStatus}
                    onBackgroundBlurChange={onBackgroundBlurChange}
                    llmConfig={llmConfig}
                    setLlmConfig={setLlmConfig}
                />
            )}

        </div>
    );
};

export default React.memo(JoinScreen);
