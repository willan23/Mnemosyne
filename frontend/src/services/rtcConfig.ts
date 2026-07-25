const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export function getRtcConfiguration(): RTCConfiguration {
  const raw = import.meta.env.VITE_WEBRTC_ICE_SERVERS as string | undefined;
  if (!raw) return { iceServers: DEFAULT_ICE_SERVERS };

  try {
    const parsed = JSON.parse(raw) as RTCIceServer[];
    return { iceServers: parsed };
  } catch {
    const urls = raw.split(',').map((url) => url.trim()).filter(Boolean);
    return {
      iceServers: urls.length > 0 ? urls.map((url) => ({ urls: url })) : DEFAULT_ICE_SERVERS,
    };
  }
}
