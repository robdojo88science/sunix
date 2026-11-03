import { Mp3Encoder } from '@breezystack/lamejs';

self.onmessage = ({ data }: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const { channels, sampleRate } = data;
    const encoder = new Mp3Encoder(channels.length, sampleRate, 192);
    const chunks: Uint8Array[] = [];
    const blockSize = 1152;
    const total = channels[0].length;
    let previousPercent = -1;
    for (let start = 0; start < total; start += blockSize) {
      const count = Math.min(blockSize, total - start);
      const pcm = channels.map(channel => {
        const output = new Int16Array(count);
        for (let i = 0; i < count; i++) {
          const sample = Math.max(-1, Math.min(1, channel[start + i]));
          output[i] = Math.round(sample * (sample < 0 ? 32768 : 32767));
        }
        return output;
      });
      const chunk = channels.length === 2 ? encoder.encodeBuffer(pcm[0], pcm[1]) : encoder.encodeBuffer(pcm[0]);
      if (chunk.length) chunks.push(new Uint8Array(chunk));
      const percent = Math.floor((start + count) / total * 99);
      if (percent !== previousPercent) { self.postMessage({ type: 'progress', percent }); previousPercent = percent; }
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
    self.postMessage({ type: 'done', bytes }, { transfer: [bytes.buffer] });
  } catch {
    self.postMessage({ type: 'error' });
  }
};
