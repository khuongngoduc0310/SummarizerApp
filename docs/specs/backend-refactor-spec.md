# Spec: Backend Feature Extraction & Native Benchmark Refactoring

**Status:** ready-for-agent  
**Created:** 2026-08-02  
**Route:** implementation

## Problem Statement

`backend/index.js` is a ~560-line monolith that mixes HTTP routes, Socket.io lifecycle management, idempotency state, cleanup scheduling, and infrastructure wiring into a single file. Adding or modifying any meeting, summary, or caption behavior requires navigating competing concerns in one module. The benchmark runner (`benchmark-whisper.cpp.js`) is similarly monolithic — WAV parsing, WER scoring, CLI orchestration, FFI management, and report generation all live in the same file, making it unclear which functions are reusable vs. CLI-only. This friction slows iteration on the three most active domains (captions, meetings, summaries) and discourages the team from writing targeted tests.

## Solution

Extract three domain-level feature modules from `backend/index.js` — **summary**, **meeting**, and **caption** — each with explicit dependency injection and own test coverage. Compose them back through a testable server bootstrap that preserves every HTTP and Socket.io contract. On the desktop side, split the benchmark runner into shared utilities and CLI orchestration so the reusable functions have clear ownership and the CLI wrapper remains unchanged as the public entrypoint.

## User Stories

1. As a developer modifying the summarization prompt or provider logic, I want the summary route, LLM provider dispatch, and response validation to live in a single `features/summary.js` module so that I can change behavior without touching meeting or caption code.
2. As a developer debugging a Socket.io join-order defect, I want the meeting lifecycle (join, leave, host reassignment, session-start resolution, room-end) to be owned by a single `features/meeting.js` module so that I can trace the state machine end-to-end.
3. As a developer adding partial-caption persistence or changing idempotency TTL, I want the caption broadcast, transcript upsert, duplicate suppression, and history ack to be owned by a single `features/caption.js` module so that I can reason about caption state without searching the entire index file.
4. As a developer writing a regression test for a meeting lifecycle bug, I want to instantiate the backend with mock Prisma and mock Socket.io so that I can assert join/leave ordering and host reassignment without a real database or network.
5. As a developer running WER calculations outside the benchmark CLI, I want `calculateWer`, `normalizeForWer`, `parsePcmWav`, and `validateSampleId` to come from a dedicated `benchmark-utils.js` module so that they are clearly reusable and independently testable.
6. As a developer running the benchmark, I want `node desktop/stt/benchmark-whisper.cpp.js --help` and the npm scripts to work exactly as they do today, without learning new entrypoints or flags.
7. As a developer preparing AMI data, I want `prepare-ami-benchmark.js` to import shared utilities from `benchmark-utils.js` (not the CLI wrapper) so that the dependency direction is clear.
8. As a developer reading benchmark documentation, I want the documented commands, modes, defaults, and comparison procedures to match the actual scripts so that I can reproduce past results.
9. As a developer running the project checks, I want `npm --prefix backend test`, `npm --prefix desktop test`, `npm --prefix frontend test`, and `npm --prefix frontend run lint` to all pass after the refactor so that I know nothing regressed.

## Implementation Decisions

### Backend architecture

Three feature modules extracted from `backend/index.js`, each with explicit CommonJS exports and injected dependencies:

1. **`backend/features/summary.js`** — Owns `POST /meetings/:id/summary`. Receives `prisma`, `openai` SDK, and `anthropic` SDK via a factory or constructor. Imports `tokenEstimator` and `llmConfig` directly (these are stable utility modules). Preserves every validation branch (UUID, userId, llmConfig resolution), every query shape (current-session segments, rolling cutoff), every provider dispatch (OpenAI Responses, Anthropic Messages, DeepSeek Chat Completions), response parsing, persistence data, and status codes (400, 404, 502).

2. **`backend/features/meeting.js`** — Owns `POST /meetings`, `GET /meetings/:id/status`, and Socket.io handlers for `join-meeting`, `leave-meeting` (via `disconnect`), `signal`, and `status-change`. Centralizes the session-start fallback (`meeting.sessionStartedAt || meeting.startedAt`) and host assignment/reassignment logic. Receives `io`, `prisma`, and `meetingHosts` map via injection. Exposes a `purgeCaptionKeys` callback that the caption feature registers. Serialized joins (via `withMeetingJoinLock`) and the exact emission order (`host-info` → `user-joined` → `joined-successfully`), and `user-left` before `endedAt` update, are preserved exactly.

