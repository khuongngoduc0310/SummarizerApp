# Objective

Struct padding bug fixed in `desktop/stt/whisper-ffi-bridge.js` — 4 misplaced pad fields caused an 8-byte offset shift from `language` onward, making whisper auto-detect the wrong language. Now `whisper_full` produces correct English transcription (lang_id=0) in 189ms on Vulkan GPU (159× real-time). FFI Vulkan pipeline works end to end.

# Work State

## Current state

The struct padding bug is now fixed in `desktop/stt/whisper-ffi-bridge.js`. The fix changed:
1. `_p1: pad(7)` → `pad(3)` (after 9 bools, align float to 4)
2. `_p4: pad(7)` → `pad(3)` (after tdrz_enable, align void* to 8)
3. `_p7: pad(5)` → `pad(1)` (after 3 bools, align float to 4)
4. Removed `_p8: pad(4)` (no padding between grammar_penalty and vad)

Verified by reading each struct field via koffi at the correct offsets and running whisper_full on ES2004c-C (30s) which now produces correct English transcription lang_id=0 in 189ms on Vulkan GPU (159× real-time).

## Previous state

The struct had wrong padding at 4 places causing an 8-byte offset shift from the `language` field onward. `p.language` wrote to offset 112 (actually `detect_language`) rather than 104, so setting the language string or detect_language flag had no effect, causing whisper to auto-detect the wrong language. The pointer `p.language` read 256n (half of a bool+float pair) instead of the real "en" string pointer.

## Blocked

None anymore — the FFI Vulkan pipeline now works end to end.

## Next moves

- Update `whisper-ffi-bridge.js`'s `loadAndTranscribe` function to use proper `whisper_full` signature (`WhisperFullParams` by value, not `void*`)
- Update `koffi.as(audioData, 'float*')` for array conversion
- Re-run Vulkan FFI offline benchmark on all 12 AMI samples
- Run Vulkan FFI streaming test
- Commit the struct fix

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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **SummarizerApp** (618 symbols, 1140 relationships, 32 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/SummarizerApp/context` | Codebase overview, check index freshness |
| `gitnexus://repo/SummarizerApp/clusters` | All functional areas |
| `gitnexus://repo/SummarizerApp/processes` | All execution flows |
| `gitnexus://repo/SummarizerApp/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
