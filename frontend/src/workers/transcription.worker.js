import {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    full,
    env,
} from "@huggingface/transformers";

// Configuration for WebGPU
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.logLevel = 'fatal'; // Suppress warnings

const MAX_NEW_TOKENS = 64;

class AutomaticSpeechRecognitionPipeline {
    static model_id = "onnx-community/whisper-small";
    static tokenizer = null;
    static processor = null;
    static model = null;

    static async getInstance(progress_callback = null) {
        this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
            progress_callback,
        });
        this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
            progress_callback,
        });

        this.model ??= WhisperForConditionalGeneration.from_pretrained(
            this.model_id,
            {
                dtype: {
                    encoder_model: "fp32", 
                    decoder_model_merged: "q4", 
                },
                device: "webgpu",
                progress_callback,
            },
        );

        return Promise.all([this.tokenizer, this.processor, this.model]);
    }
}

let processing = false;
let droppedChunkCount = 0;
let modelLoadStartedAt = performance.now();
let modelReadyAt = null;

async function generate({ audio, meetingId, speakerId, startTs, chunkId, chunkCreatedAt, chunkDuration }) {
    if (processing) {
        droppedChunkCount += 1;
        self.postMessage({
            type: 'telemetry',
            event: 'chunk-dropped',
            chunkId,
            droppedChunkCount,
            reason: 'worker-busy'
        });
        return;
    }
    processing = true;

    const receivedAt = performance.now();
    const audioDuration = chunkDuration ?? (audio.length / 16000);

    self.postMessage({ type: 'status', status: "start" });

    try {
        const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();

        const inputs = await processor(audio);

        const startTime = performance.now();

        const outputs = await model.generate({
            ...inputs,
            max_new_tokens: MAX_NEW_TOKENS,
            language: 'english',
        });

        const decoded = tokenizer.batch_decode(outputs, {
            skip_special_tokens: true,
        });

        const duration = performance.now() - startTime;
        const realtimeFactor = duration / (audioDuration * 1000);
        const queueLatency = typeof chunkCreatedAt === 'number' ? receivedAt - chunkCreatedAt : null;
        const text = decoded[0].trim();

        self.postMessage({
            type: 'telemetry',
            event: 'inference-complete',
            chunkId,
            chunkDuration: audioDuration,
            inferenceTimeMs: duration,
            realtimeFactor,
            queueLatencyMs: queueLatency,
            droppedChunkCount,
            modelLoadTimeMs: modelReadyAt ? modelReadyAt - modelLoadStartedAt : null
        });

        if (text && text.length > 0) {
            console.log(`[Whisper WebGPU] Generated: "${text}" (${duration.toFixed(0)}ms)`);
            
            // Send result back in the format the app expects
            self.postMessage({
                type: 'result',
                meetingId,
                speakerId,
                startTs,
                chunkId,
                chunkCreatedAt,
                chunkDuration: audioDuration,
                processingTime: duration,
                realtimeFactor,
                droppedChunkCount,
                segments: [{
                    text: text,
                    start: startTs,
                    end: startTs + (audio.length / 16000)
                }]
            });
        }
    } catch (err) {
        console.error("WebGPU Error:", err);
        self.postMessage({ type: 'error', error: err.message });
    } finally {
        processing = false;
    }
}

// Initial Load
(async function load() {
    self.postMessage({ type: 'progress', status: 'loading', progress: 0 });
    try {
        modelLoadStartedAt = performance.now();
        await AutomaticSpeechRecognitionPipeline.getInstance((x) => {
             self.postMessage({ type: 'progress', ...x });
        });
        
        // Warmup
        console.log("[WebGPU] Warming up...");
        const [tokenizer, processor, model] = await AutomaticSpeechRecognitionPipeline.getInstance();
        // TODO: Remove this warmup
        // Dummy input features for warmup
        await model.generate({
            input_features: full([1, 80, 3000], 0.0),
            max_new_tokens: 1,
        });
        modelReadyAt = performance.now();
        const modelLoadTimeMs = modelReadyAt - modelLoadStartedAt;
        console.log(`[WebGPU] Ready! modelLoadTime=${modelLoadTimeMs.toFixed(0)}ms`);
        self.postMessage({
            type: 'telemetry',
            event: 'model-ready',
            modelLoadTimeMs,
            backend: 'webgpu',
            model: AutomaticSpeechRecognitionPipeline.model_id
        });
        self.postMessage({ type: 'status', status: "ready" });
    } catch (e) {
        console.error("WebGPU Load Failed:", e);
        // Fallback or error reporting could go here
    }
})();

self.addEventListener('message', async (event) => {
    const { type, audio, meetingId, speakerId, startTs, chunkId, chunkCreatedAt, chunkDuration } = event.data;

    if (type === 'transcribe') {
        await generate({ audio, meetingId, speakerId, startTs, chunkId, chunkCreatedAt, chunkDuration });
    }
});
