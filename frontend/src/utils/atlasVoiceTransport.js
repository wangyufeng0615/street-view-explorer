import { createRealtimeClientSecret } from "../services/api";
import {
  REALTIME_CALLS_URL,
  extractToken,
  realtimeWebSocketURL,
} from "./atlasVoiceConfig";
import { MIC_AUDIO_CONSTRAINTS } from "./atlasVoiceRuntime";

/** Thrown when the panel stopped or unmounted while a start was in flight. */
function voiceStartCancelled() {
  const error = new Error("Atlas voice start was cancelled");
  error.name = "AbortError";
  return error;
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/** Requests the microphone; any failure surfaces as the localized mic error. */
export async function getMicrophoneStream(micErrorMessage) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC_AUDIO_CONSTRAINTS);
  } catch (err) {
    throw new Error(micErrorMessage);
  }
  return stream;
}

/**
 * Default transport: same-origin WebSocket relay to `/api/v1/realtime/ws`,
 * with microphone PCM streamed over the socket.
 *
 * `isCurrent()` turns false once the panel cleaned this session up (stop,
 * unmount or a dropped connection); every await re-checks it so a late
 * microphone grant never outlives the session. `onClosed` runs when an open
 * connection drops so the panel can release the mic and audio graph.
 */
export async function startBackendWebSocketVoice({
  locale,
  copy,
  socketRef,
  localStreamRef,
  setStatus,
  handleRealtimeEvent,
  startMicrophoneStreaming,
  sendSessionUpdateForCurrentContext,
  showToastMessage,
  isCurrent = () => true,
  onClosed,
}) {
  const socket = new WebSocket(realtimeWebSocketURL(locale));
  socketRef.current = socket;
  socket.addEventListener("message", handleRealtimeEvent);

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error(copy.openaiError)),
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => reject(new Error(copy.openaiError)),
      { once: true },
    );
  });

  if (!isCurrent()) throw voiceStartCancelled();
  socket.addEventListener("close", () => {
    if (isCurrent()) onClosed?.();
  });

  const stream = await getMicrophoneStream(copy.micError);
  if (!isCurrent()) {
    stopStream(stream);
    throw voiceStartCancelled();
  }
  localStreamRef.current = stream;
  const started = await startMicrophoneStreaming(stream, socket, isCurrent);
  if (!isCurrent() || started === false) throw voiceStartCancelled();

  setStatus("connected");
  sendSessionUpdateForCurrentContext();
  showToastMessage(copy.connected);
}

/**
 * WebRTC compatibility transport: fetch an ephemeral client secret, then
 * exchange SDP through `/api/v1/realtime/calls`.
 */
export async function startWebRTCVoice({
  locale,
  copy,
  peerRef,
  channelRef,
  localStreamRef,
  remoteAudioRef,
  setStatus,
  handleRealtimeEvent,
  sendSessionUpdateForCurrentContext,
  showToastMessage,
  isCurrent = () => true,
  onClosed,
}) {
  const tokenResult = await createRealtimeClientSecret(locale);
  if (!isCurrent()) throw voiceStartCancelled();
  const token = extractToken(tokenResult.data);
  if (!tokenResult.success || !token) {
    throw new Error(tokenResult.error || copy.tokenError);
  }

  const peer = new RTCPeerConnection();
  peerRef.current = peer;

  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudioRef.current = remoteAudio;
  peer.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(() => {});
  };

  const stream = await getMicrophoneStream(copy.micError);
  if (!isCurrent()) {
    stopStream(stream);
    throw voiceStartCancelled();
  }
  localStreamRef.current = stream;
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));

  const channel = peer.createDataChannel("oai-events");
  channelRef.current = channel;
  channel.addEventListener("open", () => {
    if (!isCurrent()) return;
    setStatus("connected");
    sendSessionUpdateForCurrentContext();
    showToastMessage(copy.connected);
  });
  channel.addEventListener("message", handleRealtimeEvent);
  channel.addEventListener("close", () => {
    if (isCurrent()) onClosed?.();
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  if (!isCurrent()) throw voiceStartCancelled();

  const sdpResponse = await fetch(REALTIME_CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/sdp",
    },
  });

  if (!isCurrent()) throw voiceStartCancelled();
  if (!sdpResponse.ok) {
    const body = await sdpResponse.text();
    throw new Error(body || copy.openaiError);
  }

  await peer.setRemoteDescription({
    type: "answer",
    sdp: await sdpResponse.text(),
  });
}

/** Closes the data channel / socket / peer and releases mic and remote audio. */
export function closeRealtimeTransport({
  channelRef,
  socketRef,
  peerRef,
  localStreamRef,
  remoteAudioRef,
}) {
  const channel = channelRef.current;
  if (channel) {
    channel.close();
    channelRef.current = null;
  }

  const socket = socketRef.current;
  if (socket) {
    socket.close();
    socketRef.current = null;
  }

  const peer = peerRef.current;
  if (peer) {
    peer.getSenders().forEach((sender) => {
      if (sender.track) sender.track.stop();
    });
    peer.close();
    peerRef.current = null;
  }

  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }

  if (remoteAudioRef.current) {
    remoteAudioRef.current.srcObject = null;
    remoteAudioRef.current = null;
  }
}
