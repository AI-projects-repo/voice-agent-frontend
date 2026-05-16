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
  const sampleRate = useRef<number | null>(null);
  const channels = useRef<number | null>(null);
  const sampleWidth = useRef<number | null>(null);
  const audioChunksRef = useRef<Uint8Array[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  function concatChunks(chunks: Uint8Array[]) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  async function playPcm16(bytes: Uint8Array, sampleRate: number, channels: number) {
    const audioContext =
      audioContextRef.current ?? new AudioContext();
    audioContextRef.current = audioContext;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const sampleCount = bytes.length / 2 / channels;
    const audioBuffer = audioContext.createBuffer(channels, sampleCount, sampleRate);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const byteOffset = (i * channels + ch) * 2;
        const sample = view.getInt16(byteOffset, true); // little-endian PCM16
        audioBuffer.getChannelData(ch)[i] = sample / 32768;
      }
    }
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  }

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

  async function handleMessageFromAgent(event: MessageEvent) {
    console.log('Message from agent:', event.data);
    try{
      if (typeof event.data === 'string') {
        const agentmetadata = JSON.parse(event.data);
        if (agentmetadata.type === 'audio_start'){
          sampleRate.current = agentmetadata.sample_rate ?? null;
          channels.current = agentmetadata.channels ?? null;
          sampleWidth.current = agentmetadata.sample_width ?? null;
          audioChunksRef.current = [];
        } else if (agentmetadata.type === 'audio_end'){
          const merged = concatChunks(audioChunksRef.current);
          audioChunksRef.current = [];
          if (sampleRate.current && channels.current && sampleWidth.current === 2) {
            await playPcm16(merged, sampleRate.current, channels.current);
          } else {
            console.log('Unsupported audio metadata', {
              sampleRate: sampleRate.current,
              channels: channels.current,
              sampleWidth: sampleWidth.current,
            });
          }
        }
      }else{
        audioChunksRef.current.push(new Uint8Array(event.data));
      }
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
    </div>
  );
}

export default Panel;
