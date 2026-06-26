# Plan: Turn MeetSummarizer Into a Hardware-Accelerated Executable App

## Objective

Turn the current web application into a desktop executable primarily to improve real-time speech-to-text performance by using native hardware acceleration instead of browser WebGPU.

The executable app should:

- Capture meeting audio locally.
- Run speech-to-text on the user's hardware with native inference backends.
- Keep audio private and local.
- Emit low-latency captions into the existing meeting/caption flow.
- Preserve the current React meeting UI and backend meeting logic where practical.
- Package as a user-friendly desktop app, starting with Windows.

## Current State

The project currently has:

- `frontend/`: React + Vite meeting UI.
- `backend/`: Node.js + Express + Socket.io API.
- `backend/prisma/`: Prisma schema and PostgreSQL migrations.
- `desktop/`: Electron executable shell that loads the website UI, starts the local backend, and exposes runtime config through preload.
- Browser-side transcription in `frontend/src/workers/transcription.worker.js`.
- Audio capture/buffering in `frontend/src/hooks/useAudioPipeline.js`.
- Docker-based infrastructure in `docker-compose.yml`.

Current transcription path:

```text
Microphone
  -> Browser MediaStream
  -> AudioWorklet
  -> React hook buffer
  -> Web Worker
  -> Transformers.js Whisper
  -> Browser WebGPU
  -> Socket.io caption event
```

This is the main bottleneck. The app now has an Electron executable shell for the website UI, but replacing the transcription engine is still required to solve the core STT performance problem.

## Main Problems To Solve

### 1. Browser WebGPU Is Not Enough

The current transcription worker uses `@huggingface/transformers` with:

```js
device: "webgpu"
```

Browser WebGPU is useful, but it does not expose the same performance options as native runtimes such as CUDA, Vulkan, OpenVINO, Metal/Core ML, or optimized CPU SIMD paths.

### 2. Current Chunking Adds Latency

`frontend/src/hooks/useAudioPipeline.js` currently uses:

```js
const CHUNK_DURATION = 15;
```

That means the app waits up to 15 seconds before sending audio for transcription. Even if inference were instant, the UX would not feel real-time.

### 3. Current Worker Drops Work While Busy

`frontend/src/workers/transcription.worker.js` has:

```js
if (processing) return;
```

If inference is busy when another chunk arrives, that chunk can be skipped. This avoids queue buildup but loses transcript content under load.

### 4. Whisper Needs Streaming Strategy

Whisper is not naturally a streaming ASR model. Low-latency behavior requires:

- Voice activity detection.
- Short rolling audio windows.
- Overlap between windows.
- Partial transcript stabilization.
- Duplicate text suppression.
- Final/confirmed transcript events.

## Desktop App Mode

The first executable release should be a **local-only recorder/transcriber with the existing meeting UI preserved**. In this mode:

- The desktop app starts a local backend on the user's machine.
- Audio capture and STT run locally.
- Transcript persistence uses a local desktop database.
- The existing meeting/caption UI is reused for session display.
- Remote multiplayer/WebRTC behavior is kept only where it does not block the local executable path.

Full multi-user meeting client/server behavior remains a separate compatibility mode or later milestone. If retained, it must explicitly distinguish:

- Local desktop sessions, where the app owns backend lifecycle and storage.
- Hosted/server sessions, where browser clients connect to a shared backend.
- Caption ownership for local microphone captions versus remote participant captions.
- Whether WebRTC signaling is enabled, disabled, or hidden in local-only mode.

This prevents the executable effort from being blocked by remote room hosting concerns when the primary goal is private, local, low-latency transcription.

## Recommended Architecture

Use Electron for the executable shell, but move speech-to-text into a native sidecar service.

```text
Electron Desktop App
├─ Main process
│  ├─ Starts local backend
│  ├─ Starts native STT sidecar
│  ├─ Manages app lifecycle
│  └─ Provides runtime config to renderer
│
├─ Renderer process
│  ├─ Existing React UI
│  ├─ Existing meeting controls
│  ├─ Audio capture
│  └─ Caption display
│
├─ Local app backend
│  ├─ Express REST API
│  ├─ Socket.io meeting signaling
│  ├─ Summary generation
│  └─ Local database access
│
└─ Native STT sidecar
   ├─ Receives PCM audio frames
   ├─ Runs VAD
   ├─ Runs Whisper inference natively
   ├─ Emits partial/final transcript events
   └─ Selects best available hardware backend
```

## Native STT Engine Choice

### Recommended First Engine: `whisper.cpp`

Use `whisper.cpp` as the first native STT engine.

Reasons:

