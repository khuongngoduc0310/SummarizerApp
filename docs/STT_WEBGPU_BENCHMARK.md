# WebGPU STT Baseline Benchmark

This benchmark measures the WebGPU Whisper fallback running in the Electron renderer. The renderer is not browser-standalone and must be launched through Electron.

## Status

Benchmark instrumentation is implemented. Actual benchmark numbers must be collected on the target Windows machine because WebGPU and microphone performance depend on local hardware, GPU drivers, and audio devices.

The run is a valid WebGPU baseline only when the application starts with native STT unavailable and the UI reports WebGPU fallback. To force the fallback through supported UI, select an explicit native backend that is not installed, or remove the explicitly selected optional CUDA backend in Settings. Explicit preferences do not silently select another native backend.

Supported way to prepare a run:

- Ensure no downloaded Whisper model is available at Electron startup, or remove downloaded models through the application's STT settings and restart.
- Confirm the UI reports fallback before collecting results.

## What is measured

The exported event stream includes model readiness/load time, chunk duration, inference time, realtime factor, queue latency, caption latency, and dropped-chunk events. The export contains raw events; averages and percentile statistics must be calculated separately.

Events are printed in the Electron dev console as:

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

1. Install all package dependencies.
2. Copy `backend/.env.example` to `backend/.env` if local configuration does not exist.
3. Start PostgreSQL:

   ```bash
   docker compose up -d db
   ```

4. Apply migrations:

   ```bash
   npm --prefix backend run prisma:migrate
   ```

5. Ensure native STT will be unavailable at startup, then launch:

   ```bash
   npm run dev:local
   ```

6. Confirm the Electron UI reports WebGPU fallback. If it reports native STT, stop and correct the setup before collecting a WebGPU baseline.
7. Create a meeting, allow microphone access, and unmute.
8. Open the Electron renderer DevTools and confirm:

   ```text
   [AudioPipeline] Using browser WebGPU STT
   [WebGPU] Ready!
   ```

9. Run each benchmark case.
10. Export the event stream from the renderer console:

   ```js
   window.exportMeetSummarizerSttBenchmarks()
   ```

11. Save the resulting JSON under a local `benchmark-results/` directory, for example:

   ```text
   benchmark-results/webgpu-live-mic.json
   benchmark-results/webgpu-clean-speech.json
   benchmark-results/webgpu-noisy-speech.json
   benchmark-results/webgpu-continuous-speech.json
   ```

12. Record hardware, GPU driver, Electron version, selected model, overlap setting, and whether the first model load used a warm or cold browser cache. Do not mix native and WebGPU results in one export.

## Metrics to compare later against native STT

For each run, calculate from the exported raw events:

- model load time
- average and p95 inference time
- average and p95 realtime factor
- average and p95 queue latency
- average and p95 caption latency
- dropped chunk count
- successful caption-result count

## Compose limitation

Compose is used here only for PostgreSQL. The current Compose backend build is not a supported benchmark startup path; see [Testing](TESTING.md) for details.

## Current decision gate

Native CPU/GPU STT should become default only if it improves one or more of:

- realtime factor
- time to first partial caption
- final caption latency
- dropped chunk count under continuous speech

If native STT does not improve the target machine, keep browser WebGPU or native CPU fallback and show the selected backend in diagnostics.
