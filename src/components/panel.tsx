import { useState, useRef } from 'react';
import './panel.css';
import { Play, Square } from 'lucide-react';

const OFFER_URL = 'http://localhost:8080/offer';

const STOP_SIGNAL_JSON = JSON.stringify({
  type: 'signal',
  action: 'stop_audio',
});

function Panel() {
  const [status, setStatus] = useState('Stopped.');
  /** Negotiated WebRTC session (PC + mic stream). */
  const [isSession, setIsSession] = useState(false);
  /** Audio track is enabled and RTP is being sent. */
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pendingStopSignalRef = useRef(false);
  const [agentMessage, setAgentMessage] = useState('');

  function handleOpenDataChannelInterruption(dc: RTCDataChannel, pendingStopSignalRef: { current: boolean }) {
    // check if there is a pending stop signal
    if (pendingStopSignalRef.current) {
      pendingStopSignalRef.current = false;
      try {
        dc.send(STOP_SIGNAL_JSON);
      } catch(error) {
        console.log("Error sending stop signal", error);
      }
    }
  }

  function handleMessageFromAgent(event: MessageEvent) {
    console.log('Message from agent:', event.data);
    try{
      const agentmetadata = JSON.parse(event.data as string);
      setAgentMessage(agentmetadata.message);
    } catch(error) {
      console.log("Error parsing message from agent", error);
    }
  }


  function attachDataChannel(
    dc: RTCDataChannel,
    pendingStopSignalRef: { current: boolean },
    dcRef: { current: RTCDataChannel | null },
  ) {
    dcRef.current = dc;
    dc.onopen = () => handleOpenDataChannelInterruption(dc, pendingStopSignalRef);
    dc.onmessage = (event) => handleMessageFromAgent(event);
    dc.onclose = () => {
      if (dcRef.current === dc) dcRef.current = null;
    };
  }

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

  async function getStream(){
    setStatus('Getting microphone…');
    // if the stream is already open, return it
    if (pcRef.current && streamRef.current) {
      for (const t of streamRef.current.getAudioTracks()) {
        t.enabled = true;
      }
      setIsSendingAudio(true);
      setStatus('Recording… Audio is being sent to the server.');
      return streamRef.current;
    }
    // if the stream is not open, get it from the microphone
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    streamRef.current = stream;
    return stream;
  }

  async function handleStart() {
    try {

      const stream = await getStream();

      setStatus('Creating offer…');
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTrack(stream.getAudioTracks()[0], stream);

      // data channel for voice agent 
      const dc = pc.createDataChannel('voice-agent', { ordered: true });
      attachDataChannel(dc, pendingStopSignalRef, dcRef);

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
      cleanup();
    }
  }

  function handleStop() {
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
        console.log('Error sending stop signal');
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
      { agentMessage && (
        <div>
          <textarea id="agent-message" disabled value={agentMessage} readOnly /> 
        </div>
      )}
    </div>
  );
}

export default Panel;
