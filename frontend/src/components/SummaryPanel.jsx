import React from 'react';
import { CheckCircle2, CircleHelp, ClipboardCopy, FileText, Settings, Share2, Sparkles } from 'lucide-react';

const SummaryPanel = ({ summary, onGenerate, generating, llmConfig, onOpenSettings }) => {
    const hasApiKey = llmConfig?.apiKey?.trim().length > 0;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {!summary ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
                        <div className="mb-2 flex items-center gap-2 text-blue-200">
                            <Sparkles size={17} />
                            <h3 className="text-sm font-black uppercase tracking-[0.16em]">AI Summary</h3>
                        </div>
                        <p className="text-sm leading-5 text-blue-100/70">
                            Convert this meeting into summary, actions, and questions.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {['Summary', 'Actions', 'Questions'].map((item) => (
                            <span key={item} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                                {item}
                            </span>
                        ))}
                    </div>

                    <div className="mt-auto">
                        {!hasApiKey ? (
                            <div className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4">
                                <div className="mb-2 flex items-center gap-2 text-violet-200">
                                    <Settings size={16} />
                                    <h4 className="text-[10px] font-black uppercase tracking-[0.18em]">API key required</h4>
                                </div>
                                <p className="text-xs leading-5 text-violet-100/65">Add a provider key to generate notes.</p>
                                <button
                                    onClick={onOpenSettings}
                                    className="mt-3 w-full rounded-xl border border-violet-300/20 bg-violet-400/15 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-violet-100 transition hover:bg-violet-400/25"
                                >
                                    Settings
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={onGenerate}
                                disabled={generating}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                            >
                                <Sparkles size={16} className={generating ? 'animate-spin' : ''} />
                                {generating ? 'Reading transcript...' : 'Generate summary'}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                    <section className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">
                            <FileText size={13} /> Summary
                        </div>
                        <p className="line-clamp-5 text-sm font-medium leading-5 text-slate-200">{summary.executive}</p>
                    </section>

                    <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
                            <CheckCircle2 size={13} /> Actions
                        </div>
                        <div className="space-y-2 overflow-hidden">
                            {(summary.actions || []).slice(0, 5).map((item, index) => (
                                <div key={index} className="flex items-start gap-2 rounded-xl bg-white/[0.04] p-2.5">
                                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-300" />
                                    <span className="line-clamp-2 text-xs font-medium leading-5 text-slate-300">{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="shrink-0 rounded-2xl border border-amber-300/15 bg-amber-300/10 p-3.5">
                        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
                            <CircleHelp size={13} /> Questions
                        </div>
                        <p className="line-clamp-3 text-xs font-medium leading-5 text-amber-50/75">{summary.questions || 'No open questions detected.'}</p>
                    </section>

                    <div className="grid shrink-0 grid-cols-2 gap-2">
                        <button className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-white/[0.1]">
                            <ClipboardCopy size={14} /> Copy
                        </button>
                        <button className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-white/[0.1]">
                            <Share2 size={14} /> Share
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SummaryPanel;
