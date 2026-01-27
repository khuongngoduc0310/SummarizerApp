# Meet Summarizer - Development Progress

**Privacy‑first video meeting app with local transcription and cloud LLM summarization (text‑only).**

This document is the **single source of truth** for contributors. Anyone should be able to clone the repo, run the system locally, and understand the full data flow.

---

## ✅ Completed Tasks

### Phase 1: Project Setup ✅
- [x] Repository structure created
- [x] Docker Compose configuration
- [x] Environment variables template (.env.example)
- [x] README.md with basic setup instructions

### Phase 2: Backend ✅
- [x] Node.js/Express server setup
- [x] Socket.io integration for real-time communication
- [x] PostgreSQL database schema (Meeting, Transcript models) ✅
- [x] Database migration and port conflict resolution (Port 5433) ✅
- [x] `/meetings` POST endpoint for creating meetings
- [x] Socket.io events: `join-meeting`, `signal`, `caption`
- [x] Health check endpoint

### Phase 3: Frontend ✅
- [x] React + Vite setup
- [x] Tailwind CSS v4 configuration
- [x] PostCSS configuration
- [x] Component architecture:
  - [x] JoinScreen component (landing/preview page)
  - [x] MeetingControls component
  - [x] CaptionPanel component
  - [x] SummaryPanel component
- [x] Premium UI design with glassmorphism
- [x] Socket.io client integration
- [x] Device selection (camera, microphone, speakers)
- [x] Media preview with permissions handling
- [x] Create/Join meeting flows

### Phase 4: Browser-Side Transcription ✅
- [x] transformers.js integration
- [x] Web Worker for Whisper
- [x] Browser-side model loading
- [x] 16kHz audio conversion

---

## 🚧 In Progress / Next Steps

### Phase 5: WebRTC Integration 🔄
- [ ] Implement simple-peer for P2P connections
- [ ] Audio/video stream handling
- [ ] Signaling logic via Socket.io
- [ ] Connection state management
- [ ] Multiple participant support

### Phase 6: Audio Processing Pipeline ✅
- [x] Audio chunking (20-30 second chunks)
- [x] Send audio chunks to transcription node
- [x] Handle transcription responses
- [x] Display live captions in UI
- [x] Deduplication logic for overlapping chunks (Basic implementation)

### Phase 7: LLM Integration 📋
- [ ] Backend endpoint for summary generation
- [ ] LLM API integration (OpenAI/Anthropic)
- [ ] Prompt engineering for meeting summaries
- [ ] Summary storage in database
- [ ] Display summaries in UI

### Phase 8: Polish & Testing 📋
- [ ] Error handling improvements
- [ ] Loading states and feedback
- [ ] Reconnection logic
- [ ] Browser compatibility testing
- [ ] Performance optimization

---

## 1. Goals & Design Principles

### Goals

* Video meetings with real‑time captions
* **Local transcription** (audio never leaves trusted machines)
* **LLM‑based meeting summaries** (text only)
* Simple dev setup, clear path to production

### Non‑Goals (for MVP)

* Full E2EE across SFU
* Mobile clients
* Calendar integrations

### Core Principles

* Audio is private and local
* Text is the only data sent to AI APIs
* Clear separation of responsibilities
* Easy to clone, run, and extend

---

## 2. High‑Level Architecture

```
Browser Clients (WebRTC + Whisper WASM)
        │
        │ local transcription
        ▼
  Transcript Text
        │
        │ Socket.io
        ▼
  Backend API
        │
        │ text only
        ▼
  LLM API (Summary)
```

---

## 3. Repository Structure

```
meet-summarizer/
├─ README.md                    ✅
├─ .env.example                 ✅
├─ docker-compose.yml           ✅
├─ Plan.md                      ✅
├─ backend/                     ✅
│  ├─ Dockerfile                ✅
│  ├─ package.json              ✅
│  ├─ index.js                  ✅
│  └─ prisma/
│     └─ schema.prisma          ✅
├─ frontend/                    ✅
│  ├─ Dockerfile                ✅
│  ├─ package.json              ✅
│  ├─ vite.config.js            ✅
│  ├─ postcss.config.js         ✅
│  ├─ src/
│  │  ├─ main.jsx               ✅
│  │  ├─ App.jsx                ✅
│  │  ├─ index.css              ✅
│  │  └─ components/
│  │     ├─ JoinScreen.jsx      ✅
│  │     ├─ MeetingControls.jsx ✅
│  │     ├─ CaptionPanel.jsx    ✅
│  │     └─ SummaryPanel.jsx    ✅
├─ transcription-node/          ✅
│  ├─ main.py                   ✅
│  └─ requirements.txt          ✅
├─ infra/                       📋 (Future)
└─ scripts/                     📋 (Future)
```

### Key Folders

| Folder             | Responsibility                | Status |
| ------------------ | ----------------------------- | ------ |
| frontend           | Web UI + WebRTC               | ✅ 90% |
| backend            | API, signaling, storage       | ✅ 80% |
| transcription-node | Local speech‑to‑text          | ✅ 70% |
| infra              | Production notes (SFU, certs) | 📋     |

---

## 4. Development Environment

### Required

