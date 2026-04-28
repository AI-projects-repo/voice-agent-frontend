import { useState, useRef } from 'react';
import './panel.css';
import { Play, Square } from 'lucide-react';

const OFFER_URL = 'http://localhost:8080/offer';

/** Sent on the negotiated `chatbot` data channel when the user stops sending audio. */
const STOP_SIGNAL_JSON = JSON.stringify({
  type: 'signal',
  action: 'stop_audio',
});

function attachChatbotDataChannel(
  dc: RTCDataChannel,
  pendingStopSignalRef: { current: boolean },
  dcRef: { current: RTCDataChannel | null },
) {
  dcRef.current = dc;
  dc.onopen = () => {
    if (pendingStopSignalRef.current) {
      pendingStopSignalRef.current = false;
      try {
        dc.send(STOP_SIGNAL_JSON);
      } catch {
        /* ignore */
      }
    }
  };
  dc.onclose = () => {
    if (dcRef.current === dc) dcRef.current = null;
  };
}

function Panel() {
  const [status, setStatus] = useState('Stopped.');
  const [error, setError] = useState<string | null>(null);
  /** Negotiated WebRTC session (PC + mic stream). */
  const [isSession, setIsSession] = useState(false);
  /** Audio track is enabled and RTP is being sent. */
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  /** If Stop runs before the chatbot channel exists or reaches "open", send then. */
  const pendingStopSignalRef = useRef(false);

  function cleanup() {
    dcRef.current = null;
    pendingStopSignalRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIsSession(false);
    setIsSendingAudio(false);
  }

  async function handleStart() {
    setError(null);
    try {
      if (pcRef.current && streamRef.current) {
        for (const t of streamRef.current.getAudioTracks()) {
          t.enabled = true;
        }
        setIsSendingAudio(true);
        setStatus('Recording… Audio is being sent to the server.');
        return;
      }

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

      // Offerer must create the DataChannel so SCTP is in the offer. On the server,
      // remove pc.createDataChannel("chatbot") and use pc.on("datachannel", ...) instead.
      const dc = pc.createDataChannel('chatbot', { ordered: true });
      attachChatbotDataChannel(dc, pendingStopSignalRef, dcRef);

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

      setIsSession(true);
      setIsSendingAudio(true);
      setStatus('Recording… Audio is being sent to the server.');
    } catch (err) {
      setStatus('Stopped.');
      setError(err instanceof Error ? err.message : 'Failed to start');
      cleanup();
    }
  }

  function handleStop() {
    setError(null);
    const stream = streamRef.current;
    if (stream) {
      for (const t of stream.getAudioTracks()) {
        t.enabled = false;
      }
    }
    const dc = dcRef.current;
    if (dc?.readyState === 'open') {
      try {
        dc.send(STOP_SIGNAL_JSON);
      } catch {
        /* ignore send errors */
      }
    } else {
      pendingStopSignalRef.current = true;
    }
    setIsSendingAudio(false);
    setStatus('Audio muted — connection stays open.');
  }

  const startDisabled = isSendingAudio;
  const stopDisabled = !isSession || !isSendingAudio;

  return (
    <div className="panel">
      <h2>WebRTC Audio</h2>
      <div className="panel-controls">
        <button onClick={handleStart} disabled={startDisabled}>
          <Play size={16} />
          <span>Start</span>
        </button>
        <button onClick={handleStop} disabled={stopDisabled}>
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
