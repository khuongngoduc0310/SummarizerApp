# Native STT Benchmark Area

This folder contains the native STT sidecar, binary setup helpers, and CPU/GPU benchmark tooling used by the Electron app.

## Goal

Measure `whisper.cpp` CPU, Vulkan, and CUDA accuracy, throughput, and final-caption latency on reproducible datasets. Compare native backends with each other and with browser WebGPU only when the input, model, and measurement conditions are equivalent.

## Expected layout

```text
desktop/stt/
├─ benchmark-whisper.cpp.js
├─ prepare-ami-benchmark.js
├─ benchmark-datasets/
│  ├─ ami-ihm-quick.json
│  └─ ami-ihm-release.json
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

Build or download `whisper.cpp` from the official project:

```text
https://github.com/ggml-org/whisper.cpp
```

Official releases usually include Windows CPU/BLAS/CUDA binaries, but may not include a Windows Vulkan artifact. For Vulkan, use the local build helper:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/stt/setup-vulkan-whisper.ps1 -InstallPrereqs
```

If prerequisites are already installed, omit `-InstallPrereqs`:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/stt/setup-vulkan-whisper.ps1
```

Prerequisites for Vulkan builds:

- CMake
- Visual Studio Build Tools with Desktop development with C++
- Vulkan SDK
- Git

Recommended first binaries:

- CPU build: reliable fallback for all Windows users.
- Vulkan build: cross-vendor GPU test path for NVIDIA/AMD/Intel.
- CUDA 11.8 build: optional NVIDIA Windows x64 runtime installed from Settings.

## Optional CUDA backend

The application catalog pins the official `whisper.cpp v1.9.1` Windows x64 CUDA 11.8 asset, its exact byte size, and SHA-256 digest. Settings downloads the 266 MiB archive into a temporary user-data staging directory, verifies it before parsing, selectively extracts the required runtime files, validates `whisper-cli.exe`, and atomically activates the approximately 594 MiB installation under:

```text
<Electron userData>/stt/backends/whisper-cpp-cuda-11.8-windows-x64/v1.9.1/
```

At least 1.2 GB free space is required during installation. Downloads can be cancelled, and interrupted staging data is removed on the next launch. CUDA is not copied into the Electron installer. See `desktop/THIRD_PARTY_NOTICES.md` for upstream and NVIDIA notices.

Recommended first model:

- `base.en` or `base.en` quantized, for example `q5_0`.

## Benchmark inputs and modes

The benchmark accepts either `--samples` for one audio file or a flat directory of audio files, or `--manifest` for a reproducible dataset with references. Manifest audio and reference paths are resolved relative to the manifest:

```json
{
  "schemaVersion": 1,
  "dataset": { "name": "local-smoke" },
  "samples": [
    {
      "id": "sample-1",
      "audio": "audio/sample-1.wav",
      "reference": "references/sample-1.txt"
    }
  ]
}
```

Every manifest sample must have a reference. With `--samples`, use `--references` to select one reference file for one sample or a directory containing matching `<audio-name>.txt` files.

Available modes:

| Mode | Behavior |
| --- | --- |
| `offline` | Invokes `whisper-cli` once with the complete sample. This is the default for compatibility with older commands. |
| `streaming` | Sends 100 ms Float32 frames through the production sidecar and collects final caption events. |
| `both` | Runs offline and streaming paths against each sample and reports both hypotheses and metric sets. |

Streaming requires mono 16 kHz 16-bit PCM WAV. Offline mode can pass supported non-WAV formats to `whisper-cli`; WAV input must be 16-bit PCM so its duration can be parsed.

## Prepare AMI data

The quick profile has a PowerShell downloader that fetches AMI manual annotations v1.6.2 and only the twelve required individual headset channels. Run it from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-ami-quick.ps1
```

When `-Destination` is omitted, the script prompts for a dataset location and offers `C:\datasets\AMI` as the default. For non-interactive use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-ami-quick.ps1 `
  -Destination "D:\Datasets\AMI"
```

