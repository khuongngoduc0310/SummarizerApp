import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, History, LoaderCircle, MessageSquare } from 'lucide-react';

const getCaptionId = (caption) => caption.captionId || caption.utteranceId;

const CaptionPanel = ({
    captions,
    participantNames = {},
    hasOlderCaptions = false,
    loadingHistory = false,
    historyError,
    onLoadOlder
}) => {
    const scrollRef = useRef(null);
    const nearBottomRef = useRef(true);
    const restoreScrollRef = useRef(null);
    const initializedRef = useRef(false);
    const [showNewCaptions, setShowNewCaptions] = useState(false);

    const getSpeakerName = (caption) => caption.speakerName || participantNames[caption.speakerId] || caption.speakerId || 'Unknown';

    const formatTime = (caption) => {
        if (caption.createdAt) {
            return new Date(caption.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (!caption.start && caption.start !== 0) return '';
        return new Date(caption.start * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const scrollToBottom = (behavior = 'smooth') => {
        const container = scrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
        nearBottomRef.current = true;
        setShowNewCaptions(false);
    };

    const handleScroll = () => {
        const container = scrollRef.current;
        if (!container) return;
        nearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        if (nearBottomRef.current) setShowNewCaptions(false);
    };

    const handleLoadOlder = async () => {
        const container = scrollRef.current;
        if (!container || !onLoadOlder || loadingHistory) return;
        restoreScrollRef.current = {
            firstCaptionId: getCaptionId(captions[0]),
            lastCaptionId: getCaptionId(captions[captions.length - 1]),
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop
        };
        const loaded = await onLoadOlder();
        if (!loaded) restoreScrollRef.current = null;
    };

    useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container || captions.length === 0) {
            initializedRef.current = false;
            return;
        }

        const restore = restoreScrollRef.current;
        if (restore && getCaptionId(captions[0]) !== restore.firstCaptionId) {
            const liveCaptionArrived = getCaptionId(captions[captions.length - 1]) !== restore.lastCaptionId;
            container.scrollTop = restore.scrollTop + container.scrollHeight - restore.scrollHeight;
            restoreScrollRef.current = null;
            if (liveCaptionArrived) {
                const frame = window.requestAnimationFrame(() => setShowNewCaptions(true));
                return () => window.cancelAnimationFrame(frame);
            }
            return;
        }
        if (restore) {
            if (getCaptionId(captions[captions.length - 1]) !== restore.lastCaptionId) {
                restore.lastCaptionId = getCaptionId(captions[captions.length - 1]);
                const frame = window.requestAnimationFrame(() => setShowNewCaptions(true));
                return () => window.cancelAnimationFrame(frame);
            }
            return;
        }

        if (!initializedRef.current) {
            initializedRef.current = true;
            container.scrollTop = container.scrollHeight;
            nearBottomRef.current = true;
            return;
        }

        if (nearBottomRef.current) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        } else {
            const frame = window.requestAnimationFrame(() => setShowNewCaptions(true));
            return () => window.cancelAnimationFrame(frame);
        }
    }, [captions]);

    useEffect(() => {
        if (!hasOlderCaptions && !loadingHistory) restoreScrollRef.current = null;
    }, [hasOlderCaptions, loadingHistory]);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="mb-3 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                        <MessageSquare size={15} className="text-blue-300" />
                        <span>Transcript</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                        {captions.length} loaded
                    </span>
                </div>
            </div>

            <div ref={scrollRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-y-auto pr-1">
                {hasOlderCaptions && (
                    <button
                        type="button"
                        onClick={handleLoadOlder}
                        disabled={loadingHistory}
                        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 transition hover:bg-white/[0.08] hover:text-slate-200 disabled:cursor-wait disabled:opacity-50"
                    >
                        {loadingHistory ? <LoaderCircle size={14} className="animate-spin" /> : <History size={14} />}
                        {loadingHistory ? 'Loading history...' : 'Load older captions'}
                    </button>
                )}

                {historyError && (
                    <div className="mb-3 rounded-xl border border-red-400/15 bg-red-400/[0.07] px-3 py-2 text-xs leading-5 text-red-200/80">
                        {historyError}
                    </div>
                )}

                {captions.length === 0 ? (
                    <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center text-slate-500">
                        {loadingHistory ? <LoaderCircle size={24} className="animate-spin" /> : <MessageSquare size={24} />}
                        <p className="mt-3 text-sm font-bold text-slate-300">{loadingHistory ? 'Loading transcript' : 'Waiting for speech'}</p>
                        <p className="mt-1 text-xs leading-5">{loadingHistory ? 'Retrieving this session’s captions.' : 'Live captions will appear here.'}</p>
                    </div>
                ) : (
                    <div className="space-y-2.5 pb-1">
                        {captions.map((caption, index) => (
                            <article key={getCaptionId(caption) || `caption-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.07]">
                                <div className="mb-1.5 flex items-center justify-between gap-3">
                                    <span className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">
                                        {getSpeakerName(caption)}
                                    </span>
                                    <time className="shrink-0 text-[10px] font-semibold text-slate-600">{formatTime(caption)}</time>
                                </div>
                                <p className="break-words text-xs font-medium leading-5 text-slate-300">{caption.text}</p>
                            </article>
                        ))}
                    </div>
                )}
            </div>

            {showNewCaptions && (
                <button
                    type="button"
                    onClick={() => scrollToBottom()}
                    className="mt-2 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-blue-200 transition hover:bg-blue-400/20"
                >
                    <ArrowDown size={14} /> New captions
                </button>
            )}
        </div>
    );
};

export default CaptionPanel;
