'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { BACKEND_CATALOG, WHISPER_CPP_CUDA_11_8_WINDOWS_X64: backend } = require('../stt/backend-catalog');

test('pins the verified whisper.cpp CUDA 11.8 Windows x64 release asset', () => {
  assert.equal(BACKEND_CATALOG[backend.id], backend);
  assert.equal(backend.version, 'v1.9.1');
  assert.equal(backend.commit, 'f049fff95a089aa9969deb009cdd4892b3e74916');
  assert.equal(backend.asset.id, 451903965);
  assert.equal(backend.asset.size, 278557654);
  assert.equal(backend.asset.sha256, 'aecdce0e4d4bb758a7c72a31f3f9f19a7b6d861405fd2da743cd86398633c963');
  assert.equal(backend.downloadSize, backend.asset.size);
  assert.equal(backend.installedSize, 622666240);
});

test('uses an exact selective Release runtime allowlist', () => {
  assert.equal(backend.selectiveExtraction, true);
  assert.equal(backend.archivePaths.length, 18);
  assert.ok(backend.archivePaths.every((name) => name.startsWith('Release/')));
  assert.ok(backend.archivePaths.includes('Release/whisper-cli.exe'));
  assert.ok(backend.archivePaths.includes('Release/ggml-cpu-x64.dll'));
  assert.ok(backend.archivePaths.includes('Release/ggml-cpu-alderlake.dll'));
  assert.ok(backend.archivePaths.includes('Release/ggml-cuda.dll'));
  assert.ok(backend.archivePaths.includes('Release/cudart64_110.dll'));
  assert.ok(!backend.archivePaths.includes('Release/cudart32_110.dll'));
  assert.ok(backend.archivePaths.includes('Release/nvrtc64_112_0.dll'));
  assert.equal(new Set(backend.archivePaths.map((name) => name.toLowerCase())).size, backend.archivePaths.length);
});
