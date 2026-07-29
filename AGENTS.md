# Repository Guide

## Packages and entrypoints

- This is not an npm workspace. Install the root, `backend/`, `frontend/`, and `desktop/` lockfiles separately.
- The root package only orchestrates builds and Electron launches.
- `backend/index.js` is the CommonJS Express/Socket.io/Prisma server.
- `frontend/src/main.jsx` and `frontend/src/App.jsx` are the ESM React renderer entrypoints.
- `desktop/main.js` is the CommonJS Electron main process; `desktop/preload.js` is the renderer's only desktop API bridge.
- Electron loads `frontend/dist/index.html`, not the Vite development server. The renderer is not browser-standalone and requires `window.desktopConfig`.

## Setup and commands

- Use Node 22.12 or newer; current Vite and root Electron requirements supersede the README's older Node 18 claim.
- Install dependencies from the repository root:
  - `npm ci`
  - `npm --prefix backend ci`
  - `npm --prefix frontend ci`
  - `npm --prefix desktop ci`
- Copy `backend/.env.example` to `backend/.env` before local backend or Prisma commands, then adjust `DATABASE_URL` if the local database differs from the Compose default.
- Local app setup order is `docker compose up -d db`, run `npm run prisma:migrate` from `backend/`, then run `npm run dev:local` from the root.
- `npm run dev:local`, `npm run dev`, and `npm run dev:two-electron` build the renderer before launching Electron. Direct `npm --prefix desktop run dev` does not; build with `npm run build:renderer` first.
- Build the packaged app with `npm run build:desktop`; output is under `desktop/release/`.
- Run checks from the root:
  - `npm --prefix backend test`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run lint`
- Run one test with `npm --prefix backend test -- test/<name>.test.js` or `npm --prefix frontend test -- test/<name>.test.js`.
- For focused frontend lint, run `npx eslint <path>` with `frontend/` as the working directory so its flat config resolves.
- There is no root test/lint script, backend lint, formatter, typecheck, coverage command, or configured CI pipeline.

## Database and environment

- `backend/.env.example` contains only backend-consumed variables: `PORT`, `DATABASE_URL`, `CORS_ORIGIN`, and `RETENTION_DAYS`. Electron-only environment variables are supplied through the launching shell, not the backend dotenv file.
- Run Prisma commands from `backend/` so `backend/.env` and `prisma/schema.prisma` resolve: `npm run prisma:migrate`, `npm run prisma:generate`, or `npx prisma migrate deploy`.
- `prisma:migrate` runs `prisma migrate dev` and may create migrations or modify the development database. Use `prisma migrate deploy` for existing production migrations.
- Add a migration for schema changes; do not casually edit migrations that may already have been applied.
- The backend requires `DATABASE_URL`. Runtime configuration also uses `PORT`, `CORS_ORIGIN`, and `RETENTION_DAYS`; Electron orchestration uses `MEETSUMMARIZER_LOCAL_BACKEND`, `MEETSUMMARIZER_API_URL`, `BACKEND_PORT`, and `ELECTRON_USER_DATA_DIR`.
- The backend deletes ended meetings older than `RETENTION_DAYS` hourly; cascade relations also remove their transcripts, segments, and summaries.
- Only `docker compose up -d db` is currently reliable. Compose's backend service references `backend/` as a build context even though that directory has no Dockerfile, and documented Redis services do not exist.

## Change constraints

- Preserve `base: './'` in `frontend/vite.config.js`; Electron's `file://` renderer needs relative asset URLs.
- Keep Electron capabilities behind the preload bridge and validate IPC inputs rather than enabling Node APIs in the renderer.
- Keep the model catalogs in `frontend/src/config/llmModels.js` and `backend/llmConfig.js` synchronized.
- Persist only final caption events and preserve `utteranceId` idempotency behavior.
- In STT sidecar lifecycle code, preserve stale-child protection when replacing processes: remove old listeners and ensure callbacks apply only to the current child.
- Clean up Socket.io listeners, IPC subscriptions, workers, audio contexts, and media tracks when changing renderer effects.
- Do not commit `.env` files, `frontend/dist/`, `desktop/release/`, Prisma-generated output, STT binaries/models/samples, or benchmark output.
- No formatter is configured and style differs by package; follow the surrounding file rather than applying repository-wide formatting.

## Documentation upkeep

- Keep `docs/TESTING.md` current when test commands, supported launch modes, or manual verification flows change.
- Keep `docs/STT_WEBGPU_BENCHMARK.md` current when WebGPU telemetry, fallback activation, benchmark artifacts, or benchmark procedures change.
- After a change, update the relevant README, testing, benchmark, or architecture documentation when setup commands, prerequisites, package boundaries, runtime flow, environment variables, tests, generated artifacts, or operational constraints changed.
- Prefer package scripts and executable configuration over prose. Correct or remove stale instructions instead of preserving conflicting alternatives.
- Skip documentation edits for internal changes that no useful context for a future agent exploring or operating the project.
