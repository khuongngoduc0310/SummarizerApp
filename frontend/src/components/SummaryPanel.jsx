import React from 'react';
import { Sparkles, FileText, CheckCircle2, CircleHelp, Share2 } from 'lucide-react';

const SummaryPanel = ({ summary, onGenerate, generating, llmConfig, onOpenSettings }) => {
    const hasApiKey = llmConfig?.apiKey?.trim().length > 0;

    return (
        <div className="flex flex-col h-full space-y-6">
            {!summary ? (
                <div className="space-y-6 py-4">
                    <div className="p-4 bg-[#2a2a2a] rounded-xl border border-white/5 space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-[#0E71EB] flex items-center gap-2">
                            <Sparkles size={12} /> AI Insights
                        </h4>
                        <p className="text-xs font-medium text-gray-400 leading-relaxed">
                            Generate a high-level overview and action items once the meeting has enough content.
                        </p>
                    </div>

                    {!hasApiKey ? (
                        <div className="p-5 bg-purple-500/5 border border-purple-500/20 rounded-2xl space-y-4">
                            <div className="flex items-center gap-3 text-purple-400">
                                <Sparkles size={18} />
                                <h4 className="text-xs font-black uppercase tracking-widest">Setup Required</h4>
                            </div>
                            <p className="text-[11px] text-gray-500 font-medium leading-relaxed">
                                To generate summaries, you need to provide an API key for OpenAI or Anthropic.
                            </p>
                            <button
                                onClick={onOpenSettings}
                                className="w-full py-2.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                                Open Settings
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={onGenerate}
                            disabled={generating}
                            className={`w-full py-3.5 bg-[#0E71EB] text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#0E71EB]/20 ${generating ? 'opacity-50 cursor-wait' : 'hover:bg-[#1a7df5]'}`}
                        >
                            <Sparkles size={16} className={generating ? 'animate-spin' : ''} />
                            {generating ? 'Parsing Transcript...' : 'Generate Summary'}
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-[#0E71EB]" />
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Executive Summary</h4>
                        </div>
                        <p className="text-xs font-semibold text-gray-200 leading-relaxed bg-[#2a2a2a] p-4 rounded-xl border border-white/5">
                            {summary.executive}
                        </p>
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-green-500" />
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Next Actions</h4>
                        </div>
                        <div className="space-y-2">
                            {summary.actions.map((item, i) => (
                                <div key={i} className="flex items-start gap-3 p-3 bg-[#2a2a2a] rounded-lg border border-white/5 group hover:border-[#0E71EB]/50 transition-colors">
                                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-[#0E71EB] shrink-0"></div>
                                    <span className="text-[11px] font-semibold text-gray-300 leading-tight">{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <CircleHelp size={14} className="text-yellow-500" />
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Open Questions</h4>
                        </div>
                        <p className="text-[11px] font-bold text-gray-400 italic px-4 py-3 border-l-2 border-[#0E71EB] bg-[#2a2a2a]/30">
                            {summary.questions}
                        </p>
                    </section>

                    <button className="w-full py-3 bg-[#333] hover:bg-[#444] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                        <Share2 size={14} />
                        Share Notes
                    </button>
                </div>
            )}
        </div>
    );
};

export default SummaryPanel;
