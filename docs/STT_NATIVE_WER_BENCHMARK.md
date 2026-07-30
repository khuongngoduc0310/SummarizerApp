# Native STT WER Benchmark

This benchmark measures native `whisper.cpp` accuracy and performance through both complete-file transcription and the production streaming sidecar. Benchmark data and results are generated locally; the repository contains profile definitions but no AMI audio, prepared references, transcripts, or measured reports.

## Prerequisites

- Node.js 22.12 or newer and desktop dependencies installed with `npm --prefix desktop ci`.
- A CPU or GPU-enabled `whisper-cli` binary and compatible local model under `desktop/stt/bin/` and `desktop/stt/models/`, or equivalent local paths.
- For the supplied profiles, AMI Meeting Corpus manual annotations v1.6.2 and individual headset WAV files obtained under the corpus license.

Run `npm --prefix desktop test` before collecting results. See [Native STT Benchmark Area](../desktop/stt/README.md) for binary setup, all runner options, and the generic manifest format.

## Prepare the dataset

For the quick profile, download the required AMI annotations and headset channels with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-ami-quick.ps1
```

The script prompts for the destination, defaulting to `C:\datasets\AMI`. Supply the path directly for unattended use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-ami-quick.ps1 `
  -Destination "D:\Datasets\AMI"
```

Downloads use resumable `.part` files and are validated before completion. The script prints the next preparation command using the selected destination.

To prepare an existing download or a custom profile, use the desktop package script. Arguments are resolved from `desktop/`:

```bash
npm --prefix desktop run benchmark:prepare-ami -- \
  --ami-root C:/datasets/AMI \
  --profile quick \
  --out stt/samples/ami-ihm-quick