Interrupted `.part` downloads resume on the next run. Existing completed files are skipped; use `-Force` to download them again. The script verifies the annotation layout, required word files, and RIFF/WAVE headers before printing the preparation command.

For custom profiles or an existing AMI download, the AMI root must contain `corpusResources/meetings.xml`, the selected `*.words.xml` files, and the selected `*.Headset-<channel>.wav` files. The preparer indexes these files recursively.

From the repository root, prepare the quick profile with the desktop package script. Arguments are resolved from `desktop/`:

```bash
npm --prefix desktop run benchmark:prepare-ami -- \
  --ami-root C:/datasets/AMI \
  --profile quick \
  --out stt/samples/ami-ihm-quick
```

Use `--profile release` and a separate output directory for the release profile. `--profile` also accepts a custom profile JSON path.

| Profile | Scope | Intended use |
| --- | --- | --- |
| `quick` | Twelve fixed five-minute clips, one hour total, across selected AMI evaluation submeetings and headset channels. | Iteration and cross-backend comparisons. |
| `release` | Sixteen complete evaluation submeetings, using one rotating headset channel per submeeting. | Release-candidate measurement. |

Preparation writes canonical streaming WAV files, lexical reference text files, and `manifest.json` under the selected output directory. These generated AMI artifacts are local and are not committed.

## Run a manifest benchmark

The runner is dataset-agnostic; AMI is only the supplied reference profile. This example runs both paths with representative streaming pacing:

```bash
npm --prefix desktop run benchmark:whisper -- \
  --binary stt/bin/vulkan/whisper-cli.exe \
  --model stt/models/ggml-base.en-q5_0.bin \
  --manifest stt/samples/ami-ihm-quick/manifest.json \
  --mode both \
  --pace realtime \
  --backend vulkan \
  --out ../benchmark-results/native-ami-quick-vulkan.json \
  --transcripts-dir ../benchmark-results/transcripts/native-ami-quick-vulkan
```

Use the CPU binary with `--backend cpu` for a CPU run. For CUDA, select the downloaded `whisper-cli.exe` under Electron user data and pass `--backend cuda`. Use `--pace realtime` for streaming latency measurements: frames are scheduled according to media time, so the quick profile takes about one hour plus processing and flush overhead. `--pace fast` writes frames as quickly as possible and is useful for smoke or overload testing, but its first-caption and caption-lag values are intentionally unavailable and it is not latency-representative.

For an ad hoc offline run without a manifest:

```bash
npm --prefix desktop run benchmark:whisper -- \
  --binary stt/bin/cpu/whisper-cli.exe \
  --model stt/models/ggml-base.en-q5_0.bin \
  --samples stt/samples \
  --mode offline \
  --backend cpu \
  --out ../benchmark-results/native-cpu.json
```

## Validate and run Vulkan benchmark

Copy a Vulkan-enabled `whisper.cpp` build into `desktop/stt/bin/vulkan/`. On Windows, keep `whisper-cli.exe` and `ggml-vulkan.dll` in the same folder. Electron will only mark Vulkan available when those files exist.

Quick validation against one WAV sample:

```bash
node desktop/stt/validate-vulkan.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model desktop/stt/models/ggml-base.en.bin \
  --sample desktop/stt/samples/clean.wav \
  --out benchmark-results/vulkan-validation.json
```

After validation, use the generic manifest runner above with the Vulkan binary.

## Streaming flush behavior

After sending the final audio frame, the runner sends a `flush` request and waits for the matching `flushed` acknowledgment before stopping the sidecar. The sidecar waits for an in-flight inference and forces one final inference when new samples arrived after the previous inference and at least 300 ms of audio remains in its retained window. The acknowledgment records received and processed sample positions plus final, error, VAD-skip, buffer-overflow, coalesced-inference, duplicate-suppression, and overlap-trim counts.

A streaming sample is successful only when the flush succeeds, no sidecar or protocol error was observed, `totalSamplesReceived` matches the number sent, `pendingSamples` and `uncoveredSamples` are zero, and no unprocessed buffer overflow occurred.

