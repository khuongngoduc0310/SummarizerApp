# Testing MeetSummarizer

MeetSummarizer can be tested in two modes:

- Browser website mode: React/Vite frontend connects to a manually started backend.
- Desktop executable mode: Electron loads the website UI and starts the local backend automatically.

## Quick local test

### 1. Start database services

```bash
docker compose up -d db redis
```

### 2. Configure backend

Create `backend/.env`:

```env
PORT=4000
DATABASE_URL="postgresql://postgres:password@localhost:5433/summarizer?schema=public"
CORS_ORIGIN="http://localhost:5173"
```

### 3. Install and migrate backend

```bash
cd backend
npm install
npm run prisma:migrate
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

Expected:

```json
{"status":"ok","database":"connected"}
```

### 4. Start frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Desktop executable shell test

This mode runs the website as an Electron app.

### 1. Start database services

```bash
docker compose up -d db redis
```

### 2. Confirm backend environment exists

`backend/.env` should contain:

```env
PORT=4000
DATABASE_URL="postgresql://postgres:password@localhost:5433/summarizer?schema=public"
REDIS_URL="redis://localhost:6379"
CORS_ORIGIN="http://localhost:5173"
```

### 3. Start the frontend dev server

```bash
cd frontend
npm install
npm run dev
```

### 4. Launch Electron

In another terminal:

```bash
cd desktop
npm install
npm run dev
```

Expected behavior:

- Electron opens the MeetSummarizer website UI.
- Electron starts the backend automatically on a local available port.
- The renderer receives backend URL/runtime config through preload.
- Creating a meeting works from inside the desktop window.

## Docker test

From repo root:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

Backend health:

```bash
curl http://localhost:4000/health
```

## Manual smoke test

1. Use Chrome/Edge with WebGPU support, or use the Electron desktop shell.
2. Create a meeting.
3. Allow microphone access.
4. Unmute the mic.
5. Speak for at least 15 seconds.
6. Wait for the Whisper/WebGPU model to load and transcribe.
7. Confirm captions appear.
8. Open the same meeting in another tab/incognito window and confirm captions broadcast.
9. Add an LLM API key in settings and generate a summary after captions are saved.

## Expected logs

Frontend console:

```text
[WebGPU] Ready!
[AudioPipeline] Processing ...
[Whisper WebGPU] Generated ...
```

Backend console:

```text
Backend server running on port 4000
User connected
```

Electron console in desktop mode:

```text
[backend] Backend server running on port ...
```

## Common failures

- No captions: confirm mic is unmuted, WebGPU is available, and you spoke for 15+ seconds.
- Backend health returns `503`: database is not reachable or migrations were not applied.
- Docker backend fails on first start: rerun after DB is healthy, or check `docker compose logs backend db`.
- Summary fails: verify the selected provider API key is valid.
- Electron opens but meeting creation fails: confirm Docker database is running and `backend/.env` points to `localhost:5433`.
- Electron shows startup screen forever: check the Electron terminal for backend health check errors.