- C/C++ implementation with low packaging overhead.
- Supports CPU-only inference.
- Supports quantized models.
- Supports Vulkan for cross-vendor GPU acceleration.
- Supports NVIDIA GPU acceleration.
- Supports AMD ROCm.
- Supports OpenVINO for Intel hardware.
- Supports Apple acceleration paths for future macOS builds.
- Easier to bundle as a native executable than a Python runtime.

Reference:

- https://github.com/ggml-org/whisper.cpp

### Optional Later Engine: `faster-whisper`

Add `faster-whisper` later if NVIDIA CUDA performance becomes the top priority.

Reasons to defer:

- It can be very fast with CTranslate2.
- It introduces Python/runtime/CUDA packaging complexity.
- It is less convenient for a clean desktop executable than a compiled sidecar.

Reference:

- https://github.com/SYSTRAN/faster-whisper

## Hardware Backend Strategy

The app should select a transcription backend at startup.

### Windows Priority Order

1. NVIDIA CUDA build, if available and compatible.
2. Vulkan build, for NVIDIA/AMD/Intel GPUs with Vulkan support.
3. OpenVINO build, for Intel CPU/iGPU systems.
4. Optimized CPU build with quantized model fallback.

### Future macOS Priority Order

1. Metal/Core ML capable build.
2. Optimized CPU build.

### Future Linux Priority Order

1. CUDA build.
2. ROCm build.
3. Vulkan build.
4. CPU build.

## STT Runtime Design

Create a local STT service that communicates with the Electron app over WebSocket or stdio IPC.

Recommended first implementation:

```text
Renderer AudioWorklet
  -> Electron preload API
  -> Electron main process
  -> STT sidecar stdin/WebSocket
  -> STT result event
  -> Renderer caption state
  -> Existing Socket.io caption event
```

### Audio Input Format

Use a simple internal format:

- Mono PCM.
- 16 kHz sample rate.
- Float32 or int16.
- Small frames, around 20-100 ms each.
- Session metadata attached separately.

Example message shape:

```json
{
  "type": "audio",
  "meetingId": "uuid",
  "speakerId": "uuid",
  "sequence": 42,
  "sampleRate": 16000,
  "format": "f32le",
  "audio": "<binary frame>"
}
```

### STT Output Events

The sidecar should emit both partial and final events with explicit persistence semantics.

#### Partial Event

Partial events are unstable live captions for immediate UI feedback. They must not be written to `TranscriptSegment` rows. They may replace the current on-screen draft for the same `utteranceId`.

```json
{
  "type": "partial",
  "utteranceId": "uuid-or-monotonic-id",
  "meetingId": "uuid",
  "speakerId": "uuid",
  "sequence": 101,
  "text": "we should update the",
  "start": 12.4,
  "end": 14.1,
  "confidence": null,
  "isFinal": false
}
```

#### Final Event

Final events are stable transcript segments. Only these events should be emitted through the existing persisted `caption` socket event and stored in the database.

```json
{
  "type": "final",
  "utteranceId": "uuid-or-monotonic-id",
  "meetingId": "uuid",
  "speakerId": "uuid",
  "sequence": 102,
  "text": "We should update the onboarding flow.",
  "start": 12.4,
  "end": 15.2,
  "confidence": null,
  "isFinal": true
}
```

Renderer/backend contract:

- Partial captions update local renderer state only, or use a separate non-persisted event such as `caption-partial`.
- Final captions use the existing `caption` event and are persisted.
- Each final event must include a stable `utteranceId` or idempotency key so retries do not create duplicate database rows.
- The backend should reject or ignore `caption` payloads that are explicitly marked `isFinal: false`.

## Streaming Transcription Strategy

Implement a streaming controller around Whisper rather than sending isolated 15-second chunks.

### Pipeline

```text
PCM frames
  -> resample to 16 kHz mono if needed
  -> VAD
  -> rolling speech buffer
  -> overlapping inference window
  -> decode
  -> normalize text
  -> compare with previous hypothesis
  -> emit partial/final caption
```

### Initial Target Settings

- Audio frame size: 20-100 ms.
- VAD speech segment minimum: 300-500 ms.
- Inference window: 2-5 seconds.
- Overlap: 0.5-1.5 seconds.
- Partial update interval: 500-1000 ms.
- Finalization delay: 700-1500 ms after speech ends.

These values should be benchmarked on actual hardware.

### Stabilization

Use a local-agreement style approach:

- Keep the last decoded hypothesis.
- Decode the current rolling window.
- Find the prefix that agrees across multiple decodes.
- Emit agreed text as final.
- Emit newer unstable text as partial.

