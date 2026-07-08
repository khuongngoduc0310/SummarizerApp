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
    const compact = !pinned;

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div
            onClick={onClick}
            className={`relative isolate max-h-full max-w-full overflow-hidden rounded-[2rem] border bg-slate-950 shadow-2xl [contain:layout_paint] transition duration-300 ${!pinned ? 'aspect-video' : 'h-full w-full'} ${pinned ? 'border-blue-400/25 shadow-blue-950/20' : 'border-white/10'} ${onClick ? 'cursor-pointer hover:border-blue-300/35 hover:brightness-110' : ''} ${className}`}
        >
            <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-gradient-to-b from-black/20 via-transparent to-black/55" />
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.14),transparent_35%)]" />

            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`block h-full w-full rounded-[inherit] transition duration-500 ${pinned ? 'object-contain' : 'object-cover'} ${isLocal ? 'mirror' : ''} ${isVideoOff ? 'opacity-0 scale-105 blur-xl' : 'opacity-100 scale-100 blur-0'}`}
            />

            <div className={`absolute z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-2 ${compact ? 'right-3 top-3' : 'right-4 top-4'}`}>
                {isHost && (
                    <span className={`inline-flex items-center gap-1.5 rounded-full border border-blue-300/25 bg-blue-500/75 font-black uppercase tracking-[0.16em] text-white backdrop-blur-xl ${compact ? 'px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[10px]'}`}>
                        <Shield size={compact ? 10 : 12} fill="currentColor" /> Host
                    </span>
                )}
                {pinned && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-xl">
                        <Pin size={12} fill="currentColor" className="text-blue-200" /> Pinned
                    </span>
                )}
            </div>

            {isVideoOff && (
                <div className={`absolute inset-0 z-10 flex min-h-0 flex-col items-center justify-center overflow-hidden text-center ${compact ? 'px-4 py-9' : 'px-6 py-16'}`}>
                    <div className={`relative ${compact ? '' : 'mb-5'}`}>
                        {!isMuted && <div className="absolute inset-0 scale-125 rounded-full bg-emerald-400/10 blur-xl" />}
                        <div className={`relative flex items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 shadow-2xl ${compact ? 'size-14' : 'size-24 sm:size-28'}`}>
                            {displayName ? <span className={`${compact ? 'text-lg' : 'text-3xl'} font-black tracking-tight`}>{initialsFor(displayName)}</span> : <User size={compact ? 24 : 42} />}
                        </div>
                    </div>
                    {!compact && (
                        <>
                            <p className="max-w-full truncate text-base font-black text-white">{displayName || 'Guest'}{isLocal ? ' (you)' : ''}</p>
                            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 backdrop-blur-md">
                                <CameraOff size={12} /> Camera off
                            </div>
                        </>
                    )}
                </div>
            )}

            <div className={`absolute z-20 flex items-end justify-between gap-2 ${compact ? 'bottom-3 left-3 right-3' : 'bottom-4 left-4 right-4'}`}>
                <div className={`min-w-0 max-w-[calc(100%-3rem)] rounded-2xl border border-white/10 bg-black/45 backdrop-blur-2xl ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2.5'}`}>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className={`shrink-0 rounded-full ${compact ? 'size-2' : 'size-2.5'} ${isMuted ? 'bg-red-400' : 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.5)]'}`} />
                        <span className={`min-w-0 truncate font-black uppercase tracking-[0.14em] text-white ${compact ? 'text-[10px]' : 'text-xs'}`}>
                            {displayName || 'Guest'} {isLocal && <span className="text-blue-300">(you)</span>}
                        </span>
                    </div>
                </div>

                {isMuted && (
                    <div className={`flex shrink-0 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/15 text-red-300 backdrop-blur-xl ${compact ? 'size-8' : 'size-11'}`}>
                        <MicOff size={compact ? 14 : 18} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default VideoView;
