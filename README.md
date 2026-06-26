# MeetSummarizer

MeetSummarizer is a real-time video conferencing application that can run either as a website during development or as an Electron desktop executable shell. It translates conversations into actionable insights with a privacy-first philosophy: transcription happens directly on your device using WebGPU-accelerated Whisper models, ensuring your audio remains local and secure.

## Features

- **WebGPU-Accelerated STT**: Fast, on-device transcription using Whisper-small via Transformers.js.
- **Multi-LLM Summarization**: Integration with OpenAI (GPT-4o), Anthropic (Claude 3.5), and DeepSeek (V3).
- **Privacy Guaranteed**: Audio is processed locally. Only text transcripts are sent to your chosen AI provider for summarization.
- **Responsive Video Mesh**: High-performance WebRTC video grid with dynamic pinning and aspect-ratio control.
- **Device Management**: Hot-swap cameras, microphones, and speakers mid-meeting.
- **Real-time Signaling**: Instant caption broadcasting and participant synchronization via Socket.io.
- **Desktop Executable Shell**: Electron wrapper for the website UI with automatic local backend startup and runtime backend configuration.

## Tech Stack

### Frontend
- Framework: React
- Styling: Tailwind CSS + Vanilla CSS
- Transcription: @huggingface/transformers (WebGPU / Whisper)
- Signaling/RTC: Socket.io, WebRTC

### Backend
- Runtime: Node.js + Express
- Database: PostgreSQL (Prisma ORM)
- Real-time: Socket.io
- Providers: OpenAI SDK & Anthropic SDK

### Desktop
- Shell: Electron
- Mode: local desktop wrapper for the React website
- Runtime config: Electron preload provides backend URL/port to the renderer
- Backend lifecycle: Electron starts the local backend automatically in desktop mode

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js (v18+)
- A browser with WebGPU support (Chrome 113+, Edge 113+)
- Electron dependencies when running desktop mode

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/khuongngoduc0310/Summarizer.git
   cd Summarizer
   ```

2. Setup Environment Variables:
   Create a `.env` file in the `backend` directory:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5433/summarizer?schema=public"
   PORT=4000
   CORS_ORIGIN="http://localhost:5173"
   ```

3. Spin up the database services:
   ```bash
   docker compose up -d db redis
   ```

4. Install Dependencies:
   ```bash
   # Backend
   cd backend
   npm install
   npm run prisma:migrate

   # Frontend
   cd ../frontend
   npm install

   # Desktop executable shell
   cd ../desktop
   npm install
   ```

5. Run the website in browser mode:
   ```bash
   # Start Backend (from /backend)
   npm run dev

   # Start Frontend (from /frontend)
   npm run dev
   ```

6. Run the website as an Electron executable app:
   ```bash
   # Start Frontend dev server first
   cd frontend
   npm run dev

   # In another terminal, launch Electron
   cd desktop
   npm run dev
   ```

   In Electron mode, the desktop shell starts the backend automatically and passes the selected local backend URL to the React app at runtime.

### Testing

See [`TESTING.md`](./TESTING.md) for local, Docker, and manual smoke test steps.

## Project Structure

- `frontend/`: React website UI and WebGPU transcription workers.
- `backend/`: Express server, Socket handlers, and LLM integrations.
- `backend/prisma/`: Database schema and migrations.
- `desktop/`: Electron executable shell, preload bridge, and local backend launcher.


## Sequence Diagram

![Sequence Diagram](SequenceDiagram.png)


## Browser Logic

![Browser Logic](Browser.png)

## Contributing

Contributions are welcomed. Please feel free to submit a Pull Request.
