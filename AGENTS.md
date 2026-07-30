# Objective

Benchmark native Whisper STT accuracy (WER) and performance on AMI Meeting Corpus recordings across CPU and GPU backends via FFI native addon without per-inference model reload.

## Accomplished

### Struct padding fix (`4c4ad3d`)
4 misplaced koffi pad() fields in `whisper_full_params` caused 8-byte offset shift from `language` onward. Fix: `_p1: pad(3)`, `_p4: pad(3)`, `_p7: pad(1)`, removed `_p8`. Language override now works correctly (lang_id=0 for English).

### FFI performance vs CLI
- **Offline**: WER 13.9% (was 18.7%), 2.7× faster (1044ms vs 2824ms)
- **Streaming**: WER 26.0–28.3%, 2.4× lower caption lag (212ms vs 501ms)
- **VAD**: 0.003 threshold optimal — 46% fewer VAD skips than CLI default 0.008
- **Compute**: FFI Vulkan uses 5.8–6.3% CPU, leaving 94% GPU idle

### Best configs
| Use case | Config | WER | Caption lag |
|---|---|---|---|
| Lowest latency | base.en w4/o1 | 28.3% | **212ms** |
| Best accuracy | small.en w6/o1 | **26.0%** | 362ms |
| Offline | base.en (no streaming) | **13.9%** | 287× realtime |

### CPU FFI blocked
`cpu/whisper.dll` fails `GGML_ASSERT(device) failed` — likely needs a different BLAS backend.

# Work State

## Active
- Full 12-sample FFI offline benchmark shows 104% WER (dominated by cross-talk/sparse outliers, same as CLI)
- 6-sample FFI streaming benchmark shows 147.5% WER (same outlier issue)
- Need clean-core (4 cleanest samples) aggregate for meaningful FFI comparison

## Blocked
- **CPU FFI**: `cpu/whisper.dll` fails `GGML_ASSERT(device) failed` even with PATH set

## Next moves
- Compute clean-core (4 samples) WER for FFI offline + streaming
- Run FFI offline + streaming with small.en for comparison
- Investigate CPU FFI DLL failure
- Consider vad=0.003 for production default

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

This project is indexed by GitNexus as **SummarizerApp** (1100 symbols, 2303 relationships, 93 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
