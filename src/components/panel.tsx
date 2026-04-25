import { useState, useRef } from 'react';
import './panel.css';
import { Play, Square } from 'lucide-react';

const OFFER_URL = 'http://localhost:8080/offer';

function Panel() {
  const [status, setStatus] = useState('Stopped.');
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  function cleanup() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsStreaming(false);
  }

  async function handleStart() {
    setError(null);
    try {
      setStatus('Getting microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;

      setStatus('Creating offer…');
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTrack(stream.getAudioTracks()[0], stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(OFFER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription!.sdp,
          type: pc.localDescription!.type,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || response.statusText);
      }

      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      setIsStreaming(true);
      setStatus('Recording… Audio is being sent to the server.');
    } catch (err) {
      setStatus('Stopped.');
      setError(err instanceof Error ? err.message : 'Failed to start');
      cleanup();
    }
  }

  function handleStop() {
    cleanup();
    setError(null);
    setStatus('Stopped. Server has saved the recording.');
  }

  return (
    <div className="panel">
      <h2>WebRTC Audio</h2>
      <div className="panel-controls">
        <button onClick={handleStart} disabled={isStreaming}>
          <Play size={16} />
          <span>Start</span>
        </button>
        <button onClick={handleStop} disabled={!isStreaming}>
          <Square size={16} />
          <span>Stop</span>
        </button>
      </div>
      <p className="panel-status">{status}</p>
      {error && <p className="panel-error">{error}</p>}
    </div>
  );
}

export default Panel;