* Docker + Docker Compose ✅
* Node.js (18+) ✅
* Python 3.9+ ✅
* Microphone ✅

### Optional

* GPU (for faster Whisper)

---

## 5. Dev Setup (Step‑by‑Step)

### 5.1 Clone & Configure

```bash
git clone https://github.com/yourorg/meet-summarizer.git
cd meet-summarizer
cp .env.example .env
```

Set in `.env`:

```
LLM_API_KEY=your_api_key_here
```

---

### 5.2 Start Backend & Frontend

```bash
docker compose up --build
```

Services started:

* Backend → [http://localhost:4000](http://localhost:4000)
* Frontend → [http://localhost:5173](http://localhost:5173) (Vite default)
* Postgres + Redis

---

### 5.3 Start Browser Transcription
Transcription happens automatically in the browser using WebAssembly. No Python server is required.
> ⚠️ Audio stays in the browser.

---

## 6. Current Implementation Status

### ✅ Working Features

1. **Join Screen**
   - Video preview with camera/mic controls
   - Device selection (camera, microphone, speakers)
   - Permission handling
   - Create new meeting
   - Join existing meeting by ID
   - Display name input
   - Premium UI with glassmorphism effects

2. **Backend**
   - Meeting creation endpoint
   - Socket.io real-time communication
   - Database schema for meetings and transcripts
   - Caption broadcasting

3. **Transcription Node**
   - FastAPI server
   - Whisper model integration
   - Audio transcription endpoint

### 🚧 Needs Implementation

1. **WebRTC P2P Connection**
   - Peer connection establishment
   - Audio/video streaming
   - Signaling via Socket.io

2. **Audio Pipeline**
   - Audio chunking
   - Send chunks to transcription node
   - Display live captions

3. **LLM Integration**
   - Summary generation endpoint
   - LLM API calls
   - Summary display

---

## 7. Audio Chunking Rules

### Chunking

* Chunk size: **20–30 seconds**
* Overlap: **1–3 seconds**

### Payload Example

```json
{
  "meeting_id": "abc",
  "speaker_id": "user-1",
  "start_ts": 30.0,
  "data_b64": "..."
}
```

---

## 8. Local Transcription Flow

1. Transcription node receives chunk
2. Runs Whisper / faster‑whisper
3. Produces timestamped segments
4. Deduplicates overlap
5. Sends text segments to backend

### Transcript Segment Format

```json
{
  "speaker_id": "user-1",
  "start": 31.2,
  "end": 34.5,
  "text": "I will finish the auth module by Friday"
}
```

---

## 9. Backend Responsibilities

* Store transcript segments ✅
* Broadcast live captions via WebSocket ✅
* Handle summary requests 📋
* Persist summaries 📋

### Transcript Table (Implemented)

| Field      | Description     |
| ---------- | --------------- |
| meeting_id | Meeting UUID    |
| speaker_id | User ID         |
| start      | Start time (s)  |
| end        | End time (s)    |
| text       | Transcript text |

---

## 10. Summary Generation Flow

### Trigger

* Manual: "Generate Summary" button
* Automatic: meeting end (optional)

### Steps

1. Fetch transcript segments
2. Chunk transcript (5–10 min)
3. Send **text only** to LLM API
4. Receive structured summary
5. Store result

---

## 11. LLM Summary Output

The summary contains:

* Executive summary (3–5 sentences)
* Action items (task, owner, due date)
* Decisions made
* Open questions

---

## 12. Error Handling (Dev)

### Transcription Node Down

* Meeting continues
* UI shows warning
* No new captions

### LLM Failure

* Summary marked FAILED
* Retry allowed
* Transcript preserved

---

## 13. Dev Shortcuts

### Skip Real STT

* Stub transcription function
* Return fake text
* Develop UI & summary fast

### Skip WebRTC

* Use text input
* Still test full pipeline

---

## 14. Dev → Production Mapping

| Development    | Production                 |
| -------------- | -------------------------- |
| P2P WebRTC     | SFU (mediasoup)            |
| Owner STT      | Dedicated trusted STT node |
| Local FastAPI  | Secure on‑prem STT service |
| Manual summary | Auto summary               |

---

## 15. Security Model

* Audio: local only
* Transcript: encrypted at rest
* LLM: text‑only, no PII beyond transcript
* Owner controls deletion & retention

---

## 16. Why This Project Matters

* Realistic system design
* Privacy‑first AI integration
* Clear separation of concerns
* Resume‑ready architecture

---

## 17. Next Immediate Steps

1. **Implement WebRTC P2P** (Priority: High)
   - Add simple-peer to frontend
   - Create peer connection logic
   - Handle signaling events
   - Test with 2 participants

2. **Connect Audio Pipeline** (Priority: High)
   - Capture audio from WebRTC stream
   - Chunk audio data
   - Send to transcription node
   - Display captions in real-time

3. **Add LLM Integration** (Priority: Medium)
   - Create backend summary endpoint
   - Integrate OpenAI/Anthropic API
   - Store summaries in database
   - Display in SummaryPanel

4. **Testing & Polish** (Priority: Medium)
   - Error handling
   - Loading states
   - Reconnection logic
   - Performance optimization

---

**End of document**
