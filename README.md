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

## Notes

- The React app intentionally requires Electron runtime config. Opening `frontend/dist/index.html` directly in a browser shows a desktop-launch error.
- Audio transcription remains local where possible. Summary generation sends text transcripts to the selected LLM provider.
- User LLM provider keys are stored locally by the desktop renderer.
