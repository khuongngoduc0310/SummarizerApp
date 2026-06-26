import React from 'react';
import { Mic, MicOff, PhoneOff, Settings, Video as VideoIcon, VideoOff } from 'lucide-react';

const ControlButton = ({ active, danger, label, onClick, children }) => (
    <div className="flex flex-col items-center gap-1.5">
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`flex size-12 items-center justify-center rounded-2xl border transition hover:-translate-y-0.5 active:translate-y-0 sm:size-14 ${danger
                ? 'border-red-400/30 bg-red-500 text-white shadow-lg shadow-red-500/20 hover:bg-red-400'
                : active
                    ? 'border-red-400/25 bg-red-500/12 text-red-300 hover:bg-red-500/18'
                    : 'border-white/10 bg-white/[0.07] text-slate-100 hover:bg-white/[0.12] hover:text-white'
            }`}
        >
            {children}
        </button>
        <span className={`select-none text-[10px] font-black uppercase tracking-[0.18em] ${danger ? 'text-red-300' : 'text-slate-500'}`}>
            {label}
        </span>
    </div>
);

const MeetingControls = ({ isMuted, isVideoOff, onToggleMute, onToggleVideo, onLeave, onSettingsClick }) => {
    return (
        <div className="flex items-center gap-2 rounded-[1.75rem] border border-white/10 bg-slate-950/75 p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:gap-3">
            <ControlButton active={isMuted} label={isMuted ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
                {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </ControlButton>

            <ControlButton active={isVideoOff} label={isVideoOff ? 'Camera' : 'Video'} onClick={onToggleVideo}>
                {isVideoOff ? <VideoOff size={22} /> : <VideoIcon size={22} />}
            </ControlButton>

            <div className="mx-1 h-10 w-px bg-white/10" />

            <ControlButton label="Settings" onClick={onSettingsClick}>
                <Settings size={22} />
            </ControlButton>

            <ControlButton danger label="Leave" onClick={onLeave}>
                <PhoneOff size={22} />
            </ControlButton>
        </div>
    );
};

export default MeetingControls;
