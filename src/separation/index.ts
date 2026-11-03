export interface Stem { name: string; buffer: AudioBuffer; color: string }
export interface SeparationOptions {
  mode: 2 | 4;
  quality: 'fast' | 'balanced' | 'high';
  onProgress?: (percent: number, stage: string) => void;
  signal?: AbortSignal;
}

/** The large inference runtime is loaded only inside a disposable separation worker. */
export async function separateAudio(input: AudioBuffer, options: SeparationOptions): Promise<Stem[]> {
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (options.quality === 'fast' && options.mode !== 2) {
    throw new Error('Center/side supports 2 tracks. Choose Balanced for 4 stems.');
  }
  if (options.quality === 'fast' && input.numberOfChannels < 2) {
    throw new Error('Center/side needs stereo audio. Choose Balanced for mono.');
  }
  let buffer = input;
  if (options.quality !== 'fast' && input.sampleRate !== 44100) {
    options.onProgress?.(0, 'Preparing audio');
    const context = new OfflineAudioContext(2, Math.ceil(input.duration * 44100), 44100);
    const source = context.createBufferSource(); source.buffer = input; source.connect(context.destination); source.start();
    buffer = await context.startRendering();
  }
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./separate.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { options.signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') options.onProgress?.(data.percent, data.stage);
      if (data.type === 'error') { finish(); reject(new Error(data.message)); }
      if (data.type === 'done') {
        try {
          const stems = (data.stems as { name: string; channels: Float32Array[]; color: string }[]).map(stem => {
            const output = new AudioBuffer({ numberOfChannels: 2, length: stem.channels[0].length, sampleRate: buffer.sampleRate });
            stem.channels.forEach((channel, ch) => output.copyToChannel(new Float32Array(channel), ch));
            return { name: stem.name, color: stem.color, buffer: output };
          });
          finish();
          resolve(stems);
        } catch {
          finish(); reject(new Error('Not enough memory. Try a shorter audio file or Center/side mode.'));
        }
      }
    };
    worker.onerror = () => { finish(); reject(new Error("Audio engine couldn't start. Try Center/side mode or a shorter audio file.")); };
    const channels = [buffer.getChannelData(0).slice(), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)).slice()];
    worker.postMessage({ channels, mode: options.mode, quality: options.quality }, channels.map(channel => channel.buffer));
  });
}
