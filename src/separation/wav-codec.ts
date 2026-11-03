/** Shared 16-bit PCM writer used by the synchronous helper and export worker. */
export function encodeWavPcm(channels: Float32Array[], sampleRate: number, onProgress?: (percent: number) => void): ArrayBuffer {
  const channelCount = Math.min(channels.length, 2);
  const frames = channels[0]?.length || 0;
  if (!channelCount || !frames || channels.slice(0, channelCount).some(channel => channel.length !== frames)) {
    throw new Error('No audio to export.');
  }
  const dataLength = frames * channelCount * 2;
  if (dataLength > 0xffffffff - 36) throw new Error('Audio is too long for WAV. Trim it or export MP3.');
  const bytes = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, dataLength, true);
  let offset = 44;
  onProgress?.(0);
  for (let start = 0; start < frames; start += 65536) {
    const end = Math.min(start + 65536, frames);
    for (let i = start; i < end; i++) {
      for (let ch = 0; ch < channelCount; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)), true);
        offset += 2;
      }
    }
    onProgress?.(Math.round(end / frames * 100));
  }
  return bytes;
}
