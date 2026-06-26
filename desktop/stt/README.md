# Native STT Benchmark Area

This folder is for native device CPU/GPU speech-to-text experiments before native STT is wired into the Electron app.

## Goal

Benchmark `whisper.cpp` CPU and Vulkan on the same audio used for the browser WebGPU baseline. Native STT should become the default only if it improves realtime factor or latency on the target Windows hardware.

## Expected layout

```text
desktop/stt/
├─ benchmark-whisper.cpp.js
├─ bin/
│  ├─ cpu/whisper-cli.exe
│  └─ vulkan/whisper-cli.exe
├─ models/
│  └─ ggml-base.en-q5_0.bin
├─ sidecar-manager.js
├─ whisper-streaming-sidecar.js
└─ samples/
   ├─ clean.wav
   ├─ noisy.wav
   └─ continuous.wav
```

The `bin/`, `models/`, and `samples/` folders are intentionally not committed by default because binaries, models, and audio can be large.

## Getting whisper.cpp

Build or download `whisper.cpp` from:

```text
https://github.com/ggml-org/whisper.cpp
```

Recommended first binaries:

- CPU build: reliable fallback for all Windows users.
- Vulkan build: cross-vendor GPU test path for NVIDIA/AMD/Intel.

Recommended first model:

- `base.en` or `base.en` quantized, for example `q5_0`.

## Run CPU benchmark

From repo root:

```bash
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/cpu/whisper-cli.exe \
  --model desktop/stt/models/ggml-base.en-q5_0.bin \
  --samples desktop/stt/samples \
  --backend cpu \
  --out benchmark-results/native-cpu.json
```

## Run Vulkan benchmark

```bash
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model desktop/stt/models/ggml-base.en-q5_0.bin \
  --samples desktop/stt/samples \
  --backend vulkan \
  --out benchmark-results/native-vulkan.json
```

## Electron integration

When both of these files exist, Electron will try to start native STT automatically:

```text
desktop/stt/bin/cpu/whisper-cli.exe
desktop/stt/models/<any .bin or .gguf model>
```

If a Vulkan binary is also present, it is preferred:

```text
desktop/stt/bin/vulkan/whisper-cli.exe
```

The Electron main process starts:

```text
node desktop/stt/whisper-streaming-sidecar.js --binary <whisper-cli> --model <model>
```

The renderer sends 100ms Float32 PCM frames through `window.desktopStt.sendAudioFrame(...)`. The sidecar uses a rolling window and emits JSON-lines `final` transcript events back to Electron.

Current sidecar limitations:

- Emits final events only; partial captions can be added later.
- Uses temporary WAV files and invokes `whisper-cli` per rolling window, which is simple but not the fastest possible implementation.
- Uses simple text de-duplication. More robust local-agreement stabilization should be added after basic CPU/Vulkan integration works.

## Compare with WebGPU

Compare these native reports with the JSON exported by the browser WebGPU baseline:

```js
window.exportMeetSummarizerSttBenchmarks()
```

Key decision metrics:

- realtime factor below `1.0`
- lower caption latency than browser WebGPU
- no dropped speech during continuous audio
- acceptable CPU/GPU usage

If native Vulkan is slower or unstable on a machine, keep CPU or browser WebGPU fallback.
