# WebGPU STT Baseline Benchmark

This benchmark captures the current browser WebGPU transcription performance before native CPU/GPU STT is enabled.

## Status

Benchmark instrumentation is implemented. Actual benchmark numbers must be collected on the target Windows machine because WebGPU and microphone performance depend on local hardware, browser/GPU drivers, and audio devices.

## What is measured

The current WebGPU path logs and stores:

- model load time
- chunk duration
- inference time
- realtime factor
- dropped chunk count
- queue latency
- end-to-end caption latency

Events are printed in the browser/Electron dev console as:

```text
[STT Telemetry] ...
[STT Baseline] ...
```

Events are also stored in:

```js
window.__MEETSUMMARIZER_STT_BENCHMARKS__
```

Export them from the dev console with:

```js
window.exportMeetSummarizerSttBenchmarks()
```

## Required benchmark runs

Run at least these cases:

| Case | Input | Duration | Notes |
| --- | --- | ---: | --- |
| Live mic | User speaks normally | 3-5 min | Real meeting-like cadence |
| Clean recorded speech | WAV/MP3 played through virtual mic or speaker loopback | 5 min | Representative single-speaker audio |
| Noisy speech | WAV/MP3 with background noise | 5 min | Coffee shop/fan/keyboard noise |
| Continuous speech | Long monologue/podcast sample | 5 min | Stress dropped chunk behavior |

No sample audio files are currently committed to this repo. Use local non-sensitive samples or public-domain speech samples.

## Procedure

1. Start database services:

   ```bash
   docker compose up -d db redis
   ```

2. Start backend:

   ```bash
   cd backend
   npm run dev
   ```

3. Start frontend:

   ```bash
   cd frontend
   npm run dev
   ```

4. Open `http://localhost:5173` in Chrome/Edge with WebGPU enabled.

5. Create a meeting, allow microphone permission, and unmute.

6. For each benchmark case, speak or play the sample audio for the target duration.

7. Open dev tools console and export results:

   ```js
   window.exportMeetSummarizerSttBenchmarks()
   ```

8. Save the downloaded JSON file under a local benchmark-results folder, for example:

   ```text
   benchmark-results/webgpu-live-mic.json
   benchmark-results/webgpu-clean-speech.json
   benchmark-results/webgpu-noisy-speech.json
   benchmark-results/webgpu-continuous-speech.json
   ```

## Metrics to compare later against native STT

For each run calculate:

- average realtime factor
- p95 realtime factor
- average inference time
- p95 inference time
- average caption latency
- p95 caption latency
- total dropped chunks
- duplicate/suppressed captions, once duplicate suppression exists

## Current decision gate

Native CPU/GPU STT should become default only if it improves one or more of:

- realtime factor
- time to first partial caption
- final caption latency
- dropped chunk count under continuous speech

If native STT does not improve the target machine, keep browser WebGPU or native CPU fallback and show the selected backend in diagnostics.