This avoids flickering captions and duplicate words.

### Overlap De-duplication Before Persistence

Because low-latency Whisper streaming uses overlapping windows, the app must de-duplicate text before final captions are persisted. Requirements:

- Assign each speech region a stable `utteranceId` or idempotency key.
- Track the audio time range covered by each finalized segment.
- Compare new final hypotheses against recently persisted text and timestamps.
- Suppress repeated prefixes/suffixes caused by overlap.
- Merge or replace unstable segments locally until finalization, rather than inserting every window result.
- Persist only finalized, de-duplicated text through the existing backend `caption` flow.
- Add metrics for duplicate caption rate and suppressed duplicate count.
- Add tests using overlapped windows where the same phrase appears in adjacent inference windows.

Whisper-Streaming is a useful reference for this style of approach:

- https://github.com/ufal/whisper_streaming

## Model Strategy

### Default Models

Start with:

- `base.en` for low-end machines.
- `small.en` for stronger CPU/GPU machines.
- `large-v3-turbo` as an optional high-quality GPU model.

### Quantization

Benchmark:

- `q5_0`
- `q8_0`
- fp16 where GPU backend supports it efficiently

Default should favor real-time performance over maximum accuracy.

### Model Delivery

Use one of two options:

1. Bundle a small default model with the installer.
2. Download models on first launch into the app data directory.

Recommended:

- Bundle `base.en` or `base.en` quantized for immediate offline use.
- Let users download larger models from settings.

### Model Manager Metadata

Track model metadata in a local manifest/database table so model selection and recovery are deterministic. Each model entry should include:

- Model id/name, for example `base.en-q5_0`.
- Human-readable display name.
- Version or upstream release tag.
- Quantization/type, for example `q5_0`, `q8_0`, or `fp16`.
- Expected file size.
- Checksum, preferably SHA-256.
- Local filesystem path under the app data or packaged model directory.
- Download URL or source.
- Download status: `bundled`, `not_downloaded`, `downloading`, `ready`, `failed`, or `corrupt`.
- Hardware/backend compatibility metadata.
- Whether it is the selected default model.
- Last validation timestamp.

The app should verify checksum after download and before first use, surface failed/corrupt states in settings, and fall back to the bundled default model when the selected model is unavailable.

## Frontend Changes

### Runtime Backend URL Configuration

Replace the current compile-time-only backend URL pattern:

```js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
```

with a runtime configuration provider that works in both browser and Electron modes.

Recommended behavior:

- In Electron mode, preload exposes a narrow config API such as `window.desktopConfig.getRuntimeConfig()`.
- Runtime config includes `apiBaseUrl`, `socketUrl`, selected local backend port, app mode, and feature flags.
- The renderer waits for runtime config before creating the Socket.io client or making REST calls.
- In browser/dev mode, fall back to `import.meta.env.VITE_API_URL` for normal Vite usage.
- Do not hardcode `http://localhost:4000` in packaged builds.

Example target shape:

```js
const runtimeConfig = await window.desktopConfig?.getRuntimeConfig?.() ?? {
  apiBaseUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  socketUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  appMode: 'browser-dev'
};
```

### Replace Browser STT Worker As Primary Path

Deprecate:

- `frontend/src/workers/transcription.worker.js`

Keep it temporarily as a fallback/debug path if useful.

### Update `useAudioPipeline`

Change `frontend/src/hooks/useAudioPipeline.js` so it:

- Captures short audio frames.
- Sends frames to Electron/native STT instead of a browser Worker.
- Handles partial/final STT events.
- Emits final captions through the existing Socket.io flow.
- Tracks local STT status and performance metrics.

Target flow:

```js
window.desktopStt.sendAudioFrame(frame);

window.desktopStt.onTranscript((event) => {
  if (event.type === "final") {
    socket.emit("caption", {
      meetingId,
      speakerId: userId,
      text: event.text,
      start: event.start,
      end: event.end
    });
  }
});
```

### Add STT Settings UI

Add settings for:

- Selected STT engine.
- Selected model.
- Hardware backend.
- Latency/accuracy mode.
- Current realtime factor.
- Model download status.
- Diagnostics export.

Suggested modes:

- Fast: smaller model, lower latency.
- Balanced: default.
- Accurate: larger model, higher latency.

## Backend Changes

### Keep Existing Meeting API Initially

The current Express + Socket.io backend can remain, but it should be adjusted for local desktop execution.

Needed changes:

- Add proper `dev` and `start` scripts to `backend/package.json`.
- Add a real health check that verifies database connectivity.
- Remove hardcoded CORS wildcard for packaged local mode if possible.
- Make port configurable.
- Make startup errors clear to Electron.

