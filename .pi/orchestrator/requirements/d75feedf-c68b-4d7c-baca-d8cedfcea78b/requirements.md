# Requirements: Improve project maintainability, primarily in the backend, while preserving existing behavior.

- Goal: Improve project maintainability, primarily in the backend, while preserving existing behavior.
- Summary: Refactor a few high-value backend hotspots into feature-oriented modules, prioritizing Socket.io meeting lifecycle and caption persistence/history. Reduce complexity, duplication, unclear boundaries, and naming inconsistencies while retaining CommonJS conventions. Preserve backend API and Socket.io behavior, make no Prisma schema changes, add targeted regression coverage, and improve the maintained native Whisper benchmark runner, AMI preparation script, and related documentation.

## Scope
- Refactor selected responsibilities from backend/index.js into feature modules organized around meeting, summary, and caption domains.
- Prioritize Socket.io meeting lifecycle and caption persistence/history responsibilities in backend/index.js.
- Consolidate duplicated logic or configuration encountered within the selected backend hotspots.
- Standardize affected backend naming and conventions according to existing CommonJS and nearby code style.
- Improve maintainability of desktop/stt/benchmark-whisper.cpp.js and desktop/stt/prepare-ami-benchmark.js.
- Keep relevant maintained benchmark documentation, including docs/STT_NATIVE_WER_BENCHMARK.md and docs/STT_WEBGPU_BENCHMARK.md, consistent with the benchmark scripts.

## Constraints
- Preserve externally observable behavior exactly.
- Keep existing backend API and Socket.io contracts unchanged.
- Do not change the Prisma schema or introduce stored-data migrations under backend/prisma/.
- Preserve caption persistence and history behavior while extracting responsibilities from backend/index.js.
- Continue using CommonJS and follow the surrounding backend style.
- Limit the refactor to a few high-value hotspots rather than performing a comprehensive backend or repository-wide cleanup.
- Do not reorganize generated artifacts under benchmark-results/.

## Acceptance criteria
- Socket.io meeting lifecycle and caption persistence/history responsibilities are separated into clear feature-oriented modules, with backend/index.js retaining orchestration responsibilities.
- The selected hotspots exhibit clearer module boundaries, reduced file or function complexity, less duplicated logic or configuration, and naming consistent with nearby backend code.
- Existing backend endpoints, response behavior, Socket.io events, payloads, and lifecycle behavior remain unchanged.
- No Prisma schema or data migration files are added or modified for the refactor.
- Unit tests cover the extracted backend modules, and regression tests verify backend API and Socket.io contracts.
- All existing project checks continue to pass alongside the targeted regression tests.
- The benchmark runner and AMI preparation script retain their existing behavior while becoming easier to understand and maintain.
- Maintained benchmark documentation accurately reflects the benchmark scripts and procedures after the changes.

## Interview record

### Which area should be the primary target of maintainability improvements?
- Answer: Backend server and database code

### Which maintainability problems should the work address?
- Answer: Unclear module boundaries, Duplicated logic or configuration, Inconsistent naming and conventions, Large or complex files

### How much externally observable behavior may change?
- Answer: None; preserve behavior exactly

### Which compatibility boundaries must remain unchanged?
- Answer: Backend API and Socket.io contracts

### What scope of refactoring is appropriate for this effort?
- Answer: A few high-value hotspots

### What evidence should define success?
- Answer: Existing checks pass plus targeted regression tests

### How should benchmark-related assets be treated?
- Answer: Include scripts and maintained benchmark documentation

### Which backend/index.js hotspots should be prioritized?
- Answer: Socket.io meeting lifecycle, Caption persistence and history

### What module-boundary style should replace backend/index.js responsibilities?
- Answer: Feature modules by meeting, summary, and caption domain

### How should backend naming and code conventions be standardized?
- Answer: Follow existing CommonJS and nearby style

### May the refactor change the Prisma schema or stored-data representation while preserving API behavior?
- Answer: No schema or data migration changes

### What targeted regression-test coverage should accompany backend extraction?
- Answer: Unit tests for extracted modules plus API and Socket.io contract tests

### Which benchmark maintainability scope is intended?
- Answer: Runner, AMI preparation script, and maintained benchmark docs
