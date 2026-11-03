export { separateAudio } from './separation';
export type { Stem, SeparationOptions } from './separation';
import { encodeWavPcm } from './separation/wav-codec';

export interface MixTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
}

export interface PlayerState { time: number; duration: number; playing: boolean }
export interface OriginalOptions {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  normalize: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function audioConstructor(): typeof AudioContext {
  const Constructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) throw new Error("Audio engine couldn't start. Try another browser.");
  return Constructor;
}

/** Decode through the browser: support depends on the browser's installed codecs. */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  const context = new (audioConstructor())({ sampleRate: 44100 });
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Audio format not supported. Try MP3, WAV, or M4A.');
  } finally {
    await context.close().catch(() => {});
  }
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, ch) => buffer.getChannelData(ch));
  return new Blob([encodeWavPcm(channels, buffer.sampleRate)], { type: 'audio/wav' });
}

export function encodeWavAsync(buffer: AudioBuffer, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./separation/wav.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.percent);
      if (data.type === 'done') { finish(); resolve(new Blob([data.bytes], { type: 'audio/wav' })); }
      if (data.type === 'error') { finish(); reject(new Error(data.message)); }
    };
    worker.onerror = () => { finish(); reject(new Error('WAV export failed. Try a shorter audio file.')); };
    try {
      const channels = Array.from({ length: Math.min(buffer.numberOfChannels, 2) }, (_, ch) => buffer.getChannelData(ch).slice());
      worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
    } catch {
      finish(); reject(new Error('Not enough memory to export WAV. Try a shorter audio file.'));
    }
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  // Safari may not start reading a download until after its click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function renderOriginal(buffer: AudioBuffer, options: OriginalOptions): Promise<AudioBuffer> {
  const start = clamp(options.start, 0, Math.max(0, buffer.duration - 1 / buffer.sampleRate));
  const end = clamp(options.end, start + 1 / buffer.sampleRate, buffer.duration);
  const duration = end - start;
  const context = new OfflineAudioContext(Math.min(buffer.numberOfChannels, 2), Math.max(1, Math.round(duration * buffer.sampleRate)), buffer.sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  const volume = clamp(options.volume, 0, 2);
  const fadeIn = clamp(options.fadeIn, 0, duration);
  const fadeOut = clamp(options.fadeOut, 0, duration);
  // Scaling overlapping fades keeps the envelope continuous on very short trims.
  const scale = Math.min(1, duration / Math.max(duration, fadeIn + fadeOut));
  const fi = fadeIn * scale, fo = fadeOut * scale;
  gain.gain.setValueAtTime(fi > 0 ? 0 : volume, 0);
  if (fi > 0) gain.gain.linearRampToValueAtTime(volume, fi);
  gain.gain.setValueAtTime(volume, Math.max(fi, duration - fo));
  if (fo > 0) gain.gain.linearRampToValueAtTime(0, duration);
  source.connect(gain).connect(context.destination);
  source.start(0, start, duration);
  const result = await context.startRendering();
  if (options.normalize) {
    let peak = 0;
    for (let ch = 0; ch < result.numberOfChannels; ch++) {
      const data = result.getChannelData(ch);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (peak > 0) {
      const level = Math.pow(10, -1 / 20) / peak;
      for (let ch = 0; ch < result.numberOfChannels; ch++) {
        const data = result.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] *= level;
      }
    }
  }
  return result;
}