### Database Migration For Desktop

PostgreSQL is not ideal for a desktop executable.

Recommended:

- Use SQLite for desktop builds.
- Store the DB in Electron's app data directory.
- Keep PostgreSQL support for server/Docker deployments only if hosted/browser mode remains supported.

Prisma strategy:

- Prefer separate Prisma schemas if both desktop SQLite and server PostgreSQL must remain supported, for example:
  - `backend/prisma/schema.postgres.prisma` for Docker/server mode.
  - `backend/prisma/schema.sqlite.prisma` for desktop mode.
- Generate the correct Prisma client during each build target, or generate separate output clients if both must coexist.
- Use a desktop `DATABASE_URL` such as `file:<appData>/meetsummarizer.db`, supplied by Electron at backend startup.
- Include SQLite migrations in packaged assets and run `prisma migrate deploy` or an equivalent migration step on first launch/update.
- Ensure Prisma query engine binaries needed for the target platform are included in the packaged app.
- Add a backend health check that performs a real database query, not just a static response.
- Avoid schema features that work in PostgreSQL but not SQLite unless they are isolated to the PostgreSQL schema.
- Document whether the desktop app can import/export or migrate data if the schema changes.

Migration decision checkpoint:

- If server/Docker deployments are still required, keep dual schemas and dual migration histories.
- If the product becomes desktop-only, simplify to one SQLite schema and remove PostgreSQL-only assumptions.

## Electron App Plan

Add a desktop package, for example:

```text
desktop/
├─ main.js
├─ preload.js
├─ stt/
│  ├─ bin/
│  │  ├─ whisper-cpu.exe
│  │  ├─ whisper-vulkan.exe
│  │  └─ whisper-cuda.exe
│  └─ models/
├─ assets/
└─ package.json
```

### Main Process Responsibilities

Electron main process should:

- Find an available local port.
- Start the backend service.
- Start the STT sidecar.
- Wait for health checks.
- Create the browser window.
- Provide runtime config to the renderer.
- Manage camera/mic permissions.
- Shut down child processes when the app exits.
- Create windows with `contextIsolation: true`.
- Use `nodeIntegration: false`.
- Disable the remote module.
- Restrict navigation to the packaged app origin and approved local backend URLs.
- Deny or strictly handle `window.open` requests.
- Validate every IPC payload crossing preload/main boundaries.

### Preload Responsibilities

Expose a narrow safe API:

```js
window.desktopStt = {
  getStatus,
  sendAudioFrame,
  onTranscript,
  setModel,
  setBackend,
  stop
};
```

Avoid exposing raw Node APIs to the renderer.

## Packaging Plan

Use `electron-builder` or `electron-forge`.

Recommended first choice:

- `electron-builder`

Build outputs:

- Windows portable `.exe` first.
- Windows installer later.

Package contents:

- Built React frontend.
- Local backend code.
- Prisma client.
- SQLite migrations or prepared DB setup.
- STT sidecar binaries.
- Default Whisper model.
- App icon and metadata.

## Development Milestones

### Milestone 1: Minimal Electron Shell + Runtime Config

Status: initial implementation added.

Goal: validate the desktop host, local backend startup, preload bridge, and runtime configuration before native STT work becomes complex.

Tasks:

- Add a minimal `desktop/` Electron package with main and preload files.
- Start the existing backend from Electron in development mode.
- Select or discover an available local backend port at runtime.
- Expose renderer runtime config through preload instead of relying only on Vite build-time environment variables.
- Load the existing React UI in an Electron window.
- Confirm create/join meeting and summary API calls can reach the local backend.
- Add basic startup/shutdown lifecycle handling for the backend child process.

Deliverable:

- Desktop development shell that launches the React UI and connects to a runtime-configured local backend.

Current implementation notes:

- `desktop/main.js` starts the backend on an available local port.
- `desktop/preload.js` exposes `window.desktopConfig.getRuntimeConfig()`.
- `frontend/src/App.jsx` consumes runtime config before creating the Socket.io client or API requests.
- Native STT is not yet implemented; `window.desktopStt` is currently a placeholder API.

### Milestone 2: Baseline Measurement

Goal: measure the current bottleneck before rewriting.

Tasks:

- Add STT timing logs around browser WebGPU transcription.
- Record chunk duration, inference duration, and realtime factor.
- Measure end-to-end caption latency.
- Test at least one 5-minute meeting recording or live microphone session.

Deliverable:

- Baseline performance notes.

### Milestone 3: Native STT Prototype

Goal: prove native STT is faster on target hardware.

Tasks:

- Build or download `whisper.cpp` for Windows CPU.
- Add one GPU build path, preferably Vulkan first.
- Run local transcription against test WAV files.
- Benchmark `base.en`, `small.en`, and quantized variants.

Deliverable:

- Command-line native STT benchmark table.

### Milestone 4: Local STT Service

Goal: create a sidecar process that accepts audio frames and returns transcript events.

Tasks:

- Implement sidecar wrapper.
- Define IPC/WebSocket protocol.
- Add rolling audio buffer.
- Add VAD.
- Add partial/final transcript events.
- Add duplicate suppression.

Deliverable:

- Local STT service that can transcribe microphone-like streaming audio.

### Milestone 5: Frontend Integration

Goal: replace browser worker transcription with native sidecar transcription.

Tasks:

- Update `useAudioPipeline`.
- Add Electron preload bridge.
- Emit native STT results into existing caption flow.
- Add STT status UI.
- Keep old browser STT behind a feature flag for comparison.

Deliverable:

- Desktop development build using native transcription.

### Milestone 6: Desktop Backend Stabilization

Goal: make backend reliable inside a local executable.

Tasks:

- Add backend `start` script.
- Add configurable ports.
- Add health check with DB verification.
- Add SQLite desktop mode.
- Update Prisma setup for local app data storage.

Deliverable:

- Backend starts and stops cleanly under Electron.

### Milestone 7: Electron Packaging

Goal: produce a runnable executable.

Tasks:

- Add Electron main/preload files.
- Build frontend automatically before packaging.
- Include backend and STT binaries.
- Include default model.
- Add startup/shutdown lifecycle handling.
- Produce Windows portable `.exe`.

Deliverable:

- First executable build.

### Milestone 8: Performance Tuning

Goal: make transcription feel real-time.

Tasks:

- Tune VAD thresholds.
- Tune window size and overlap.
- Tune model selection.
- Add backend selection diagnostics.
- Add user-selectable performance profiles.
- Test on low, mid, and high-end Windows hardware.

Deliverable:

- Target latency and realtime factor achieved on supported hardware.

### Milestone 9: Production Hardening

Goal: make the app suitable for regular use.

Tasks:

- Add model manager UI.
- Add clear error states for unsupported GPU paths.
- Add logs export.
- Add crash recovery for STT sidecar.
- Add installer signing plan.
- Add auto-update plan if desired.

Deliverable:

- Stable desktop release candidate.

## Benchmark Targets

Track these metrics:

- End-to-end caption latency.
- Inference realtime factor.
- Time to first partial caption.
- Time to final caption.
- CPU utilization.
- GPU utilization.
- Memory usage.
- Transcript word error rate on sample audio.
- Dropped audio frames.
- Duplicate caption rate.

Initial target:

- Partial captions within 1-2 seconds.
- Final captions within 2-4 seconds.
- Realtime factor below `1.0`.
- No dropped speech during continuous conversation.

## Suggested Implementation Order

1. Add minimal Electron shell and runtime backend configuration.
2. Add performance logging to current WebGPU path.
3. Prototype `whisper.cpp` outside the app.
4. Build local STT sidecar with streaming protocol and de-duplication.
5. Replace `transcription.worker.js` path in Electron mode.
6. Move desktop database to SQLite.
7. Package as Windows executable.
8. Tune models/backends based on benchmark data.

## Risks

### GPU Packaging Complexity

CUDA, Vulkan, OpenVINO, and ROCm have different runtime requirements.

Mitigation:

- Start with CPU and Vulkan.
- Add CUDA as an optional optimized build.
- Provide clear fallback behavior.

### Model Size

Large models make the installer heavy.

Mitigation:

- Bundle a small default model.
- Download larger models after installation.

### Realtime Accuracy Tradeoff

Shorter windows improve latency but can reduce accuracy.

Mitigation:

- Use overlap.
- Use local-agreement stabilization.
- Offer Fast/Balanced/Accurate modes.

### Electron Does Not Automatically Fix STT

Electron still uses Chromium. Browser WebGPU inside Electron is not the solution by itself.

Mitigation:

- Treat Electron as packaging and lifecycle.
- Treat native STT as the performance solution.

## Definition Of Done

The conversion is successful when:

- A user can launch a Windows executable without Docker.
- The app starts its local backend automatically.
- The app starts a native STT sidecar automatically.
- The app uses the best available local hardware backend or falls back cleanly.
- The user can join/create a meeting.
- Microphone audio is transcribed locally.
- Captions appear with practical live latency.
- Summary generation still works.
- App data persists across restarts.
- Closing the app shuts down child processes cleanly.