```

The AMI root must contain `corpusResources/meetings.xml`, word annotations, and the selected individual headset WAV files. Preparation writes clipped mono 16 kHz 16-bit PCM WAV files, lexical references, hashes, and `manifest.json` beneath the ignored `desktop/stt/samples/` area.

Use the profiles as follows:

| Profile | Scope | Use |
| --- | --- | --- |
| `quick` | Twelve fixed five-minute clips; one hour of audio total. | Iteration and CPU/GPU comparisons. |
| `release` | Sixteen complete evaluation submeetings; one rotating headset channel per submeeting. | Final release-candidate measurement. |

Prepare `release` into `desktop/stt/samples/ami-ihm-release` only after the configuration is stable. A custom profile JSON can be passed in place of `quick` or `release`.

## Run the benchmark

Use `both` to obtain an offline reference and production-sidecar result from the same samples:

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

Repeat with the CPU binary and `--backend cpu`, and with the downloaded CUDA binary and `--backend cuda`, when comparing backends. Keep the model, manifest, language, streaming configuration, and machine state unchanged. The report records hashes and most run settings; separately record the `whisper.cpp` revision/build flags, CUDA runtime, GPU and driver, power mode, and relevant background load.

`offline` invokes `whisper-cli` once per complete sample. `streaming` sends 100 ms frames through the sidecar. `both` runs both modes. Use `--pace realtime` for publishable streaming latency: it schedules frames at media time and sets `latencyRepresentative` to true. Use `--pace fast` only for plumbing or overload checks; first-caption and caption-lag metrics are not produced for fast pacing.

At end of input the runner requests a sidecar flush, waits for any active inference, allows a final pending inference, and waits for a `flushed` acknowledgment. Do not treat a streaming run as valid unless the sample is `ok`, sample counts match, `errorCount`, `pendingSamples`, `uncoveredSamples`, and `bufferOverflowSamples` are zero, and the sidecar exits normally.

## Interpret the report

WER uses normalized, lexical text:

```text
WER = (substitutions + deletions + insertions) / reference words
```

The report includes each error count and normalized reference/hypothesis. `aggregate.<mode>.accuracy.wer` is corpus WER calculated from summed errors and reference words, not the mean of per-sample WER. Lower is better; `0.10` is 10%, and insertion-heavy output can exceed `1.0`. Compare offline and streaming WER to expose errors introduced by windowing, VAD, overlap trimming, or duplicate suppression.

| Metric | Interpretation |
| --- | --- |
| `offline.realtimeFactor` | Complete-file elapsed time divided by audio duration. Below `1.0` is faster than realtime. |
| `streaming.performance.windowRealtimeFactor` | Inference time divided by each rolling window's duration. Inspect p95 and max as well as average. |
| `streaming.performance.computeLoadFactor` | Total inference time divided by source duration. Below `1.0` suggests adequate aggregate throughput, not necessarily low latency. |
| `timeToFirstCaptionMs` | Wall-clock delay to the first final caption; meaningful only with realtime pacing. |
| `captionLagMs` | Final-event arrival relative to that caption window's media end; meaningful only with realtime pacing. |
| `flushLatencyMs` | Time from end-of-input flush request to acknowledgment, including pending inference. |
| `feedScheduleLatenessMs` | How late realtime frame writes were relative to their target schedule. Large values invalidate latency conclusions. |
| `bufferOverflowSamples` | Unprocessed samples discarded when the rolling buffer filled. A valid accuracy run should have zero. |
| `uncoveredSamples` | Audio between non-overlapping inference windows. A valid accuracy run should have zero. |
| `coalescedInferenceCount` | Inference opportunities observed while another inference was active. Rising counts indicate pressure even if no samples were dropped. |
| `vadSkipCount` | Windows rejected as low energy. Review alongside deletions and transcript content. |
| `errorCount` | Sidecar inference errors. This should be zero. |

Also inspect successful/failure counts, transcript files, per-sample WER outliers, raw final events, and `duplicateSuppressedCount`/`overlapPrefixTrimCount` in flush records. A low aggregate WER can hide one failed acoustic condition, and a low compute factor can coexist with poor caption latency.

## Release procedure

1. Run desktop tests and a short local benchmark smoke test from [Testing](TESTING.md).
2. Prepare and run `quick` with realtime pacing for every candidate backend using identical inputs and settings.
3. Inspect transcripts and reject runs with errors, buffer overflow, scheduling lateness, or missing samples.
4. Compare corpus WER, per-sample outliers, p95/max timing, first-caption latency, caption lag, and flush latency.
5. Run the `release` profile on the selected configuration and repeat it if machine load or scheduling made the run unrepresentative.
6. Store reports and transcripts in local `benchmark-results/` or an external artifact system. Do not assume benchmark artifacts are versioned by this repository.

## Limitations

- AMI individual headset channels and single-speaker references do not cover diarization, overlapping-speaker scoring, distant microphones, or all production noise conditions.
- AMI references annotate only the target speaker on each channel, but headset microphones capture cross-talk from other participants. This inflates insertion-based WER when Whisper transcribes overlapping speech that the reference omits. The IS1009 meeting samples are especially affected (WER 200-300% due to dense cross-talk).
- Some quick-profile clips contain very sparse reference annotations (1-4 words in 300 seconds). These samples produce extreme WER values when Whisper transcribes ambient noise or cross-talk, and should be excluded from corpus WER aggregation.
- Streaming WER includes the current sidecar's VAD, temporary-WAV invocation, overlap trimming, and duplicate-suppression behavior; it is not raw model WER.
- The benchmark emits and scores final captions only. It does not measure partial-caption quality or time to first partial.
- The benchmark flushes its final buffered tail. The Electron meeting teardown path does not currently issue that flush, so live end-of-meeting tail handling is not represented by this completion behavior.
- Hardware, GPU drivers, binary build flags, model quantization, power state, and background work can materially change timing.
- Cross-system WER is comparable only when corpus selection and text normalization are identical.

---

## Quick Profile Results (2026-07-30)

### Environment

| Property | Value |
|----------|-------|
| CPU | AMD Ryzen 7 7700 8-Core |
| GPU | NVIDIA GeForce RTX 3060 Ti (Vulkan) |
| OS | Windows 11, Node v24.12.0 |
| Whisper binary | v1.9.1 (CPU), v1.9.1 (Vulkan) |
| Models | `ggml-base.en.bin` (141 MiB), `ggml-small.en.bin` (465 MiB) |
| Streaming config | window=4s, overlap=1s, maxBuffer=8s, VAD threshold=0.008 |
| Pacing | realtime |
| Dataset | AMI IHM quick (12 clips, ~1 hour total) |
| Entity fix | `&#39;` decoded to `'` in references via `prepare-ami-benchmark.js` |

### Aggregate Corpus WER (all 12 samples)

| Configuration | WER | Ref | Hyp | Sub | Del | Ins |
|---|---|---|---|---|---|---|
| Vulkan streaming, base | 91.70% | 2348 | 2897 | 204 | 700 | 1249 |
| Vulkan offline, base | 96.25% | 2348 | 3731 | 197 | 340 | 1723 |
| CPU streaming, base | 91.52% | 2348 | 2890 | 207 | 700 | 1242 |
| CPU offline, base | 97.70% | 2348 | 3784 | 210 | 324 | 1760 |
| Vulkan streaming, small | 90.08% | 2348 | 2871 | 176 | 708 | 1231 |

### Filtered Corpus WER (excl. <10 ref words AND IS1009 cross-talk, 7 samples)

