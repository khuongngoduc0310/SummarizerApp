# Testing MeetSummarizer

MeetSummarizer is tested through the Electron desktop application. The React/Vite renderer is not browser-standalone: Electron loads `frontend/dist/index.html` and provides runtime configuration through the preload bridge.

Automated backend and frontend tests can be run independently from the repository root.

## Automated checks

From the repository root:

```bash
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
```

Run one test file with:

```bash
npm --prefix backend test -- test/<name>.test.js
npm --prefix frontend test -- test/<name>.test.js
```

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
