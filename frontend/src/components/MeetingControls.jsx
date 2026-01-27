import React from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Settings, Shield } from 'lucide-react';

const MeetingControls = ({ isMuted, isVideoOff, onToggleMute, onToggleVideo, onLeave, onSettingsClick }) => {
    return (
        <div className="flex items-center px-4 py-1.5 gap-2">
            <div className="flex flex-col items-center group">
                <button
                    onClick={onToggleMute}
                    className={`p-3 rounded-xl transition-all flex items-center justify-center ${isMuted ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-200 hover:bg-white/5'
                        }`}
                >
                    {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
                </button>
                <span className="text-[10px] font-bold text-gray-500 mt-1 select-none">Mute</span>
            </div>

            <div className="flex flex-col items-center">
                <button
                    onClick={onToggleVideo}
                    className={`p-3 rounded-xl transition-all flex items-center justify-center ${isVideoOff ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-gray-200 hover:bg-white/5'
                        }`}
                >
                    {isVideoOff ? <VideoOff size={22} /> : <VideoIcon size={22} />}
                </button>
                <span className="text-[10px] font-bold text-gray-500 mt-1 select-none">Video</span>
            </div>

            <div className="w-px h-8 bg-white/10 mx-2 self-start mt-3"></div>

            <div className="flex flex-col items-center">
                <button
                    onClick={onSettingsClick}
                    className="p-3 text-gray-200 hover:bg-white/5 rounded-xl transition-all"
                >
                    <Settings size={22} />
                </button>
                <span className="text-[10px] font-bold text-gray-500 mt-1 select-none">Settings</span>
            </div>

            <div className="flex flex-col items-center">
                <button
                    onClick={onLeave}
                    className="p-3 text-[#ff4d4d] hover:bg-red-500/10 rounded-xl transition-all"
                >
                    <PhoneOff size={22} />
                </button>
                <span className="text-[10px] font-bold text-red-500/80 mt-1 select-none">End</span>
            </div>
        </div>
    );
};

export default MeetingControls;