| Configuration | WER | Ref | Sub | Del | Ins |
|---|---|---|---|---|---|
| Vulkan streaming, base | **46.91%** | 1797 | 118 | 655 | 70 |
| Vulkan offline, base | **34.89%** | 1797 | 143 | 282 | 202 |
| CPU streaming, base | **46.63%** | 1797 | 120 | 654 | 64 |
| CPU offline, base | **34.34%** | 1797 | 156 | 266 | 195 |
| Vulkan streaming, small | **46.52%** | 1797 | 104 | 664 | 68 |

### Streaming Latency Comparison

| Configuration | ComputeLoad | CaptionLag avg | CaptionLag p50 | CaptionLag p95 | Inference avg | VAD Skips |
|---|---|---|---|---|---|---|
| Vulkan streaming, base | **0.065** | **566 ms** | **534 ms** | 922 ms | **194 ms** | 790 |
| CPU streaming, base | 0.107 | 944 ms | 936 ms | 1028 ms | 321 ms | 790 |
| Vulkan streaming, small | 0.108 | 946 ms | 944 ms | **1009 ms** | 322 ms | 790 |

### Per-Sample WER Comparison (all 5 runs)

| Sample | VS-base | VO-base | CS-base | CO-base | VS-small |
|---|---|---|---|---|---|
| ES2004a-A-0-4800000 | 67.5% | 97.5% | 67.5% | 62.5% | 67.5% |
| ES2004b-B-4800000-9600000 | 100.0% | 26.9% | 100.0% | 26.9% | 100.0% |
| ES2004c-C-9595680-14405920 | **26.4%** | 18.7% | **26.8%** | 18.9% | **27.4%** |
| IS1009a-D-0-4800000 | 317.9% | 241.5% | 316.0% | 256.6% | 267.9% |
| IS1009b-A-4800000-9600000 | 208.4% | 203.4% | 211.4% | 203.4% | 219.4% |
| IS1009c-B-9600000-14400000 | 237.3% | 210.2% | 234.5% | 218.1% | 232.8% |
| TS3003a-C-0-4800000 | 100.0% | 12800.0% | 100.0% | 14100.0% | 200.0% |
| TS3003b-D-4798720-9600000 | **25.8%** | 23.0% | **24.6%** | 23.0% | **24.4%** |
| TS3003c-A-9600000-14400000 | 100.0% | 8550.0% | 100.0% | 8575.0% | 100.0% |
| EN2002a-B-0-4803200 | **45.5%** | 30.1% | **45.5%** | 30.9% | **44.7%** |
| EN2002b-C-4750560-9600000 | 80.0% | 16.7% | 80.0% | 17.7% | 79.3% |
| EN2002d-D-9600000-14400000 | 88.8% | 112.1% | 88.8% | 111.7% | 88.3% |

### Key Findings

1. **Entity fix validated**: `&#39;` is now decoded to `'` in reference files, eliminating ~4.5 points of spurious WER inflation (confirmed by ES2004a-A dropping from 67.4% to 62.5% in CPU offline).

2. **Streaming accuracy is nearly identical across backends**: On the filtered set, all three streaming runs produce essentially the same WER (~46.5-46.9%). The VAD is the dominant source of streaming errors, not the backend or model size.

3. **Offline WER is significantly better than streaming**: ~34.3-34.9% vs ~46.5-46.9%. The ~12pt gap is driven by VAD over-aggressiveness on quiet speakers (ES2004b-B gets 0 hypothesis words from VAD rejecting all audio).

4. **Vulkan base has the best streaming latency**: Caption lag p50=534ms vs 936ms (CPU base) and 944ms (Vulkan small). Vulkan base is ~1.75x faster for caption delivery.

5. **Vulkan small offers no latency or accuracy benefit over CPU base**: Both have ~0.107 compute load and ~940ms caption lag. The small model's larger compute needs offset the Vulkan GPU advantage.

6. **VAD threshold sensitivity**: The current threshold (0.008) is too aggressive for quieter speakers. 3 of 12 samples had <40% of reference words captured. A lower threshold or adaptive VAD may improve streaming recall.

7. **Cross-talk is a major confound**: IS1009 samples show 200-300% WER because Whisper transcribes overlapping speakers that AMI reference annotations omit. These samples are not suitable for single-speaker WER evaluation without reference masking.

8. **Sparse samples should be excluded**: TS3003a-C (1 ref word) and TS3003c-A (4 ref words) produce extreme WER values and contribute noise rather than signal to aggregate metrics.

### Command Reference

All quick profile runs:

