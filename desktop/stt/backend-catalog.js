'use strict';

const WHISPER_CPP_CUDA_11_8_WINDOWS_X64 = Object.freeze({
  id: 'whisper-cpp-cuda-11.8-windows-x64',
  engine: 'whisper.cpp',
  version: 'v1.9.1',
  commit: 'f049fff95a089aa9969deb009cdd4892b3e74916',
  platform: 'win32',
  architecture: 'x64',
  acceleration: 'cuda',
  cudaVersion: '11.8',
  asset: Object.freeze({
    id: 451903965,
    name: 'whisper-cublas-11.8.0-bin-x64.zip',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-cublas-11.8.0-bin-x64.zip',
    size: 278557654,
    sha256: 'aecdce0e4d4bb758a7c72a31f3f9f19a7b6d861405fd2da743cd86398633c963'
  }),
  downloadSize: 278557654,
  installedSize: 622666240,
  requiredFreeSpace: 1200000000,
  selectiveExtraction: true,
  archivePrefix: 'Release/',
  archivePaths: Object.freeze([
    'Release/whisper-cli.exe',
    'Release/whisper.dll',
    'Release/ggml.dll',
    'Release/ggml-base.dll',
    'Release/ggml-cpu-alderlake.dll',
    'Release/ggml-cpu-cannonlake.dll',
    'Release/ggml-cpu-cascadelake.dll',
    'Release/ggml-cpu-haswell.dll',
    'Release/ggml-cpu-icelake.dll',
    'Release/ggml-cpu-sandybridge.dll',
    'Release/ggml-cpu-skylakex.dll',
    'Release/ggml-cpu-sse42.dll',
    'Release/ggml-cpu-x64.dll',
    'Release/ggml-cuda.dll',
    'Release/cudart64_110.dll',
    'Release/cuinj64_118.dll',
    'Release/nvrtc-builtins64_118.dll',
    'Release/nvrtc64_112_0.dll'
  ]),
  requiredFiles: Object.freeze([
    'whisper-cli.exe',
    'whisper.dll',
    'ggml.dll',
    'ggml-base.dll',
    'ggml-cpu-x64.dll',
    'ggml-cuda.dll',
    'cudart64_110.dll'
  ]),
  limits: Object.freeze({
    maxEntries: 256,
    maxEntryUncompressedSize: 600000000,
    maxTotalUncompressedSize: 700000000
  }),
  allowedHttpsHosts: Object.freeze([
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com'
  ])
});

const BACKEND_CATALOG = Object.freeze({
  [WHISPER_CPP_CUDA_11_8_WINDOWS_X64.id]: WHISPER_CPP_CUDA_11_8_WINDOWS_X64
});

module.exports = {
  BACKEND_CATALOG,
  WHISPER_CPP_CUDA_11_8_WINDOWS_X64
};
