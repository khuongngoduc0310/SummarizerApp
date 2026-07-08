import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the built app from file://, so generated asset URLs
  // must be relative instead of absolute /assets/... paths.
  base: './',
  plugins: [react()],
})
