import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardCopy, FileText, RefreshCw, Settings, Share2, Sparkles } from 'lucide-react';
import { getActiveApiKey, getProviderConfig, getSelectedModel } from '../config/llmModels';

const buildSummaryText = (summary) => {
    const sections = [];
    const executive = typeof summary?.executive === 'string' ? summary.executive.trim() : '';
    const detailed = typeof summary?.raw === 'string' ? summary.raw.trim() : '';
    const actions = Array.isArray(summary?.actions) ? summary.actions.filter(Boolean) : [];
    const questions = typeof summary?.questions === 'string' ? summary.questions.trim() : '';

    if (executive) sections.push(`Overview\n${executive}`);
    if (detailed) sections.push(`Detailed summary\n${detailed}`);
    if (actions.length) sections.push(`Actions\n${actions.map((item) => `- ${item}`).join('\n')}`);
    if (questions) sections.push(`Open questions\n${questions}`);

    return sections.join('\n\n');
};

const markdownComponents = {
    h1: ({ children }) => <h1 className="mb-3 mt-6 text-xl font-black tracking-tight text-white first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-base font-black tracking-tight text-slate-100 first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-bold text-blue-200 first:mt-0">{children}</h3>,
    p: ({ children }) => <p className="my-3 text-sm leading-6 text-slate-300 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300 marker:text-blue-400">{children}</ul>,
    ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-300 marker:font-bold marker:text-blue-300">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{children}</li>,
    strong: ({ children }) => <strong className="font-bold text-slate-100">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-blue-400/50 bg-blue-400/[0.06] py-1 pl-3 italic text-slate-300">{children}</blockquote>,
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-200">{children}</a>,
    code: ({ children }) => <code className="break-words rounded bg-black/30 px-1.5 py-0.5 font-mono text-[0.85em] text-blue-100">{children}</code>,
    pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-5">{children}</pre>,
    hr: () => <hr className="my-5 border-white/10" />
};

