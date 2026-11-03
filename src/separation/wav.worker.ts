import { encodeWavPcm } from './wav-codec';

self.onmessage = ({ data }: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const bytes = encodeWavPcm(data.channels, data.sampleRate, percent => self.postMessage({ type: 'progress', percent }));
    self.postMessage({ type: 'done', bytes }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'WAV export failed. Try a shorter audio file.' });
  }
};
