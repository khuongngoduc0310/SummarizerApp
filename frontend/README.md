# MeetSummarizer Renderer

This directory contains the React renderer used by the Electron desktop app.

It is intentionally not a standalone website. Build it with:

```bash
npm --prefix frontend run build
```

Electron loads the generated `frontend/dist/index.html` and injects runtime configuration through `window.desktopConfig` from `desktop/preload.js`.
