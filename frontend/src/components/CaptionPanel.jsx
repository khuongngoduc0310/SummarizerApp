import React, { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

const CaptionPanel = ({ captions, participantNames = {} }) => {
    const bottomRef = useRef(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [captions]);

    const getSpeakerName = (id) => {
        return participantNames[id] || id || 'Unknown';
    };

    const formatTime = (seconds) => {
        if (!seconds && seconds !== 0) return '';
        const date = new Date(seconds * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div className="flex flex-col h-full">
            <div className="space-y-4">
                {captions.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center space-y-3 opacity-30">
                        <MessageSquare size={32} />
                        <p className="text-xs font-medium">Waiting for conversation...</p>
                    </div>
                ) : (
                    captions.map((cap, i) => (
                        <div key={i} className="space-y-1 group animate-in slide-in-from-right-2 duration-300">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-black uppercase text-[#0E71EB] tracking-wider">{getSpeakerName(cap.speakerId)}</span>
                                <span className="text-[9px] text-gray-600 font-bold">{formatTime(cap.start)}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-300 leading-relaxed bg-white/5 p-3 rounded-2xl rounded-tl-none border border-white/5 group-hover:bg-white/10 transition-colors">
                                {cap.text}
                            </p>
                        </div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};

export default CaptionPanel;