3. **`backend/features/caption.js`** — Owns the `caption` and `get-caption-history` Socket.io handlers plus the `persistedCaptionKeys` map and its cleanup interval. Receives `io`, `prisma`, and a `resolveSessionStart(meetingId)` function (delegating to the meeting feature's session resolution). Imports `captionHistory` module directly. Preserves partial-caption rejection, idempotency-key semantics (`meetingId:speakerId:utteranceId` with 1-hour TTL), failure release (delete key on persistence error), transcript upsert, duration increment, broadcast payload shape, and history authorization/acknowledgement.

**`backend/index.js`** becomes the composition root: it creates Prisma, Express, HTTP server, Socket.io, the shared maps (`meetingHosts`, `persistedCaptionKeys`), the `meetingJoinLocks`, wires all three features, starts the caption key cleanup interval, registers retention cleanup, and binds graceful shutdown. When `require.main === module`, it starts the server — preserving `node backend/index.js` as the startup contract.

A **`createApp(deps)` bootstrap factory** is exported for tests. This factory accepts injected Prisma and an io instance and returns the configured Express app plus a cleanup function. Contract tests create a real HTTP server + Socket.io client against mock Prisma state to verify end-to-end behavior.

### Benchmark refactoring

Three files replace the monolithic `benchmark-whisper.cpp.js`:

1. **`desktop/stt/benchmark-utils.js`** — Pure utility functions: `parsePcmWav`, `validateStreamingWav`, `normalizeForWer`, `calculateWer`, `cleanHypothesis`, `summarize`, `validateSampleId`, `safeFileName`, `writeTranscript`, `writeJsonAtomic`, `aggregateAccuracy`, `aggregateReport`. No side effects, no CLI args, no child process spawning.

2. **`desktop/stt/benchmark-runner.js`** — CLI orchestration: `usage()`, `main()`, streaming config parsing, offline/streaming/FFI dispatch, manifest loading, report assembly, the per-sample loop. Spawns sidecar processes, handles termination. Not imported by other modules.

3. **`desktop/stt/benchmark-whisper.cpp.js`** — Thin executable wrapper that re-exports the utility surface for backwards compatibility and delegates CLI execution to `benchmark-runner.js` when `require.main === module`. This preserves the existing `require('./benchmark-whisper.cpp')` contract for any consumers that haven't updated.

**`desktop/stt/prepare-ami-benchmark.js`** updates its require to `./benchmark-utils.js` for `parsePcmWav`, `validateSampleId`, `validateStreamingWav`.

### Naming conventions

- Feature modules follow `features/<domain>.js` with lowercase kebab-case directory naming
- Exported factory functions use `create<Feature>` naming (e.g., `createSummaryFeature`)
- Injected dependencies use explicit parameter names matching their role (`prisma`, `io`, `meetingHosts`)
- Function declarations for top-level exports — consistent with existing backend style (`captionHistory.js`, `llmConfig.js`)

## Testing Decisions

### Feature module tests

Each feature module gets focused tests at its injection boundary:

| Module | Test file | Strategy |
|---|---|---|
| `features/summary.js` | `test/summary.test.js` | Mock Prisma and LLM SDKs. Test: validation failures, absent meeting, no segments, malformed provider output, provider failures, successful summary with persisted fields and `_meta`. |
| `features/meeting.js` | `test/meeting.test.js` | Mock Prisma, io, and socket objects. Test: meeting creation validation + response payload, status with active/inactive room, join lifecycle ordering (`host-info` → `user-joined` → `joined-successfully`), host reassignment on leave, session fallback resolution, signal relay, status-change relay, room-empty `endedAt` update, `user-left` before `endedAt`. |
| `features/caption.js` | `test/caption.test.js` | Mock Prisma, io, and socket objects. Test: successful caption broadcast with correct `captionId`, `speakerName`, `sessionStartedAt`, `createdAt`; partial caption rejection; idempotency duplicate suppression; write failure rollback (key deleted); room-empty key purging; caption-history authorization, pagination, and error payloads. |

### Contract tests

| Test file | Strategy |
|---|---|
| `test/serverContracts.test.js` | Real HTTP server + `socket.io-client` against mock Prisma state. Test: health, meeting create/status REST contracts, join/caption/history/leave Socket.io contracts. Cleanup server, sockets, and feature timers. |

### What makes a good test

- Assert only externally observable behavior — response status codes, response body shapes, Socket.io event order and payload fields, idempotency behavior.
- Never test internal implementation details (private helper naming, internal module structure).
- Follow prior art: `backend/test/llmConfig.test.js` and `backend/test/captionHistory.test.js` (mock Prisma, `node:test` + `node:assert/strict`).

### Existing tests preserved

- `backend/test/captionHistory.test.js` — unchanged
- `backend/test/llmConfig.test.js` — unchanged
- `desktop/test/stt-benchmark.test.js` — adapt imports to `benchmark-utils.js`, add wrapper-compatibility assertions
- All frontend tests and lint — unchanged

## Out of Scope

- Prisma schema changes, migrations, or stored-data format changes
- Reorganizing generated artifacts under `benchmark-results/`
- Adding a root `build` or `test` script to `package.json`
- Comprehensive backend-wide or repository-wide cleanup beyond the selected hotspots
- Changing the `whisper-streaming-sidecar.js` or `whisper-ffi-sidecar.js` implementation
- Adding or modifying AMI profile definitions under `desktop/stt/benchmark-datasets/`
- Changing the Electron main process, preload bridge, or renderer
- Adding a formatter, typecheck, or CI pipeline
- Changing the VAD threshold or any STT runtime behavior
- Modifying the Docker Compose configuration

## Further Notes

### Risk mitigations

- **Socket.io ordering**: Each feature module's Socket.io handlers are registered in the same order as the original `index.js`. The `join-meeting` handler retains the serialized `withMeetingJoinLock` semantics. `user-left` emission remains before the `endedAt` Prisma update within the same lock.
- **Caption idempotency**: The `persistedCaptionKeys` map and cleanup interval are created in `index.js` and injected into the caption feature, preserving the exact TTL (1 hour) and cleanup cadence (5 minutes).
- **Summary error handling**: The summary feature's exported route handler preserves the exact try/catch shape, `SummaryFormatError` detection, and the 502 fallback message text.
- **Benchmark compatibility**: `benchmark-whisper.cpp.js` re-exports the same named functions from `benchmark-utils.js` so any existing `require('./benchmark-whisper.cpp.js')` consumers see no change. The `#!/usr/bin/env node` shebang and `require.main === module` guard remain.
- **No Prisma changes**: `git diff --exit-code -- backend/prisma` is verified before completing each task.
