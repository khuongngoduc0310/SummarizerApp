# Testing MeetSummarizer

MeetSummarizer is tested through the Electron desktop application. The React/Vite renderer is not browser-standalone: Electron loads `frontend/dist/index.html` and provides runtime configuration through the preload bridge.

Automated backend, frontend, and desktop tests can be run independently from the repository root.

## Automated checks

From the repository root:

```bash
npm --prefix backend test
npm --prefix frontend test
npm --prefix desktop test
npm --prefix frontend run lint
```

Run one test file with:

```bash
npm --prefix backend test -- test/<name>.test.js
npm --prefix frontend test -- test/<name>.test.js
npm --prefix desktop test -- test/stt-benchmark.test.js
npm --prefix desktop test -- test/backend-installer.test.js
npm --prefix desktop test -- test/sidecar-manager.test.js
```

## Native STT benchmark smoke test

This smoke test checks manifest loading, offline transcription, sidecar streaming, flush acknowledgment, transcript writing, and report generation. It is not a performance measurement.

1. Put a local 3-5 second speech clip at `desktop/stt/samples/smoke/sample.wav`. It must be mono 16 kHz 16-bit PCM WAV.
2. Put its lexical reference at `desktop/stt/samples/smoke/sample.txt`.
3. Create the local ignored manifest `desktop/stt/samples/smoke/manifest.json`:

   ```json
   {
     "schemaVersion": 1,
     "dataset": { "name": "native-smoke" },
     "samples": [
       { "id": "sample", "audio": "sample.wav", "reference": "sample.txt" }
     ]
   }
   ```

4. From the repository root, run both modes with fast pacing. Benchmark script arguments resolve from `desktop/`:

   ```bash
   npm --prefix desktop run benchmark:whisper -- \
     --binary stt/bin/cpu/whisper-cli.exe \
     --model stt/models/ggml-base.en-q5_0.bin \
     --manifest stt/samples/smoke/manifest.json \
     --mode both \
     --pace fast \
     --backend cpu \
     --out ../benchmark-results/native-smoke.json \
     --transcripts-dir ../benchmark-results/transcripts/native-smoke
   ```

5. Confirm the command exits successfully, both sample modes have `ok: true`, `streaming.flush.totalSamplesReceived` equals `streaming.performance.samplesSent`, and offline/streaming transcript files were written.
6. Review WER only as a pipeline sanity check. Fast pacing is not latency-representative; use `--pace realtime` and the procedure in [Native STT WER Benchmark](STT_NATIVE_WER_BENCHMARK.md) for measurements.

The sample, reference, report, and transcripts are local artifacts and are not committed.

## Quick local desktop test

### 1. Install dependencies

From the repository root:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix desktop ci
```

### 2. Configure the backend

Copy the example file and adjust if necessary:

```bash
# macOS/Linux/Git Bash
cp backend/.env.example backend/.env
```

```powershell
# PowerShell
Copy-Item "backend/.env.example" "backend/.env"
```

The example database URL targets the PostgreSQL service exposed by Compose on `localhost:5433`.

### 3. Start PostgreSQL

```bash
docker compose up -d db
```

### 4. Apply development migrations

```bash
npm --prefix backend run prisma:migrate
```

`prisma:migrate` runs `prisma migrate dev` and may update the development database or create migration files.

### 5. Launch the local desktop application

```bash
npm run dev:local
```

This builds the renderer, launches Electron, and lets Electron start the backend on an available local port.

For a deterministic port, set `BACKEND_PORT` before launching:

```powershell
$env:BACKEND_PORT="4000"
npm run dev:local
```

Then health-check with:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/health"
```

Do not launch the renderer directly with `npm --prefix frontend run dev`. The application requires Electron's `window.desktopConfig` preload bridge and is not supported as a standalone Vite website.

## Two-participant local test

After PostgreSQL is running and migrations are applied:

```bash
npm run dev:two-electron
```

This builds the renderer and launches two Electron instances with separate user-data directories. Both instances share the local backend on `BACKEND_PORT`, which defaults to `4000` for this command.

## Docker Compose scope and current limitation

The currently supported Compose operation is starting PostgreSQL:

```bash
docker compose up -d db
```

The Compose file does not define Redis or a frontend service. Its backend service is not currently reliable because it uses `backend/` as the build context while the repository Dockerfile is at the repository root and expects root-relative `backend/...` paths.

Do not use `docker compose up --build` as the documented application startup path. Start PostgreSQL with Compose, apply migrations through the backend package, and launch the application with a root Electron script.

## Manual smoke test

1. Start PostgreSQL and apply migrations.
2. Launch two clients with `npm run dev:two-electron`.
3. Create a meeting in the first Electron window.
4. Join the same meeting from the second Electron window.
5. Allow microphone access and unmute.
6. Confirm the STT status bar reports either a running native backend or WebGPU fallback.
7. Speak long enough for the active STT path to produce a final caption.
8. Confirm the caption appears in both Electron windows.
9. Confirm mute/video status changes propagate between participants.
10. Add an LLM API key in Settings and generate a summary after final captions have been persisted.

### Background blur smoke test

