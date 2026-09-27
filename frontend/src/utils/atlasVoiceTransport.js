import { createRealtimeClientSecret } from "../services/api";
import {
  REALTIME_CALLS_URL,
  extractToken,
  realtimeWebSocketURL,
} from "./atlasVoiceConfig";
import { MIC_AUDIO_CONSTRAINTS } from "./atlasVoiceRuntime";

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
 */
export async function startBackendWebSocketVoice({
  locale,
  copy,
  socketRef,
  localStreamRef,
  statusRef,
  setStatus,
  handleRealtimeEvent,
  startMicrophoneStreaming,
  sendSessionUpdateForCurrentContext,
  showToastMessage,
}) {
  const socket = new WebSocket(realtimeWebSocketURL(locale));
  socketRef.current = socket;
  socket.addEventListener("message", handleRealtimeEvent);
  socket.addEventListener("close", () => {
    if (statusRef.current !== "idle") setStatus("idle");
  });

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

  const stream = await getMicrophoneStream(copy.micError);
  localStreamRef.current = stream;
  await startMicrophoneStreaming(stream, socket);

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
  statusRef,
  setStatus,
  handleRealtimeEvent,
  sendSessionUpdateForCurrentContext,
  showToastMessage,
}) {
  const tokenResult = await createRealtimeClientSecret(locale);
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
  localStreamRef.current = stream;
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));

  const channel = peer.createDataChannel("oai-events");
  channelRef.current = channel;
  channel.addEventListener("open", () => {
    setStatus("connected");
    sendSessionUpdateForCurrentContext();
    showToastMessage(copy.connected);
  });
  channel.addEventListener("message", handleRealtimeEvent);
  channel.addEventListener("close", () => {
    if (statusRef.current !== "idle") setStatus("idle");
  });

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const sdpResponse = await fetch(REALTIME_CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/sdp",
    },
  });

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
