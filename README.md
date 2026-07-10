# MeetSummarizer

MeetSummarizer is an Electron desktop app for real-time meeting captions and AI summaries. The desktop app bundles the React UI, runs local speech-to-text, and connects to a deployed Node/Express backend for meetings, signaling, transcripts, and summaries.

## Architecture

- `desktop/` - Electron shell, runtime configuration, native STT sidecar lifecycle.
- `frontend/` - React renderer source. It is built into `frontend/dist` and loaded by Electron; it is not deployed as a website.
- `backend/` - Deployable Express + Socket.io API backed by PostgreSQL/Prisma.
- `docker-compose.yml` - Local backend/Postgres testing only.

Production flow:

```txt
Electron app -> deployed backend API -> PostgreSQL
             -> local STT sidecar / browser STT fallback
```

## Prerequisites

- Node.js 18+
- Docker + Docker Compose for local backend testing
- A deployed backend URL for production desktop builds

## Desktop development with deployed backend

Set the deployed API URL, build the renderer, and launch Electron:

```bash
# PowerShell
$env:MEETSUMMARIZER_API_URL="https://api.yourdomain.com"
npm install
npm --prefix frontend install
npm --prefix desktop install
npm run dev
```

`npm run dev` builds `frontend/dist` and launches the Electron app. The renderer is not served as a standalone website.

> [!IMPORTANT]
> If `MEETSUMMARIZER_API_URL` is not set, the app will exit with an error asking you to either use `npm run dev:local` or provide a backend URL. The old behavior of silently connecting to a non-existent placeholder domain has been removed.

## Local backend testing

1. Create `backend/.env`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5433/summarizer?schema=public"
PORT=4000
CORS_ORIGIN="null"
```

2. Start Postgres and run migrations:

```bash
docker compose up -d db
npm --prefix backend install
npm --prefix backend run prisma:migrate
```

3. Launch Electron with the local backend enabled:

```bash
npm run dev:local
```

For two local Electron windows sharing one backend port:

```bash
npm run dev:two-electron
```

## Backend deployment

The backend remains a normal deployable service.

Required environment variables:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/summarizer?schema=public"
PORT=4000
CORS_ORIGIN="null"
```

Deploy migrations before starting the server:

```bash
npx prisma migrate deploy
npm start
```

The included `backend/Dockerfile` and `docker-compose.yml` are intended for backend/local testing, not website deployment.

## Build desktop app

```bash
npm run build:desktop
```

Packaged installers are written under:

```txt
desktop/release/
```

Configure the production backend URL at build/runtime with:

```env
MEETSUMMARIZER_API_URL=https://api.yourdomain.com
```

## STT Setup & Model Management

Speech-to-text runs locally via Whisper.cpp (native sidecar) with a browser WebGPU fallback. Models and backends are managed from the **Settings** modal (gear icon in-meeting, or the STT section on the join screen).

### Available Models

| Model | Size | Recommended For |
|-------|------|----------------|
| `tiny.en` | 78 MB | Fastest, lowest disk usage |
| `base.en` | 148 MB | Good balance of speed and accuracy |
| `small.en` | 488 MB | Better accuracy, moderate disk use |
| `medium.en` | 1.5 GB | Best accuracy, large download |

### Downloading a Model

1. Open **Settings** → **Speech-to-text** tab.
2. Click **Download** on any model in the catalog.
3. A progress bar appears in the status bar (sidebar footer in-meeting).
4. Once downloaded, the model auto-selects and the sidecar restarts.

### Switching the Active Model

- Click **Use** next to any downloaded model. The sidecar restarts with the new model immediately.
- The first inference after switching loads the model file from disk — larger models take longer to load (~1-10s depending on size).
- Downloaded models can be deleted with **Delete** (the active model cannot be deleted while in use).

### Backends

| Backend | Acceleration | Requirements |
|---------|-------------|--------------|
| **CPU** | CPU-only | Included by default |
| **Vulkan** | GPU-accelerated | Vulkan runtime + `ggml-vulkan.dll` |

The app auto-detects available backends at startup. Switch backends from Settings → STT tab.

## Status Bar

The status bar appears in the **sidebar footer** during a meeting. It shows live STT state:

| State | Indicator | Meaning |
|-------|-----------|---------|
| 🟢 **Idle** | Green dot | Sidecar running, waiting for speech |
| 🟠 **Inferring** | Amber pulsing dot | Actively transcribing an audio window |
| 🔵 **Downloading** | Progress bar | A model is being downloaded (shows % and bytes) |
| 🔴 **Unavailable** | Red dot | No backend or no model available |
| ⚪ **Stopped** | Gray dot | Sidecar has stopped |

The model pill (left side) displays the active model filename and backend (`CPU` / `VULKAN`). When inferring, the **RTF** (realtime factor) shows how fast transcription runs relative to real-time (e.g. `RTF 0.40x` means 2.5× faster than real-time).

## Troubleshooting

### "Desktop launch required" error

The React renderer must be launched from the Electron desktop app. Opening `frontend/dist/index.html` directly in a browser will show this error.

### No transcription appearing

1. Check the **status bar** — if it shows 🔴 Unavailable or ⚪ Stopped, the sidecar isn't running.
2. Open **Settings → STT** and verify a model is downloaded and selected.
3. If using Vulkan, try switching to CPU backend (Vulkan may not be installed).
4. The first inference after switching models loads the file from disk — wait a few seconds.

### SSL / fetch errors at startup

Use `npm run dev:local` for local development, or set `MEETSUMMARIZER_API_URL` to a valid HTTP backend URL. The backend does not serve HTTPS — SSL should be handled at a reverse proxy in production.

### Sidecar not starting

Check that `desktop/stt/bin/cpu/whisper-cli.exe` and model files exist. On first run, download a model from Settings.

## Notes

- The React app intentionally requires Electron runtime config. Opening `frontend/dist/index.html` directly in a browser shows a desktop-launch error.
- Audio transcription remains local where possible. Summary generation sends text transcripts to the selected LLM provider.
- The STT status bar (sidebar footer) shows live model, backend, inference state, and download progress.
- Switching Whisper models restarts the native sidecar automatically; the first inference after a switch loads the model from disk.
- User LLM provider keys are stored locally by the desktop renderer.
