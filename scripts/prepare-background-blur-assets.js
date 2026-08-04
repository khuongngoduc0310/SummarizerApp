const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'frontend', 'node_modules', '@mediapipe', 'selfie_segmentation');
const outputDir = path.join(__dirname, '..', 'frontend', 'public', 'background-blur');
const assets = [
  'selfie_segmentation.js',
  'selfie_segmentation.binarypb',
  'selfie_segmentation.tflite',
  'selfie_segmentation_landscape.tflite',
  'selfie_segmentation_solution_wasm_bin.js',
  'selfie_segmentation_solution_wasm_bin.wasm',
  'selfie_segmentation_solution_simd_wasm_bin.js',
  'selfie_segmentation_solution_simd_wasm_bin.wasm',
  'selfie_segmentation_solution_simd_wasm_bin.data'
];

fs.mkdirSync(outputDir, { recursive: true });

for (const asset of assets) {
  const source = path.join(sourceDir, asset);
  const output = path.join(outputDir, asset);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing bundled MediaPipe asset: ${source}`);
  }

  fs.copyFileSync(source, output);
}
