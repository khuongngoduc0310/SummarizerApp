# Plan: Configurable Native STT Overlap

## Goal

Allow the user to adjust native STT rolling-window overlap from the app settings, instead of hardcoding overlap behavior in the sidecar.

Current native sidecar defaults:

```text
windowSec = 4
stepSec = 1.5
maxBufferSec = 12
overlapSec = windowSec - stepSec = 2.5
```

Target default:

```text
windowSec = 4
overlapSec = 1
stepSec = windowSec - overlapSec = 3
maxBufferSec = 8
```

The settings UI should expose overlap duration as a user-adjustable advanced STT setting.

## Settings UX

Add an STT section to settings with:

- Native STT status: running, unavailable, fallback, error.
- Backend: CPU, Vulkan, browser WebGPU fallback.
- Model path/name.
- Window duration.
- Overlap duration.
- Derived step duration.
- Realtime factor.

Recommended overlap choices:

```text
No overlap:       0.0s  least duplicate text, highest boundary risk
Tiny overlap:     0.25s very low duplicate risk
Low overlap:      0.5s  faster, less duplicate text, higher boundary risk
Balanced overlap: 1.0s  recommended default
High overlap:     1.5s  safer word boundaries, more duplicate risk
Very high:        2.0s+ safer boundaries, highest duplicate risk
Custom:           0.0s-3.0s
```

Validation:

```text
0 <= overlapSec < windowSec
stepSec = windowSec - overlapSec
stepSec >= 0.5
```

## Implementation Steps

### 1. Add STT config state in the renderer

In `frontend/src/App.jsx`, add state backed by localStorage:

```js
const [sttConfig, setSttConfig] = useState(() => {
  return storage.get('stt_config') || {
    windowSec: 4,
    overlapSec: 1,
    maxBufferSec: 8
  };
});
```

Persist it:

```js
useEffect(() => {
  storage.set('stt_config', sttConfig);
}, [sttConfig]);
```

Pass it to `useAudioPipeline`:

```js
useAudioPipeline(socket, meetingId, localStream, userId, runtimeConfig, sttConfig);
```

### 2. Add settings controls

In the settings modal, add an STT section:

```text
Speech-to-text settings
- Overlap duration slider/input
- Window duration slider/input
- Effective step duration read-only
```

Recommended first UI:

```text
Window: 4.0 seconds
Overlap: [0.0 | 0.25 | 0.5 | 0.75 | 1.0 | 1.25 | 1.5 | 2.0 | 2.5]
Step: 3.0 seconds
```

### 3. Send overlap config with audio frames

In `frontend/src/hooks/useAudioPipeline.js`, include STT timing config in native frames:

```js
window.desktopStt.sendAudioFrame({
  meetingId,
  speakerId: userId,
  sequence,
  sampleRate: SAMPLE_RATE,
  format: 'f32le',
  durationSec: NATIVE_FRAME_DURATION,
  capturedAt: Date.now(),
  sttConfig: {
    windowSec,
    overlapSec,
    stepSec: windowSec - overlapSec,
    maxBufferSec
  },
  audio: frame
});
```

### 4. Add IPC config update method

In `desktop/preload.js` expose:

```js
window.desktopStt.updateConfig(config)
```

In `desktop/main.js` handle:

```js
ipcMain.handle('desktop-stt:update-config', (_event, config) => {
  return sttManager.updateConfig(config);
});
```

### 5. Update sidecar manager

In `desktop/stt/sidecar-manager.js`, add:

```js
updateConfig(config) {
  // validate, save, send to sidecar stdin as JSON line
}
```

It should send:

```json
{
  "type": "config",
  "windowSec": 4,
  "overlapSec": 1,
  "stepSec": 3,
  "maxBufferSec": 8
}
```

### 6. Update streaming sidecar

In `desktop/stt/whisper-streaming-sidecar.js`:

- Accept `config` messages from stdin.
- Validate config.
- Apply config to new sessions immediately.
- Apply config to existing sessions by updating:
  - `windowSamples`
  - `stepSamples`
  - `maxBufferSamples`

Emit status when config changes:

```json
{
  "type": "status",
  "status": "config-updated",
  "config": {
    "windowSec": 4,
    "overlapSec": 1,
    "stepSec": 3,
    "maxBufferSec": 8
  }
}
```

### 7. Add metrics

Each final event should include:

```js
metrics: {
  inferenceTimeMs,
  audioDurationSec,
  realtimeFactor,
  windowSec,
  stepSec,
  overlapSec,
  duplicateSuppressedCount
}
```

## Verification

Test these settings:

| Window | Overlap | Step | Expected |
| ---: | ---: | ---: | --- |
| 4.0s | 0.5s | 3.5s | Lowest duplicate risk |
| 4.0s | 1.0s | 3.0s | Recommended default |
| 4.0s | 1.5s | 2.5s | Safer boundaries, more repeats |

Manual checks:

- Changing overlap in settings updates native sidecar config.
- Effective step duration updates correctly.
- Captions continue after changing settings mid-meeting.
- Lower overlap produces fewer duplicate captions.
- Higher overlap does not create repeated persisted captions because duplicate suppression still applies.