## Reports, transcripts, and metrics

`--out` writes a JSON report atomically after each sample and again at completion. It contains dataset and artifact hashes, run configuration, host details, per-sample hypotheses, raw streaming finals and telemetry, flush counters, and aggregate results. `--transcripts-dir` additionally writes successful hypotheses as `<sample-id>.offline.txt` and `<sample-id>.streaming.txt`.

WER is calculated after Unicode normalization, lowercasing, removal of bracketed and parenthesized annotations, AMI-style truncated tokens and selected non-lexical symbols, punctuation removal, and whitespace collapse. For each sample and for the corpus aggregate:

```text
WER = (substitutions + deletions + insertions) / reference words
```

The aggregate WER sums error and reference-word counts across samples; it is not an average of sample WER values. Lower is better, `0.10` means 10%, and WER can exceed `1.0` when insertions are numerous.

Performance fields include offline elapsed time and realtime factor; streaming sidecar readiness, time to first caption, caption lag, per-window inference time and realtime factor, compute load factor, feed-schedule lateness, backpressure, flush latency, and end-to-end completion time. A realtime or compute factor below `1.0` indicates faster-than-realtime compute, but does not by itself prove low caption latency or lossless streaming. See [Native STT WER Benchmark](../../docs/STT_NATIVE_WER_BENCHMARK.md) for the complete procedure and interpretation.

## Electron integration

When both of these files exist, Electron will try to start native STT automatically:

```text
desktop/stt/bin/cpu/whisper-cli.exe
desktop/stt/models/<any .bin or .gguf model>
```

With `Auto`, Electron validates available backends in CUDA, Vulkan, CPU order. The Vulkan development layout is:

```text
desktop/stt/bin/vulkan/whisper-cli.exe
desktop/stt/bin/vulkan/ggml-vulkan.dll
```

Settings persists `Auto`, CUDA, Vulkan, or CPU preference in Electron user data. Explicit choices are strict: if that backend fails validation, native STT becomes unavailable and the renderer uses WebGPU instead of silently selecting a different native backend. Runtime fallback is best effort and may lose a short audio interval while the engine changes.

The Electron main process starts:

```text
<Electron executable> desktop/stt/whisper-streaming-sidecar.js --binary <whisper-cli> --model <model>
```

The renderer sends 100ms Float32 PCM frames through `window.desktopStt.sendAudioFrame(...)`. The sidecar uses a rolling window and emits JSON-lines `final` transcript events back to Electron.

Current sidecar and benchmark limitations:

- Emits final events only; partial captions can be added later.
- Uses temporary WAV files and invokes `whisper-cli` per rolling window, which is simple but not the fastest possible implementation.
- Uses heuristic overlap trimming and text de-duplication, which directly affect streaming WER.
- The benchmark flushes its final buffered tail. The Electron meeting teardown path does not currently issue that flush, so live end-of-meeting tail handling remains a separate product limitation.
- Streaming accepts only mono 16 kHz 16-bit PCM WAV and simulates one speaker/session at a time; it does not benchmark diarization or overlapping speakers.
- The supplied AMI profiles use one individual headset channel and its speaker reference per submeeting. They do not represent distant microphones, arbitrary room noise, or the complete range of production meeting audio.
- Realtime results depend on the local binary build, model, hardware, drivers, power state, and background load. Compare runs only when these are controlled.
- Generated corpus data, transcripts, and reports are intentionally local. No benchmark measurements are committed to the repository.

## Compare with WebGPU

Compare these native reports with the JSON exported by the [browser WebGPU baseline](../../docs/STT_WEBGPU_BENCHMARK.md):

```js
window.exportMeetSummarizerSttBenchmarks()
```

Key decision metrics:

- realtime factor below `1.0`
- lower caption latency than browser WebGPU
- no dropped speech during continuous audio
- acceptable CPU/GPU usage

If native CUDA or Vulkan is slower or unstable on a machine, keep CPU or browser WebGPU fallback.
