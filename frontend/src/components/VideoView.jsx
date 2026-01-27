import { MicOff, User, CameraOff, Shield, Pin } from 'lucide-react';
import { useRef, useEffect } from 'react';

const VideoView = ({ stream, isMuted = true, isVideoOff = true, displayName, isLocal = false, isHost = false, pinned = false, onClick, className = "" }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div
            onClick={onClick}
            className={`
                relative bg-[#0d0d0d] rounded-[2rem] border transition-all duration-700 ease-out overflow-hidden group
                ${!pinned ? 'aspect-video' : 'w-full h-full'}
                ${isMuted ? 'animate-red-pulse' : 'border-white/5 shadow-2xl'}
                animate-enter
                ${isHost ? 'ring-2 ring-blue-500/20' : ''}
                ${pinned ? 'ring-2 ring-blue-500/40 shadow-[0_0_50px_rgba(59,130,246,0.1)]' : ''}
                ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-white/10' : ''}
                ${className}
            `}
        >
            {/* Background Noise Texture */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay scale-150"></div>

            {/* Gradient Glow */}
            <div className={`
                absolute inset-0 transition-opacity duration-1000
                ${isMuted ? 'bg-gradient-to-br from-red-500/10 to-transparent' : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10'}
                ${isVideoOff ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
            `}></div>

            {/* Video Element */}
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isLocal}
                className={`
                    w-full h-full transition-all duration-1000
                    ${pinned ? 'object-contain' : 'object-cover'}
                    ${isLocal ? 'mirror' : ''}
                    ${isVideoOff ? 'opacity-0 scale-110 blur-3xl grayscale' : 'opacity-100 scale-100 blur-0 grayscale-0'}
                `}
            />

            {/* Top Right Badges */}
            <div className="absolute top-6 right-6 z-30 flex flex-col gap-2 transition-transform duration-500 group-hover:-translate-y-1">
                {isHost && (
                    <div className="flex items-center gap-2 bg-blue-600/90 backdrop-blur-xl px-3 py-1.5 rounded-full border border-blue-400/30 shadow-lg animate-fade-in">
                        <Shield size={14} className="text-white" fill="white" />
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">Host</span>
                    </div>
                )}
                {pinned && (
                    <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-3 py-1.5 rounded-full border border-white/20 shadow-lg animate-fade-in">
                        <Pin size={12} className="text-blue-400" fill="currentColor" />
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">Pinned</span>
                    </div>
                )}
            </div>

            {/* Camera Off Placeholder */}
            {isVideoOff && (
                <div className="absolute inset-0 flex flex-col items-center justify-center animate-fade-in">
                    <div className="relative">
                        {/* Animated Rings */}
                        <div className="absolute inset-0 rounded-full bg-white/5 animate-ping scale-150 opacity-10"></div>
                        <div className="absolute inset-0 rounded-full border border-white/5 animate-rotate-slow scale-125 opacity-20"></div>

                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#1a1a1a] to-black border border-white/10 flex items-center justify-center text-gray-500 shadow-2xl relative z-10 transition-transform duration-500 group-hover:scale-110">
                            <User size={44} strokeWidth={1.5} className={`transition-colors duration-500 ${isMuted ? 'text-red-500/40' : 'text-gray-400'}`} />
                        </div>
                    </div>

                    <div className="mt-8 flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5 backdrop-blur-md">
                            <CameraOff size={12} className="text-gray-500" />
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Video Paused</span>
                        </div>
                        {isMuted && (
                            <span className="text-[9px] font-bold text-red-500/60 uppercase tracking-widest animate-pulse">Microphone Muted</span>
                        )}
                    </div>
                </div>
            )}

            {/* Muted Vignette Overlay */}
            <div className={`
                absolute inset-0 pointer-events-none transition-opacity duration-700
                ${isMuted ? 'opacity-100 shadow-[inset_0_0_120px_rgba(239,68,68,0.1)]' : 'opacity-0'}
            `}></div>

            {/* Name Tag (Premium UI) */}
            <div className={`
                absolute bottom-6 left-6 right-6 flex items-center justify-between
                transition-transform duration-500 ${isVideoOff ? 'translate-y-0' : 'translate-y-2 group-hover:translate-y-0'}
            `}>
                <div className="flex items-center gap-3 bg-black/40 backdrop-blur-2xl px-5 py-2.5 rounded-2xl border border-white/10 shadow-2xl group-hover:bg-black/60 transition-all duration-300">
                    <div className="relative flex items-center justify-center">
                        <div className={`w-2.5 h-2.5 rounded-full ${isLocal ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'} ${!isVideoOff && !isMuted ? 'animate-pulse' : ''}`}></div>
                        {!isMuted && !isVideoOff && (
                            <div className={`absolute inset-0 rounded-full ${isLocal ? 'bg-blue-500' : 'bg-emerald-500'} animate-ping opacity-20 scale-150`}></div>
                        )}
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-white tracking-wide uppercase flex items-center gap-2">
                            {displayName} {isLocal && <span className="text-[9px] text-[#0E71EB] opacity-60">(YOU)</span>}
                        </span>
                    </div>
                </div>

                {/* Status Indicator */}
                <div className="flex gap-2">
                    {isMuted && (
                        <div className="w-10 h-10 bg-red-500/10 backdrop-blur-xl rounded-xl border border-red-500/20 flex items-center justify-center text-red-500 shadow-xl animate-fade-in translate-y-[-4px]">
                            <MicOff size={18} strokeWidth={2.5} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VideoView;