const SummaryPanel = ({ summary, onGenerate, generating, llmConfig, onOpenSettings }) => {
    const hasApiKey = getActiveApiKey(llmConfig).trim().length > 0;
    const selectedModel = getSelectedModel(llmConfig);
    const generatedProvider = getProviderConfig(summary?._meta?.provider || llmConfig?.provider);
    const generatedModel = generatedProvider.models.find((model) => model.id === summary?._meta?.model) || selectedModel;
    const [timeRange, setTimeRange] = useState('full');
    const [actionsOpen, setActionsOpen] = useState(false);
    const [questionsOpen, setQuestionsOpen] = useState(false);
    const [actionFeedback, setActionFeedback] = useState(null);
    const [isConfiguringSummary, setIsConfiguringSummary] = useState(false);

    useEffect(() => {
        if (!actionFeedback) return undefined;
        const timeout = window.setTimeout(() => setActionFeedback(null), 2000);
        return () => window.clearTimeout(timeout);
    }, [actionFeedback]);

    const handleGenerate = async () => {
        const minutes = timeRange === 'full' ? null : parseInt(timeRange, 10);
        const generated = await onGenerate(minutes);

        if (generated) {
            setIsConfiguringSummary(false);
            setActionsOpen(false);
            setQuestionsOpen(false);
            setActionFeedback(null);
        }
    };

    const handleStartAnotherSummary = () => {
        setTimeRange('full');
        setActionFeedback(null);
        setIsConfiguringSummary(true);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(buildSummaryText(summary));
            setActionFeedback('copied');
        } catch (error) {
            console.error('Failed to copy summary:', error);
            setActionFeedback('error');
        }
    };

    const handleShare = async () => {
        const text = buildSummaryText(summary);

        if (!navigator.share) {
            await handleCopy();
            return;
        }

        try {
            await navigator.share({ title: 'Meeting summary', text });
            setActionFeedback('shared');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Failed to share summary:', error);
                setActionFeedback('error');
            }
        }
    };

    const timeRangeOptions = [
        { value: 'full', label: 'Full' },
        { value: '15', label: '15m' },
        { value: '30', label: '30m' },
        { value: '60', label: '1h' }
    ];

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {!summary || isConfiguringSummary ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                    {summary && (
                        <button
                            type="button"
                            onClick={() => setIsConfiguringSummary(false)}
                            disabled={generating}
                            className="flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-300 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-wait disabled:opacity-50"
                        >
                            <ArrowLeft size={13} /> Back to summary
                        </button>
                    )}
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

                    {/* Time range selector */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-500 mb-2">Summarize</p>
                        <div className="grid grid-cols-4 gap-1.5">
                            {timeRangeOptions.map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => setTimeRange(opt.value)}
                                    disabled={generating}
                                    className={`rounded-xl py-2 text-[10px] font-black uppercase tracking-[0.12em] transition-all ${
                                        timeRange === opt.value
                                            ? 'bg-blue-500/20 border border-blue-400/30 text-blue-200'
                                            : 'bg-white/[0.04] border border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/[0.08]'
                                    } disabled:cursor-wait disabled:opacity-50`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
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
                                onClick={handleGenerate}
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
                <div className="h-full min-h-0 overflow-y-auto pr-1">
                    <div className="space-y-3 pb-1">
                        <header className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-blue-200">
                                    <FileText size={15} className="shrink-0" />
                                    <h3 className="text-xs font-black uppercase tracking-[0.16em]">Meeting summary</h3>
                                </div>
                                {summary._meta?.type === 'rolling' && (
                                    <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                                        Rolling · {summary._meta.segmentCount} segments
                                    </p>
                                )}
                                <p className="mt-1 truncate text-[10px] font-bold text-slate-500">
                                    {generatedProvider.label} · {generatedModel.label}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleStartAnotherSummary}
                                    title="Generate another summary"
                                    aria-label="Generate another summary"
                                    className="grid size-9 place-items-center rounded-xl border border-blue-400/15 bg-blue-400/[0.07] text-blue-200 transition hover:bg-blue-400/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                                >
                                    <RefreshCw size={15} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    title={actionFeedback === 'copied' ? 'Copied' : 'Copy summary'}
                                    aria-label={actionFeedback === 'copied' ? 'Summary copied' : 'Copy summary'}
                                    className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                                >
                                    {actionFeedback === 'copied' ? <Check size={15} className="text-emerald-300" /> : <ClipboardCopy size={15} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleShare}
                                    title={actionFeedback === 'shared' ? 'Shared' : 'Share summary'}
                                    aria-label={actionFeedback === 'shared' ? 'Summary shared' : 'Share summary'}
                                    className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                                >
                                    {actionFeedback === 'shared' ? <Check size={15} className="text-emerald-300" /> : <Share2 size={15} />}
                                </button>
                                <span className="sr-only" role="status" aria-live="polite">
                                    {actionFeedback === 'copied' ? 'Summary copied to clipboard.' : actionFeedback === 'shared' ? 'Summary shared.' : actionFeedback === 'error' ? 'The summary action failed.' : ''}
                                </span>
                            </div>
                        </header>

                        {typeof summary.raw === 'string' && summary.raw.trim() && summary.executive && (
                            <section className="rounded-2xl border border-blue-400/15 bg-blue-400/[0.07] p-3.5">
                                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">Overview</div>
                                <p className="text-sm font-medium leading-6 text-slate-200">{summary.executive}</p>
                            </section>
                        )}

                        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                            <div className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                                <Sparkles size={13} className="text-blue-300" /> Detailed notes
                            </div>
                            <div className="min-w-0 [overflow-wrap:anywhere]">
                                <ReactMarkdown components={markdownComponents}>
                                    {(typeof summary.raw === 'string' && summary.raw.trim()) || summary.executive || 'No detailed summary was generated.'}
                                </ReactMarkdown>
                            </div>
                        </section>

                        <section className="overflow-hidden rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.06]">
                            <button
                                type="button"
                                onClick={() => setActionsOpen((open) => !open)}
                                aria-expanded={actionsOpen}
                                aria-controls="summary-actions"
                                className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-emerald-300/[0.06] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-emerald-300"
                            >
                                <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
                                    <CheckCircle2 size={13} /> Actions
                                    <span className="rounded-full bg-emerald-300/10 px-2 py-0.5 text-[9px] text-emerald-200">
                                        {Array.isArray(summary.actions) ? summary.actions.length : 0}
                                    </span>
                                </span>
                                <ChevronDown size={15} className={`text-emerald-200 transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {actionsOpen && (
                                <div id="summary-actions" className="space-y-2 border-t border-emerald-300/10 p-3">
                                    {Array.isArray(summary.actions) && summary.actions.length > 0 ? summary.actions.map((item, index) => (
                                        <div key={index} className="flex items-start gap-2.5 rounded-xl bg-black/10 p-2.5">
                                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-300" />
                                            <span className="min-w-0 break-words text-xs font-medium leading-5 text-slate-300">{item}</span>
                                        </div>
                                    )) : (
                                        <p className="px-1 text-xs leading-5 text-slate-400">No action items detected.</p>
                                    )}
                                </div>
                            )}
                        </section>

                        <section className="overflow-hidden rounded-2xl border border-amber-300/15 bg-amber-300/[0.07]">
                            <button
                                type="button"
                                onClick={() => setQuestionsOpen((open) => !open)}
                                aria-expanded={questionsOpen}
                                aria-controls="summary-questions"
                                className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-amber-300/[0.06] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-amber-200"
                            >
                                <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
                                    <CircleHelp size={13} /> Open questions
                                </span>
                                <ChevronDown size={15} className={`text-amber-100/70 transition-transform ${questionsOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {questionsOpen && (
                                <div id="summary-questions" className="border-t border-amber-300/10 px-3.5 py-3">
                                    <p className="whitespace-pre-wrap break-words text-xs font-medium leading-5 text-amber-50/75">
                                        {summary.questions || 'No open questions detected.'}
                                    </p>
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SummaryPanel;
