# Audio Agent (WebRTC Frontend)

Frontend app for streaming microphone audio to a backend over WebRTC and receiving chatbot messages through a data channel.

- App version: `0.0.0` (from `package.json`)
- Stack: React 19 + TypeScript + Vite 7
- UI: single panel with `Start` / `Stop` controls

## What it does

- Creates a WebRTC peer connection from the browser.
- Captures microphone audio with `getUserMedia`.
- Sends SDP offer to backend signaling endpoint: `POST http://localhost:8080/offer`.
- Applies SDP answer returned by backend.
- Opens a WebRTC data channel (`chatbot`) to receive text messages.
- Supports soft stop: mutes microphone and sends a `stop_audio` signal while keeping the session open.

## Message contract

### Stop signal sent to backend

```json
{
  "type": "signal",
  "action": "stop_audio"
}
```

### Chatbot message expected from backend

The UI expects data channel messages to be JSON with a `message` field:

```json
{
  "message": "Your assistant response text"
}
```

## Run locally

### Prerequisites

- Node.js 20+
- npm 10+
- A backend server running on `http://localhost:8080` implementing `POST /offer`

### Install

```bash
npm install
```

### Start development server

```bash
npm run dev
```

Then open the local URL shown by Vite (usually `http://localhost:5173`).

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

### Lint

```bash
npm run lint
```

## Project structure

- `src/components/panel.tsx`: WebRTC/session logic and UI actions.
- `src/components/panel.css`: panel and control styling.
- `src/App.tsx`: app root rendering the panel.

## Notes and limitations

- The signaling endpoint URL is currently hardcoded in `panel.tsx`.
- Microphone permission is required in the browser.
- Data channel messages are parsed as JSON without schema validation.