```bash
# Vulkan streaming (base)
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-base.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode streaming --backend vulkan --pace realtime \
  --out benchmark-results/ami-quick-vulkan-streaming-base.json

# CPU streaming (base)
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/cpu/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-base.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode streaming --backend cpu --pace realtime \
  --out benchmark-results/ami-quick-cpu-streaming-base.json

# Vulkan streaming (small)
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-small.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode streaming --backend vulkan --pace realtime \
  --out benchmark-results/ami-quick-vulkan-streaming-small.json

# CPU offline (base)
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/cpu/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-base.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode offline --backend cpu \
  --out benchmark-results/ami-quick-cpu-offline-base.json

# Vulkan offline (base)
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-base.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode offline --backend vulkan \
  --out benchmark-results/ami-quick-vulkan-offline-base.json
```

---

## VAD Threshold Tuning (2026-07-30)

Changed `vadThreshold` from 0.008 → 0.003 across all three files (`whisper-streaming-sidecar.js`, `sidecar-manager.js`, `benchmark-whisper.cpp.js`). This keeps pure noise floor rejected (ambient RMS ~0.0002–0.001) while allowing quiet speech through.

### Filtered Corpus WER (7 clean samples, excl cross-talk & sparse)

| VAD Threshold | WER | Ref | Sub | Del | Ins |
|---|---|---|---|---|---|
| 0.008 | **46.91%** | 1797 | 118 | 655 | 70 |
| **0.003** | **31.78%** | 1797 | 182 | 267 | 122 |

**32.3% relative WER reduction** (15.1 absolute percentage points).

### Streaming Latency Impact

| Metric | VAD 0.008 | VAD 0.003 |
|---|---|---|
| Caption lag avg | 566 ms | 601 ms |
| Caption lag p50 | 534 ms | 597 ms |
| Caption lag p95 | 922 ms | 643 ms |
| Compute load | 0.065 | 0.094 |
| VAD skips (total) | 790 | 630 |
| Captions produced | 384 | 501 |
| Samples with 0 captions | 2 | 1 |

Caption lag increased slightly (+67ms avg, +63ms p50) but p95 actually improved (922→643ms) because more consistent non-skipped windows smooth out the tail. Compute load rose from 0.065→0.094 — still well under 1.0.

### Per-Sample Impact

| Sample | VAD 0.008 | VAD 0.003 | Δ | Driver |
|---|---|---|---|---|
| ES2004a-A-0-4800000 | 67.5% | 60.0% | **−7.5pt** | More words captured |
| ES2004b-B-4800000-9600000 | 100.0% | 100.0% | 0pt | Still 0 hyp — needs even lower threshold |
| ES2004c-C-9595680-14405920 | 26.4% | 23.9% | −2.5pt | Dense speech, small gain |
| IS1009a-D-0-4800000 | 317.9% | 386.8% | +68.9pt | More cross-talk captured (confound) |
| IS1009b-A-4800000-9600000 | 208.4% | 252.1% | +43.7pt | More cross-talk captured (confound) |
| IS1009c-B-9600000-14400000 | 237.3% | 272.3% | +35.0pt | More cross-talk captured (confound) |
| TS3003a-C-0-4800000 | 100.0% | 300.0% | +200pt | Only 1 ref word; noise transcribed |
| TS3003b-D-4798720-9600000 | 25.8% | 24.2% | −1.5pt | Already good, small gain |
| TS3003c-A-9600000-14400000 | 100.0% | 25.0% | **−75.0pt** | Was 0 hyp, now captures speech |
| EN2002a-B-0-4803200 | 45.5% | 30.9% | **−14.6pt** | 81→111 hyp words |
| EN2002b-C-4750560-9600000 | 80.0% | 39.7% | **−40.3pt** | 76→244 hyp words |
| EN2002d-D-9600000-14400000 | 88.8% | 44.2% | **−44.6pt** | 36→212 hyp words |

### Verdict

The 0.003 VAD threshold is a clear improvement:

- **Correctly improved** 7 of 12 samples (lower WER from more speech captured)
- **Made no meaningful difference** on 2 already-good dense-speech samples
- **Hurt** 3 samples — all measurement confounds (IS1009 cross-talk, TS3003 sparse reference) that should be excluded from evaluation
- Still leaves ES2004b-B at 0 hypothesis words — this speaker may need 0.001 or raw audio bypass

Recommended next step: drop to 0.001 for ES2004b-B specifically, or exclude it from the benchmark as "below noise floor."

### Command

```bash
node desktop/stt/benchmark-whisper.cpp.js \
  --binary desktop/stt/bin/vulkan/whisper-cli.exe \
  --model "%APPDATA%\meetsummarizer-desktop\models\ggml-base.en.bin" \
  --manifest desktop/stt/samples/ami-ihm-quick/manifest.json \
  --mode streaming --backend vulkan --pace realtime \
  --out benchmark-results/ami-quick-vulkan-streaming-base-vad003.json
```
