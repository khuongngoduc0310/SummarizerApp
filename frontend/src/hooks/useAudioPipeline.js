import { useEffect, useRef, useCallback } from 'react';

const IGNORED_CAPTIONS = new Set([
    "(Coughing)", "(sighing)", "(laughing)", "(crying)",
    "(sneezing)", "(breathing)", "(snoring)", "[BLANK_AUDIO]", "[ Pause ]", "[INAUDIBLE]", "(sad music)", "[Crying]", "[ Inaudible Remark ]", "(panting)", "(audience murmurs)", "(audience laughing)",
    "(audience chantering)", "(coughing)", "[Coughing]"
]);

const recordBenchmarkEvent = (event) => {
    if (typeof window === 'undefined') return;

    window.__MEETSUMMARIZER_STT_BENCHMARKS__ ??= [];
    window.__MEETSUMMARIZER_STT_BENCHMARKS__.push({
        recordedAt: new Date().toISOString(),
        ...event
    });

    window.exportMeetSummarizerSttBenchmarks ??= () => {
        const data = window.__MEETSUMMARIZER_STT_BENCHMARKS__ || [];
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `meetsummarizer-stt-benchmark-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };
};

export const useAudioPipeline = (socket, meetingId, localStream, userId, runtimeConfig = null, sttConfig = null, onSttMetric = null) => {
    const workerRef = useRef(null);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const nativeTranscriptUnsubscribeRef = useRef(null);
    const samplesRef = useRef([]); // Browser WebGPU chunk buffer
    const nativeFrameBufferRef = useRef([]); // Native STT short-frame buffer
    const chunkSequenceRef = useRef(0);
    const nativeFrameSequenceRef = useRef(0);
    const telemetryRef = useRef({
        droppedChunkCount: 0,
        lastRealtimeFactor: null,
        lastInferenceTimeMs: null,
        lastCaptionLatencyMs: null
    });
    const CHUNK_DURATION = 15; // Browser WebGPU fallback chunk size
    const NATIVE_FRAME_DURATION = 0.1; // 100ms frames for native STT
    const NATIVE_FRAME_SAMPLES = Math.round(16000 * NATIVE_FRAME_DURATION);
    const SAMPLE_RATE = 16000;
    const useNativeStt = Boolean(
        runtimeConfig?.features?.nativeStt &&
        typeof window !== 'undefined' &&
        window.desktopStt?.sendAudioFrame &&
        window.desktopStt?.onTranscript
    );
    
    const startTimeRef = useRef(Date.now() / 1000);

    const shouldIgnoreCaption = useCallback((text) => {
        const cleanText = text.trim();
        return !cleanText || IGNORED_CAPTIONS.has(cleanText) || cleanText.includes("[");
    }, []);

    const initializeNativeStt = useCallback(() => {
        if (!useNativeStt || nativeTranscriptUnsubscribeRef.current) return;

        nativeTranscriptUnsubscribeRef.current = window.desktopStt.onTranscript((event) => {
            if (!event || event.type !== 'final') return;
            if (shouldIgnoreCaption(event.text || '')) return;

            const payload = {
                meetingId: event.meetingId || meetingId,
                speakerId: event.speakerId || userId,
                utteranceId: event.utteranceId,
                isFinal: true,
                text: event.text,
                start: event.start,
                end: event.end
            };
            console.log('[Native STT] final caption', {
                utteranceId: payload.utteranceId,
                text: payload.text,
                metrics: event.metrics
            });
            onSttMetric?.({
                event: 'caption-result',
                backend: event.backend ? `native-${event.backend}` : 'native',
                timestamp: Date.now(),
                inferenceTimeMs: event.metrics?.inferenceTimeMs ?? null,
                realtimeFactor: event.metrics?.realtimeFactor ?? null,
                audioDurationSec: event.metrics?.audioDurationSec ?? null,
                processedAudioDurationSec: event.metrics?.processedAudioDurationSec ?? null,
                duplicateSuppressedCount: event.metrics?.duplicateSuppressedCount ?? 0,
                overlapPrefixTrimCount: event.metrics?.overlapPrefixTrimCount ?? 0,
                rmsBefore: event.metrics?.rmsBefore ?? null,
                rmsAfter: event.metrics?.rmsAfter ?? null,
                trimmedMs: event.metrics?.trimmedMs ?? null,
                textLength: event.text?.length ?? 0
            });
            socket.emit('caption', payload);
        });

        window.desktopStt.getStatus?.().then((status) => {
            console.log('[Native STT] status', status);
        }).catch((error) => {
            console.warn('[Native STT] status failed; browser WebGPU fallback may be used', error);
        });
    }, [meetingId, onSttMetric, shouldIgnoreCaption, socket, useNativeStt, userId]);

    const sendNativeAudioSamples = useCallback((inputData) => {
        for (let i = 0; i < inputData.length; i++) {
            nativeFrameBufferRef.current.push(inputData[i]);
        }

        while (nativeFrameBufferRef.current.length >= NATIVE_FRAME_SAMPLES) {
            const frame = nativeFrameBufferRef.current.slice(0, NATIVE_FRAME_SAMPLES);
            nativeFrameBufferRef.current = nativeFrameBufferRef.current.slice(NATIVE_FRAME_SAMPLES);
            const sequence = ++nativeFrameSequenceRef.current;

            const windowSec = Number(sttConfig?.windowSec ?? 4);
            // Important: use ?? instead of || so overlapSec=0 is preserved.
            const overlapSec = Math.min(Number(sttConfig?.overlapSec ?? 1), windowSec - 0.5);
            const stepSec = Math.max(0.5, windowSec - overlapSec);
            const maxBufferSec = Number(sttConfig?.maxBufferSec ?? 8);

            window.desktopStt.sendAudioFrame({
                meetingId,
                speakerId: userId,
                sequence,
                sampleRate: SAMPLE_RATE,
                format: 'f32le',
                durationSec: NATIVE_FRAME_DURATION,
                capturedAt: Date.now(),
                sttConfig: {
                    windowSec,
                    overlapSec,
                    stepSec,
                    maxBufferSec,
                    vadThreshold: Number(sttConfig?.vadThreshold ?? 0.008),
                    highPassCutoffHz: Number(sttConfig?.highPassCutoffHz ?? 100),
                    dcOffsetRemoval: sttConfig?.dcOffsetRemoval ?? true,
                    highPassFilter: sttConfig?.highPassFilter ?? true,
                    normalizeAudio: sttConfig?.normalizeAudio ?? true,
                    silenceTrim: sttConfig?.silenceTrim ?? true
                },
                audio: frame
            }).catch((error) => {
                console.warn('[Native STT] sendAudioFrame failed; future work should fallback to WebGPU', error);
                onSttMetric?.({
                    event: 'send-failed',
                    backend: 'native',
                    timestamp: Date.now(),
                    error: error.message
                });
            });
        }
    }, [NATIVE_FRAME_SAMPLES, meetingId, onSttMetric, sttConfig, userId]);

    const initializeWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new Worker(
                new URL('../workers/transcription.worker.js', import.meta.url),
                { type: 'module' }
            );

            workerRef.current.onmessage = (event) => {
                const {
                    type,
                    segments,
                    meetingId: mid,
                    error,
                    chunkId,
                    chunkCreatedAt,
                    chunkDuration,
                    processingTime,
                    realtimeFactor,
                    droppedChunkCount
                } = event.data;

                if (type === 'result' && segments) {
                    const captionLatencyMs = typeof chunkCreatedAt === 'number'
                        ? performance.now() - chunkCreatedAt
                        : null;

                    telemetryRef.current = {
                        droppedChunkCount: droppedChunkCount ?? telemetryRef.current.droppedChunkCount,
                        lastRealtimeFactor: realtimeFactor ?? telemetryRef.current.lastRealtimeFactor,
                        lastInferenceTimeMs: processingTime ?? telemetryRef.current.lastInferenceTimeMs,
                        lastCaptionLatencyMs: captionLatencyMs ?? telemetryRef.current.lastCaptionLatencyMs
                    };

                    const benchmarkEvent = {
                        event: 'caption-result',
                        backend: 'webgpu',
                        chunkId,
                        chunkDurationSec: chunkDuration,
                        inferenceTimeMs: processingTime,
                        realtimeFactor,
                        droppedChunkCount: telemetryRef.current.droppedChunkCount,
                        captionLatencyMs
                    };
                    recordBenchmarkEvent(benchmarkEvent);
                    onSttMetric?.({ timestamp: Date.now(), ...benchmarkEvent });
                    console.log('[STT Baseline]', benchmarkEvent);

                    segments.forEach(segment => {
                        if (shouldIgnoreCaption(segment.text)) return;

                        socket.emit('caption', {
                            meetingId: mid,
                            speakerId: userId,
                            utteranceId: `webgpu-${chunkId}-${segment.start}-${segment.end}`,
                            isFinal: true,
                            text: segment.text,
                            start: segment.start,
                            end: segment.end
                        });
                    });
                } else if (type === 'telemetry') {
                    if (event.data.event === 'chunk-dropped') {
                        telemetryRef.current.droppedChunkCount = event.data.droppedChunkCount;
                    }
                    const telemetryEvent = { backend: 'webgpu', timestamp: Date.now(), ...event.data };
                    recordBenchmarkEvent(telemetryEvent);
                    onSttMetric?.(telemetryEvent);
                    console.log('[STT Telemetry]', event.data);
                } else if (type === 'progress') {
                    // Keep progress events quiet by default; telemetry events carry baseline measurements.
                } else if (type === 'error') {
                    onSttMetric?.({ event: 'error', backend: 'webgpu', timestamp: Date.now(), error });
                    console.error('[Whisper Error]', error);
                }
            };
        }
    }, [onSttMetric, shouldIgnoreCaption, socket, userId]);

    const getBrowserFallbackOverlapDuration = useCallback(() => {
        const configuredOverlap = Number(sttConfig?.overlapSec);
        if (Number.isFinite(configuredOverlap)) return Math.max(0, configuredOverlap);
        return 3;
    }, [sttConfig]);

    const flushAudio = useCallback(() => {
        if (samplesRef.current.length === 0 || !workerRef.current) return;

        const audioData = new Float32Array(samplesRef.current);
        const startTs = startTimeRef.current;
        const chunkId = ++chunkSequenceRef.current;
        const chunkCreatedAt = performance.now();
        const chunkDuration = audioData.length / SAMPLE_RATE;
        
        // Calculate RMS (Volume) for diagnostics
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        
        console.log(`[AudioPipeline] Processing chunk=${chunkId} duration=${chunkDuration.toFixed(2)}s samples=${audioData.length} RMS=${rms.toFixed(4)}`);

        // Only transcribe if there is actual sound
        if (rms > 0.01) {
            workerRef.current.postMessage({
                type: 'transcribe',
                audio: audioData,
                meetingId,
                speakerId: userId,
                startTs,
                chunkId,
                chunkCreatedAt,
                chunkDuration
            });
        }

        const overlapDuration = getBrowserFallbackOverlapDuration();
        const overlapSamples = Math.round(overlapDuration * SAMPLE_RATE);

        // Keep configured overlap for the browser WebGPU fallback. Handle 0s explicitly:
        // Array.slice(-0) equals slice(0), which would accidentally keep the entire buffer.
        if (overlapSamples > 0 && samplesRef.current.length > overlapSamples) {
            samplesRef.current = samplesRef.current.slice(-overlapSamples);
            startTimeRef.current = (Date.now() / 1000) - overlapDuration;
        } else {
            samplesRef.current = [];
            startTimeRef.current = Date.now() / 1000;
        }
    }, [getBrowserFallbackOverlapDuration, meetingId, userId]);

    useEffect(() => {
        if (!localStream || !meetingId || !userId) return;

        if (useNativeStt) {
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            console.log('[AudioPipeline] Using native Whisper.cpp STT');
            initializeNativeStt();
        } else {
            if (nativeTranscriptUnsubscribeRef.current) {
                nativeTranscriptUnsubscribeRef.current();
                nativeTranscriptUnsubscribeRef.current = null;
            }
            nativeFrameBufferRef.current = [];
            console.log('[AudioPipeline] Using browser WebGPU STT');
            initializeWorker();
        }

        let cancelled = false;
        let workletNode = null;
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: SAMPLE_RATE
        });
        audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(localStream);
        const silence = audioContext.createGain();
        silence.gain.value = 0;

        const setupWorklet = async () => {
            try {
                const workletUrl = new URL('../workers/audio-processor.js', import.meta.url);
                await audioContext.audioWorklet.addModule(workletUrl);
                
                if (cancelled || audioContextRef.current !== audioContext) return;

                workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
                processorRef.current = workletNode;

                workletNode.port.onmessage = (event) => {
                    const inputData = event.data;

                    if (useNativeStt) {
                        sendNativeAudioSamples(inputData);
                        return;
                    }

                    for (let i = 0; i < inputData.length; i++) {
                        samplesRef.current.push(inputData[i]);
                    }

                    if (samplesRef.current.length / SAMPLE_RATE >= CHUNK_DURATION) {
                        flushAudio();
                    }
                };

                source.connect(workletNode);
                workletNode.connect(silence);
                silence.connect(audioContext.destination);
            } catch (err) {
                console.error("Failed to setup AudioWorklet:", err);
            }
        };

        setupWorklet();

        return () => {
            cancelled = true;
            if (workletNode) {
                workletNode.port.onmessage = null;
                workletNode.disconnect();
                if (processorRef.current === workletNode) {
                    processorRef.current = null;
                }
            }
            if (audioContextRef.current === audioContext) {
                audioContextRef.current = null;
            }
            if (audioContext.state !== 'closed') {
                audioContext.close();
            }
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
            if (nativeTranscriptUnsubscribeRef.current) {
                nativeTranscriptUnsubscribeRef.current();
                nativeTranscriptUnsubscribeRef.current = null;
            }
            nativeFrameBufferRef.current = [];
        };
    }, [localStream, meetingId, userId, useNativeStt, initializeNativeStt, initializeWorker, sendNativeAudioSamples, flushAudio]);

    return {};
};
