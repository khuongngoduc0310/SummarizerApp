import { useEffect, useRef, useCallback } from 'react';

export const useAudioPipeline = (socket, meetingId, localStream, userId) => {
    const workerRef = useRef(null);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const samplesRef = useRef([]); // Use standard array for better performance
    const CHUNK_DURATION = 15; // Set to 15s for faster feedback
    const SAMPLE_RATE = 16000;
    
    const startTimeRef = useRef(Date.now() / 1000);
    const IGNORED_CAPTIONS = new Set([
        "(Coughing)", "(sighing)", "(laughing)", "(crying)", 
        "(sneezing)", "(breathing)", "(snoring)", "[BLANK_AUDIO]", "[ Pause ]","[INAUDIBLE]", "(sad music)", "[Crying]","[ Inaudible Remark ]", "(panting)", "(audience murmurs)","(audience laughing)",
        "(audience chantering)", "(coughing)", "[Coughing]"
    ]);

    const initializeWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new Worker(
                new URL('../workers/transcription.worker.js', import.meta.url),
                { type: 'module' }
            );

            workerRef.current.onmessage = (event) => {
                const { type, segments, meetingId: mid, speakerId, error, status, progress } = event.data;

                if (type === 'result' && segments) {

                    segments.forEach(segment => {
                        const cleanText = segment.text.trim();
                        
                        if (IGNORED_CAPTIONS.has(cleanText)) return;
                        if (cleanText.includes("[")) return;

                        socket.emit('caption', {
                            meetingId: mid,
                            speakerId: userId,
                            text: segment.text,
                            start: segment.start,
                            end: segment.end
                        });
                    });
                } else if (type === 'progress') {
                    // console.log(`[Whisper] ${status}: ${Math.round(progress * 100)}%`);
                } else if (type === 'error') {
                    console.error('[Whisper Error]', error);
                }
            };
        }
    }, [socket, userId]);

    const flushAudio = useCallback(() => {
        if (samplesRef.current.length === 0 || !workerRef.current) return;

        const audioData = new Float32Array(samplesRef.current);
        const startTs = startTimeRef.current;
        
        // Calculate RMS (Volume) for diagnostics
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        
        console.log(`[AudioPipeline] Processing ${audioData.length} samples (RMS: ${rms.toFixed(4)})`);

        // Only transcribe if there is actual sound
        if (rms > 0.01) {
            workerRef.current.postMessage({
                type: 'transcribe',
                audio: audioData,
                meetingId,
                speakerId: userId,
                startTs
            });
        } else {
            console.log("[AudioPipeline] Skipping silent chunk.");
        }

        samplesRef.current = [];
        startTimeRef.current = Date.now() / 1000;
    }, [meetingId, userId]);

    useEffect(() => {
        if (!localStream || !meetingId || !userId) return;

        initializeWorker();

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
                
                if (!audioContextRef.current) return;

                const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
                processorRef.current = workletNode;

                workletNode.port.onmessage = (event) => {
                    const inputData = event.data;
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
            if (processorRef.current) {
                processorRef.current.port.onmessage = null;
                processorRef.current.disconnect();
                processorRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            if (workerRef.current) {
                workerRef.current.terminate();
                workerRef.current = null;
            }
        };
    }, [localStream, meetingId, userId, initializeWorker, flushAudio]);

    return {};
};