/** All sources are scheduled against a single audio clock for sample-accurate sync. */
export class Mixer {
  private context: AudioContext | null = null;
  private masterNode: GainNode | null = null;
  private tracks: MixTrack[] = [];
  private nodes = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; pan?: StereoPannerNode }>();
  private position = 0;
  private startedAt = 0;
  private active = false;
  private master = 1;
  private frame = 0;
  private playRevision = 0;
  private onChange?: (state: PlayerState) => void;

  constructor(onChange?: (state: PlayerState) => void) { this.onChange = onChange; }
  get duration(): number { return Math.max(0, ...this.tracks.map(t => t.buffer.duration)); }
  get currentTime(): number {
    return clamp(this.active && this.context ? this.position + this.context.currentTime - this.startedAt : this.position, 0, this.duration);
  }
  get isPlaying(): boolean { return this.active; }

  configure(tracks: MixTrack[], master = 1): void {
    const changed = tracks.length !== this.tracks.length || tracks.some((track, i) => track.id !== this.tracks[i]?.id || track.buffer !== this.tracks[i]?.buffer);
    const resume = this.active;
    if (changed) this.pause();
    this.tracks = tracks;
    this.master = clamp(master, 0, 2);
    this.position = Math.min(this.position, this.duration);
    if (this.masterNode && this.context) this.masterNode.gain.setTargetAtTime(this.master, this.context.currentTime, 0.01);
    this.updateGains();
    if (changed && resume) void this.play().catch(() => { this.pause(); });
    this.emit();
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new (audioConstructor())();
      this.masterNode = this.context.createGain();
      this.masterNode.gain.value = this.master;
      this.masterNode.connect(this.context.destination);
    }
    return this.context;
  }

  /** Call directly in a tap handler before awaiting offline rendering on Safari. */
  async unlock(): Promise<void> {
    const context = this.ensureContext();
    await context.resume();
  }

  async play(offset?: number): Promise<void> {
    if (!this.tracks.length) return;
    if (this.active) this.pause();
    const revision = ++this.playRevision;
    if (offset !== undefined) this.position = clamp(offset, 0, this.duration);
    if (this.position >= this.duration) this.position = 0;
    const context = this.ensureContext();
    await context.resume();
    if (revision !== this.playRevision) return;
    const when = context.currentTime + 0.025;
    this.startedAt = when;
    this.active = true;
    for (const track of this.tracks) {
      if (this.position >= track.buffer.duration) continue;
      const source = context.createBufferSource();
      source.buffer = track.buffer;
      const gain = context.createGain();
      source.connect(gain);
      let pan: StereoPannerNode | undefined;
      if (typeof context.createStereoPanner === 'function') {
        pan = context.createStereoPanner();
        gain.connect(pan).connect(this.masterNode!);
      } else gain.connect(this.masterNode!);
      this.nodes.set(track.id, { source, gain, pan });
      source.start(when, this.position);
    }
    this.updateGains();
    this.tick();
  }

  private updateGains(): void {
    if (!this.context) return;
    const anySolo = this.tracks.some(t => t.solo);
    for (const track of this.tracks) {
      const node = this.nodes.get(track.id);
      if (!node) continue;
      const audible = !track.muted && (!anySolo || track.solo);
      node.gain.gain.setTargetAtTime(audible ? clamp(track.volume, 0, 2) : 0, this.context.currentTime, 0.01);
      node.pan?.pan.setTargetAtTime(clamp(track.pan, -1, 1), this.context.currentTime, 0.01);
    }
  }

  pause(): void {
    this.playRevision++;
    this.position = this.currentTime;
    this.active = false;
    this.stopNodes();
    cancelAnimationFrame(this.frame);
    this.emit();
  }
  stop(): void { this.pause(); this.position = 0; this.emit(); }
  seek(seconds: number): void {
    const resume = this.active;
    this.pause();
    this.position = clamp(seconds, 0, this.duration);
    if (resume && this.position < this.duration) void this.play().catch(() => this.pause());
    else this.emit();
  }
  destroy(): void {
    this.pause();
    this.tracks = [];
    this.masterNode?.disconnect();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.masterNode = null;
  }
  private stopNodes(): void {
    for (const { source, gain, pan } of this.nodes.values()) {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect(); gain.disconnect(); pan?.disconnect();
    }
    this.nodes.clear();
  }
  private emit(): void { this.onChange?.({ time: this.currentTime, duration: this.duration, playing: this.active }); }
  private tick = (): void => {
    if (!this.active) return;
    if (this.currentTime >= this.duration) {
      this.position = this.duration;
      this.active = false;
      this.stopNodes();
      this.emit();
      return;
    }
    this.emit();
    this.frame = requestAnimationFrame(this.tick);
  };
}

export async function renderMix(tracks: MixTrack[], master = 1): Promise<AudioBuffer> {
  if (!tracks.length) throw new Error('Choose audio first.');
  const duration = Math.max(...tracks.map(t => t.buffer.duration));
  const rate = 44100;
  const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
  const masterNode = context.createGain();
  masterNode.gain.value = clamp(master, 0, 2);
  masterNode.connect(context.destination);
  const anySolo = tracks.some(t => t.solo);
  for (const track of tracks) {
    if (track.muted || (anySolo && !track.solo)) continue;
    const source = context.createBufferSource();
    source.buffer = track.buffer;
    const gain = context.createGain();
    gain.gain.value = clamp(track.volume, 0, 2);
    source.connect(gain);
    if (typeof context.createStereoPanner === 'function') {
      const pan = context.createStereoPanner();
      pan.pan.value = clamp(track.pan, -1, 1);
      gain.connect(pan).connect(masterNode);
    } else gain.connect(masterNode);
    source.start(0);
  }
  return context.startRendering();
}

export async function encodeMp3(buffer: AudioBuffer, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  // MP3 accepts only a defined family of rates. Audio decoded here is normally 44.1 kHz.
  let source = buffer;
  if (![32000, 44100, 48000].includes(buffer.sampleRate)) {
    const ctx = new OfflineAudioContext(Math.min(buffer.numberOfChannels, 2), Math.ceil(buffer.duration * 44100), 44100);
    const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination); node.start();
    source = await ctx.startRendering();
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./separation/encode.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.percent);
      if (data.type === 'done') { finish(); resolve(new Blob([data.bytes], { type: 'audio/mpeg' })); }
      if (data.type === 'error') { finish(); reject(new Error('MP3 export failed. Try WAV instead.')); }
    };
    worker.onerror = () => { finish(); reject(new Error('MP3 export failed. Try WAV instead.')); };
    const channels = Array.from({ length: Math.min(source.numberOfChannels, 2) }, (_, ch) => source.getChannelData(ch).slice());
    worker.postMessage({ channels, sampleRate: source.sampleRate }, channels.map(ch => ch.buffer));
  });
}
