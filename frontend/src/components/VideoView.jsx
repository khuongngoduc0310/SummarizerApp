import { CameraOff, MicOff, Pin, Shield, User } from 'lucide-react';
import { useEffect, useRef } from 'react';

const initialsFor = (name = 'Guest') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'G';

const VideoView = ({
    stream,
    isMuted = true,
    isVideoOff = true,
    displayName,
    isLocal = false,
    isHost = false,
    pinned = false,
    onClick,
    className = ''
}) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div
            onClick={onClick}
            className={`relative overflow-hidden rounded-[2rem] border bg-slate-950 shadow-2xl transition duration-300 ${!pinned ? 'aspect-video' : 'h-full w-full'} ${pinned ? 'border-blue-400/25 shadow-blue-950/20' : 'border-white/10'} ${onClick ? 'cursor-pointer hover:border-blue-300/35 hover:brightness-110' : ''} ${className}`}
        >
            <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-black/20 via-transparent to-black/55" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.14),transparent_35%)]" />

            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`h-full w-full transition duration-500 ${pinned ? 'object-contain' : 'object-cover'} ${isLocal ? 'mirror' : ''} ${isVideoOff ? 'opacity-0 scale-105 blur-xl' : 'opacity-100 scale-100 blur-0'}`}
            />

            <div className="absolute right-4 top-4 z-20 flex flex-wrap justify-end gap-2">
                {isHost && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-500/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-xl">
                        <Shield size={12} fill="currentColor" /> Host
                    </span>
                )}
                {pinned && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-xl">
                        <Pin size={12} fill="currentColor" className="text-blue-200" /> Pinned
                    </span>
                )}
            </div>

            {isVideoOff && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
                    <div className="relative mb-5">
                        {!isMuted && <div className="absolute inset-0 scale-125 rounded-full bg-emerald-400/10 blur-xl" />}
                        <div className="relative flex size-24 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 shadow-2xl sm:size-28">
                            {displayName ? <span className="text-3xl font-black tracking-tight">{initialsFor(displayName)}</span> : <User size={42} />}
                        </div>
                    </div>
                    <p className="text-base font-black text-white">{displayName || 'Guest'}{isLocal ? ' (you)' : ''}</p>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 backdrop-blur-md">
                        <CameraOff size={12} /> Camera off
                    </div>
                </div>
            )}

            <div className="absolute bottom-4 left-4 right-4 z-20 flex items-end justify-between gap-3">
                <div className="min-w-0 rounded-2xl border border-white/10 bg-black/45 px-4 py-2.5 backdrop-blur-2xl">
                    <div className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-full ${isMuted ? 'bg-red-400' : 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.5)]'}`} />
                        <span className="truncate text-xs font-black uppercase tracking-[0.14em] text-white">
                            {displayName || 'Guest'} {isLocal && <span className="text-blue-300">(you)</span>}
                        </span>
                    </div>
                </div>

                {isMuted && (
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/15 text-red-300 backdrop-blur-xl">
                        <MicOff size={18} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoView;
