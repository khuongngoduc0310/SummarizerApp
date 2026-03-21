# MeetSummarizer

MeetSummarizer is a real-time video conferencing application that translates your conversations into actionable insights. Built with a privacy-first philosophy, transcription happens directly on your device using WebGPU-accelerated Whisper models, ensuring your audio remains local and secure.

## Features

- **WebGPU-Accelerated STT**: Fast, on-device transcription using Whisper-small via Transformers.js.
- **Multi-LLM Summarization**: Integration with OpenAI (GPT-4o), Anthropic (Claude 3.5), and DeepSeek (V3).
- **Privacy Guaranteed**: Audio is processed locally. Only text transcripts are sent to your chosen AI provider for summarization.
- **Responsive Video Mesh**: High-performance WebRTC video grid with dynamic pinning and aspect-ratio control.
- **Device Management**: Hot-swap cameras, microphones, and speakers mid-meeting.
- **Real-time Signaling**: Instant caption broadcasting and participant synchronization via Socket.io.

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

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js (v18+)
- A browser with WebGPU support (Chrome 113+, Edge 113+)

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
   ```

3. Spin up the Infrastructure:
   ```bash
   docker-compose up -d
   ```

4. Install Dependencies:
   ```bash
   # Backend
   cd backend
   npm install
   npx prisma migrate dev

   # Frontend
   cd ../frontend
   npm install
   ```

5. Run the Application:
   ```bash
   # Start Backend (from /backend)
   npm run dev

   # Start Frontend (from /frontend)
   npm run dev
   ```

## Project Structure

- `frontend/`: React application and WebGPU Transcription Workers.
- `backend/`: Express server, Socket handlers, and LLM integrations.
- `backend/prisma/`: Database schema and migrations.


## Sequence Diagram

![Sequence Diagram](SequenceDiagram.png)


## Browser Logic

![Browser Logic](Browser.png)

## Contributing

Contributions are welcomed. Please feel free to submit a Pull Request.