1. Launch two Electron clients with `npm run dev:two-electron` and allow camera access in the first client.
2. In the first client's Settings, enable **Background blur** before creating or joining a meeting. Confirm the pre-join preview shows the blurred background.
3. Join the same meeting from the second client and confirm the first client's remote video is blurred while the second client's video is unchanged.
4. Toggle **Blur on** and **Blur off** from the first client's meeting controls. Confirm the first preview and the remote video change together without interrupting audio or disconnecting the meeting.
5. Turn the first camera off and back on, then switch to another camera if available. Confirm blur resumes when enabled and the remote peer continues receiving video.
6. Join the first client with its camera off while the second client shares video, then enable the first camera. Confirm the second client receives it after WebRTC renegotiation.
7. On a device where the effect cannot initialize or during a forced runtime failure, confirm the app reports it as unavailable and continues sharing the unfiltered camera stream without a black frame.
8. With a 1080p camera, confirm 30 FPS blurred output remains smooth at the 640 x 360 limit while captions, controls, and audio remain responsive. Fast movement may briefly show mask-edge lag because segmentation runs at 16 FPS.

### Optional CUDA backend smoke test

1. Use a Windows x64 machine with an NVIDIA GPU and current driver. A full CUDA Toolkit installation must not be required.
2. Open **Settings → Speech-to-text**, keep the preference on **Auto**, and install **NVIDIA CUDA 11.8**.
3. Confirm the UI discloses a 266 MiB download, approximately 594 MiB installed size, and at least 1.2 GB temporary free-space requirement.
4. Cancel one installation and confirm no backend is marked installed; retry and confirm progress passes through download and extraction.
5. Restart Electron and confirm the backend remains installed and the `Auto` preference persists.
6. With a downloaded Whisper model selected, confirm CUDA passes preflight and becomes the active backend.
7. Select CPU or Vulkan explicitly, restart, and confirm the strict preference persists.
8. Remove CUDA while `Auto` is selected and confirm native STT falls through to Vulkan or CPU, otherwise WebGPU.
9. Corrupt or remove a required CUDA DLL in a disposable user-data directory and confirm validation fails without reporting native STT ready.
10. Build with `npm run build:desktop`, inspect `desktop/release/`, and confirm CUDA archives, samples, models, benchmarks, and local `desktop/stt/bin/cuda` files were not packaged.

`ELECTRON_USER_DATA_DIR` controls the model, preference, and optional backend installation root. `npm run dev:two-electron` uses separate user-data directories, so each instance has an independent CUDA installation.

### Summary provider/model smoke test

1. Open **Settings → AI Summary Settings**.
2. Select each provider and confirm its model list changes.
3. Enter a different test key for each provider, switch between providers, and confirm each masked key is retained independently.
4. Select a non-default model, close and reopen Settings, and confirm the selection persists.
5. Generate a summary and confirm the Summary header shows the selected provider and model.
6. Generate another summary with a different model and confirm the displayed model changes.
7. In the network request, confirm only `provider`, `model`, and the active provider's `apiKey` are sent in `llmConfig`.
8. Submit an unsupported model directly to the backend and confirm it returns HTTP 400 without making a provider request.

When testing a local renderer against Railway, deploy the backend model catalog first and verify database connectivity:

```powershell
Invoke-RestMethod "https://summarizerapp-production.up.railway.app/health"
$env:MEETSUMMARIZER_API_URL="https://summarizerapp-production.up.railway.app"
npm run dev
```

`npm run dev` builds the renderer and launches Electron against the configured remote API.

### Late-join transcript history

1. Start a meeting with participant A and produce more than eight final captions.
2. Join the same active room with participant B while A remains connected.
3. Confirm B receives the persisted captions from the current session and continues receiving live captions.
4. Produce more than 200 captions and confirm B can load older pages from the top of the Transcript tab.
5. Confirm a caption emitted while B loads history appears exactly once.
6. Scroll upward, produce another live caption, and confirm the viewport is not forced to the bottom.
7. Leave with all participants, rejoin the now-empty room, and confirm the previous session is not loaded.

Deploy the transcript-history index migration to Railway before testing the local desktop app against it:

```powershell
npm --prefix backend exec -- prisma migrate deploy
```

## Expected logs

### Renderer console

Native path:

```text
[AudioPipeline] Using native Whisper.cpp STT
[Native STT] status ...
[Native STT] final caption ...
```

WebGPU fallback path:

```text
[AudioPipeline] Using browser WebGPU STT
[WebGPU] Ready! ...
[STT Telemetry] ...
[STT Baseline] ...
```

### Electron terminal

When Electron starts a local backend:

```text
[backend] Backend server running on port ...
[backend] Transcript retention: ... days
```

## Common failures

- No captions: confirm mic is unmuted, WebGPU is available, and you spoke for 15+ seconds.
- Backend health returns `503`: database is not reachable or migrations were not applied.
- Docker support is limited to PostgreSQL (see note above).
- Summary fails: verify the selected provider API key is valid.
- Electron opens but meeting creation fails: confirm Docker database is running and `backend/.env` points to `localhost:5433`.
- Electron shows startup screen forever: check the Electron terminal for backend health check errors.
