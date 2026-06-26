# Review: EXECUTABLE_APP_STT_PLAN.md

## Context

The existing plan proposes converting MeetSummarizer into a Windows-first desktop executable with native speech-to-text acceleration. I reviewed it against the current codebase, especially:

- `frontend/src/hooks/useAudioPipeline.js`
- `frontend/src/workers/transcription.worker.js`
- `frontend/src/App.jsx`
- `backend/index.js`
- `backend/package.json`
- `backend/prisma/schema.prisma`
- `docker-compose.yml`

Overall, the plan is directionally strong and correctly identifies the core issue: Electron alone will not solve the transcription bottleneck unless the STT path moves out of browser WebGPU.

## Approach

Approve the plan conceptually, but revise execution order and add missing desktop-readiness work before implementation. The highest-priority adjustment is to make a thin Electron shell and runtime configuration path earlier, then integrate the native STT service incrementally behind feature flags.

## Key Findings

### Accurate Observations In The Plan

- `frontend/src/workers/transcription.worker.js` does use `@huggingface/transformers` with `device: "webgpu"`.
- `frontend/src/hooks/useAudioPipeline.js` uses `CHUNK_DURATION = 15`, which creates a large inherent latency floor.
- The worker uses `if (processing) return;`, so chunks can be dropped while inference is busy.
- The current app depends on a browser `AudioWorklet` and sends finished transcription segments through `socket.emit('caption', ...)`.
- `backend/package.json` lacks real `dev`/`start` scripts.
- `backend/index.js` uses permissive CORS and a simple `/health` endpoint that does not actually verify database connectivity.
- Prisma is currently configured for PostgreSQL in `backend/prisma/schema.prisma`.
- Docker/PostgreSQL are currently part of the normal infrastructure via `docker-compose.yml`.

### Gaps To Address Before Implementation

1. **Add an explicit desktop runtime config layer**
   - `frontend/src/App.jsx` currently resolves the backend from `VITE_API_URL || 'http://localhost:4000'`.
   - A packaged app should receive backend URL/port from Electron preload/main runtime config, not a compile-time-only Vite env var.

2. **Decide whether Electron shell comes earlier**
   - The current plan places Electron packaging after STT and backend stabilization.
   - For integration risk reduction, add a minimal Electron shell milestone earlier so backend launch, port selection, preload API, and renderer config are validated before native STT becomes complex.

3. **Separate local-only desktop mode from multiplayer/browser mode**
   - The current backend still supports meeting rooms, WebRTC signaling, and multiple participants.
   - The plan should clarify whether the executable is meant for:
     - one local user recording/transcribing their meeting audio, or
     - full multi-user meetings with remote participants.
   - This affects caption ownership, WebRTC expectations, and whether the backend remains a room server or becomes mostly local session storage.

4. **Add transcript event semantics before sidecar implementation**
   - The plan says partial/final events should exist, but the existing backend persists every `caption` event immediately.
   - Add a concrete contract: only `final` segments are emitted to the existing persisted `caption` socket event; partials should use a separate local UI path or a non-persisted socket event.

5. **Call out duplicate/overlap risk in current caption storage**
   - `useAudioPipeline.js` already keeps a 3-second overlap.
   - The current worker emits one segment spanning the full overlapped chunk.
   - Without segment de-duplication, moving to shorter overlapping windows could create many duplicate persisted captions.

6. **Prisma SQLite migration needs more detail**
   - Switching Prisma from PostgreSQL to SQLite is not just a datasource toggle.
   - The implementation plan should include separate schema/client generation or a deliberate choice to drop PostgreSQL compatibility.
   - Migrations, app-data database location, and packaged Prisma engine availability should be planned explicitly.

7. **Installer/model size should be tracked as a product decision**
   - Bundling even a small quantized Whisper model is useful for offline first launch.
   - Larger models should be downloaded post-install, but the plan should include checksum/version metadata and a recoverable failed-download state.

8. **Security hardening should move earlier**
   - Preload should expose only narrow APIs, as the plan says.
   - Also add explicit Electron settings: `contextIsolation: true`, `nodeIntegration: false`, no remote module, strict IPC validation, and constrained navigation/window-open handling.

## Files To Modify In The Plan

The implementation plan should continue to identify these as critical files/areas:

- `frontend/src/hooks/useAudioPipeline.js`
- `frontend/src/workers/transcription.worker.js`
- `frontend/src/App.jsx`
- `backend/index.js`
- `backend/package.json`
- `backend/prisma/schema.prisma`
- new `desktop/` package or workspace
- new STT sidecar source/package area

## Reuse

Existing code that should be reused rather than replaced wholesale:

- Audio capture setup in `frontend/src/hooks/useAudioPipeline.js`
- AudioWorklet frame collection in `frontend/src/workers/audio-processor.js`
- Existing caption persistence and broadcast flow in `backend/index.js`, with event semantics tightened
- Existing meeting creation/join flow in `frontend/src/App.jsx` and `backend/index.js`, if multi-user meeting mode remains in scope
- Existing Prisma models for meetings, transcripts, segments, and summaries, adapted for desktop persistence

## Recommended Plan Revisions

- [ ] Add a new early milestone: **Minimal Electron Shell + Runtime Config**.
- [ ] Define desktop app mode: local-only recorder/transcriber vs full multi-user meeting client/server.
- [ ] Define the transcript event contract for partial vs final captions.
- [ ] Move Electron security settings into the main implementation checklist, not just hardening.
- [ ] Expand the SQLite/Prisma migration section with schema/client/migration strategy.
- [ ] Add model manager metadata requirements: version, checksum, local path, download status, and selected default.
- [ ] Add backend URL/runtime config replacement for the current `VITE_API_URL` usage.
- [ ] Add de-duplication requirements for overlapping STT windows before persisting captions.

## Verification

Before implementation starts, the revised plan should be considered ready when it answers:

- Can the app launch in Electron and connect to a dynamically selected local backend port?
- Are partial captions displayed without being persisted as final transcript records?
- Are final captions persisted exactly once despite overlapped STT windows?
- Does the backend health check fail when the database is unavailable?
- Can Prisma run against the desktop database path in packaged mode?
- Can the app fall back from native STT to browser STT or CPU STT with a clear user-visible status?

## Recommendation

Proceed with this architecture, but revise `EXECUTABLE_APP_STT_PLAN.md` before execution. The plan is technically sound at the architecture level; the main risk is that it jumps into native STT complexity before locking down Electron runtime config, caption event semantics, and desktop database strategy.
