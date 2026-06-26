# Plan: Native Device CPU/GPU Speech-to-Text Instead of Browser WebGPU

## Context

MeetSummarizer currently runs speech-to-text in `frontend/src/workers/transcription.worker.js` using Transformers.js Whisper with `device: "webgpu"`. Audio is collected in `frontend/src/hooks/useAudioPipeline.js` into 15-second chunks, then sent to the worker. The desktop shell in `desktop/main.js` already exposes runtime feature flags, and `desktop/preload.js` has a placeholder `window.desktopStt` API.

The goal is to decide whether moving STT from browser WebGPU to native device CPU/GPU will improve performance, then implement the native path if benchmarks prove it is beneficial.

Expected performance impact:

- Native GPU/CPU can improve STT performance, especially by using optimized runtimes such as `whisper.cpp` with Vulkan/CUDA/OpenVINO/CPU SIMD and quantized models.
- The improvement is not guaranteed on every machine. Small models on weak GPUs may perform similarly or worse than browser WebGPU because of process/IPC overhead and backend/runtime mismatch.
- The current 15-second chunk size is a major latency floor. Even a faster native backend will not feel real-time unless the pipeline also moves to shorter rolling windows with VAD and partial/final captions.
- Therefore, the plan should benchmark first, then integrate native STT behind a feature flag with browser WebGPU as fallback.

## Approach

Use `whisper.cpp` as the first native STT engine and run it as a local sidecar process managed by Electron. Start with CPU and Vulkan because they are easier to distribute broadly on Windows than CUDA-only builds. Add CUDA/OpenVINO later if benchmarks justify the packaging complexity.

Recommended backend priority for Windows:

1. Vulkan GPU build, if available and faster on the user's hardware.
2. OpenVINO build for Intel systems, if packaged later.
3. CUDA build for NVIDIA systems, if packaged later.
4. Optimized CPU build using quantized models as reliable fallback.
5. Existing browser WebGPU worker as development/debug fallback.

The native STT path should be selected at runtime based on hardware availability, model availability, benchmark result, and user preference.

## Files to modify

Critical files expected to change during implementation:

- `desktop/main.js` — start/stop STT sidecar, detect backend, expose feature flags.
- `desktop/preload.js` — implement safe `window.desktopStt` IPC methods.
- `frontend/src/hooks/useAudioPipeline.js` — send short PCM frames to native STT in Electron mode; keep browser worker fallback.
- `frontend/src/workers/transcription.worker.js` — keep as fallback, add clearer status/benchmark reporting if needed.
- `frontend/src/App.jsx` — surface runtime STT mode/status and pass config to hooks/UI.
- `backend/index.js` — continue enforcing final-only caption persistence and idempotency.
- New `desktop/stt/` area — sidecar binaries, model metadata, logs, and wrapper code.
- New documentation under README/TESTING for native STT setup and benchmark expectations.

## Reuse

Existing code to reuse instead of replacing:

- `frontend/src/hooks/useAudioPipeline.js` for microphone capture and AudioWorklet setup.
- `frontend/src/workers/audio-processor.js` for frame extraction from the audio graph.
- `desktop/main.js` existing child-process lifecycle pattern from backend startup.
- `desktop/preload.js` existing `window.desktopStt` placeholder API shape.
- `backend/index.js` existing caption persistence flow, with its final-caption/idempotency checks.
- `frontend/src/workers/transcription.worker.js` as browser WebGPU fallback and benchmark baseline.

## Steps

- [ ] Add baseline telemetry to the current WebGPU path: model load time, chunk duration, inference time, realtime factor, dropped chunk count, and end-to-end caption latency.
- [ ] Benchmark current WebGPU with representative audio files and one live microphone session.
- [ ] Add a standalone `whisper.cpp` benchmark script/process outside the app for CPU and Vulkan on the same audio samples.
- [ ] Compare native CPU/Vulkan against browser WebGPU using the same model size or closest equivalent quantized model.
- [ ] Decide default native backend only after benchmark results show better realtime factor or lower latency on target Windows hardware.
- [ ] Add `desktop/stt/` sidecar launcher and backend detection in Electron main process.
- [ ] Implement preload IPC methods: `getStatus`, `sendAudioFrame`, `onTranscript`, `setModel`, `setBackend`, and `stop`.
- [ ] Change `useAudioPipeline.js` to use native STT when `window.desktopStt` is available and `runtimeConfig.features.nativeStt` is true.
- [ ] Reduce audio handling from 15-second chunks to short frames plus rolling inference windows.
- [ ] Add VAD, configurable overlap handling, partial/final transcript events, and duplicate suppression before emitting final captions.
- [ ] Emit only final, de-duplicated captions through existing `socket.emit('caption', ...)`; display partials locally or through a non-persisted event.
- [ ] Keep browser WebGPU fallback if native STT fails to start or performs worse than threshold.
- [ ] Add settings/diagnostics UI showing selected backend, model, realtime factor, overlap duration, window size, step size, and fallback reason.
- [ ] Package only the CPU build first, then add Vulkan once the packaging path is stable.

## Verification

Benchmark checks:

- Compare browser WebGPU vs native CPU vs native Vulkan on identical audio.
- Track realtime factor; target is below `1.0` for continuous transcription.
- Track time to first partial caption; target is 1-2 seconds.
- Track time to final caption; target is 2-4 seconds.
- Track CPU/GPU utilization and memory usage.
- Track duplicate caption rate with overlapped windows.

Functional checks:

- Electron launches and reports selected STT backend.
- Native STT failure falls back to browser WebGPU with a visible status.
- Captions still appear in the existing transcript panel.
- Partial captions are not persisted as transcript rows.
- Final captions are persisted exactly once using `utteranceId`/idempotency.
- STT settings can adjust overlap duration and apply the change to new rolling windows.
- Closing Electron stops backend and STT child processes.

Decision rule:

- Proceed with native STT as the default only if it improves latency or realtime factor on target Windows hardware without unacceptable packaging complexity.
- If native GPU does not beat browser WebGPU on a given machine, use native CPU or browser WebGPU fallback and show the selected mode clearly to the user.
