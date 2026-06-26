import React, { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';

const CaptionPanel = ({ captions, participantNames = {} }) => {
    const bottomRef = useRef(null);
    const visibleCaptions = captions.slice(-8);
    const hiddenCount = Math.max(0, captions.length - visibleCaptions.length);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [captions]);

    const getSpeakerName = (id) => participantNames[id] || id || 'Unknown';

    const formatTime = (seconds) => {
        if (!seconds && seconds !== 0) return '';
        const date = new Date(seconds * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="mb-3 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                        <MessageSquare size={15} className="text-blue-300" />
                        <span>Latest captions</span>
                    </div>
                    {hiddenCount > 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">+{hiddenCount} older</span>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                {captions.length === 0 ? (
                    <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center text-slate-500">
                        <MessageSquare size={24} />
                        <p className="mt-3 text-sm font-bold text-slate-300">Waiting for speech</p>
                        <p className="mt-1 text-xs leading-5">Live captions will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {visibleCaptions.map((cap, index) => (
                            <article key={`${hiddenCount}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.07]">
                                <div className="mb-1.5 flex items-center justify-between gap-3">
                                    <span className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">
                                        {getSpeakerName(cap.speakerId)}
                                    </span>
                                    <time className="shrink-0 text-[10px] font-semibold text-slate-600">{formatTime(cap.start)}</time>
                                </div>
                                <p className="line-clamp-2 text-xs font-medium leading-5 text-slate-300">{cap.text}</p>
                            </article>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default CaptionPanel;
