// HTDemucs waveform model: MIT licensed by Meta; ONNX packaging by StemSplit.
// Model source/spec: https://huggingface.co/StemSplitio/htdemucs-onnx
// All inference runs here. Audio is never sent in a network request.
const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx';
const MODEL_SHA = 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a';
const MODEL_BYTES = 165612636;
const MODEL_CACHE = 'sunix-models-v1';
const SEGMENT = 343980;
type Stereo = [Float32Array, Float32Array];
type OutputStem = { name: string; channels: Stereo; color: string };
type Task = { channels: Stereo; mode: 2 | 4; quality: 'fast' | 'balanced' | 'high' };

const progress = (percent: number, stage: string) => self.postMessage({ type: 'progress', percent, stage });

async function modelBytes(): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const response = await cache.match(MODEL_URL);
    if (response) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === MODEL_BYTES) {
        progress(27, 'Checking cached model');
        await verify(bytes);
        return bytes;
      }
      await cache.delete(MODEL_URL);
    }
  } catch { /* Private mode/storage limits still allow uncached processing. */ }
  progress(1, 'Downloading model · 166 MB');
  let response: Response;
  try { response = await fetch(MODEL_URL, { credentials: 'omit' }); }
  catch { throw new Error('Model download failed. Check your connection and try again.'); }
  if (!response.ok) throw new Error('Model download failed. Check your connection and try again.');
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value); loaded += part.value.length;
      progress(Math.min(25, 1 + loaded / MODEL_BYTES * 24), `Downloading model · ${Math.floor(loaded / MODEL_BYTES * 100)}%`);
    }
  } else {
    const data = new Uint8Array(await response.arrayBuffer()); chunks.push(data); loaded = data.length;
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
  chunks.length = 0;
  progress(26, 'Checking model');
  await verify(bytes);
  try { await cache?.put(MODEL_URL, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
  catch { /* Cache quota is optional; the downloaded model remains usable. */ }
  return bytes;
}

async function verify(bytes: Uint8Array): Promise<void> {
  if (bytes.length !== MODEL_BYTES) throw new Error('Model download was incomplete. Please try again.');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== MODEL_SHA) throw new Error('Model download was incomplete. Please try again.');
}

function centerSide(channels: Stereo): OutputStem[] {
  const length = channels[0].length;
  const center: Stereo = [new Float32Array(length), new Float32Array(length)];
  const sides: Stereo = [new Float32Array(length), new Float32Array(length)];
  for (let i = 0; i < length; i++) {
    const middle = (channels[0][i] + channels[1][i]) / 2;
    center[0][i] = center[1][i] = middle;
    sides[0][i] = channels[0][i] - middle;
    sides[1][i] = channels[1][i] - middle;
    if (i % 131072 === 0) progress(Math.round(i / length * 98), 'Extracting center / sides');
  }
  return [
    { name: 'Center', channels: center, color: '#b998ff' },
    { name: 'Sides', channels: sides, color: '#63e1e9' },
  ];
}

async function demucs(task: Task): Promise<OutputStem[]> {
  const ort = await import('onnxruntime-web/wasm');
  // GitHub Pages does not supply isolation headers. One WASM thread works in Safari
  // and avoids relying on SharedArrayBuffer, COOP/COEP, or a separate backend.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  // Vite emits the matching WASM binary with a base-aware hashed URL. Keep the
  // bundled asset path so GitHub Pages needs no third-party runtime CDN.
  const bytes = await modelBytes();
  progress(28, 'Starting audio engine');
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    // Optimizer constant folding expands Demucs' STFT convolutions beyond the
    // WASM address-space budget. Disabled is slower but validated in real WASM.
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
  try {
    if (session.inputNames[0] !== 'mix' || !session.outputNames.includes('stems')) throw new Error('Incompatible model. Please clear local data and try again.');
    const total = task.channels[0].length;
    const overlap = Math.floor(SEGMENT * (task.quality === 'high' ? 0.5 : 0.25));
    const stride = SEGMENT - overlap;
    // A final chunk is needed only if the previous segment did not cover the end.
    const count = Math.max(1, 1 + Math.ceil(Math.max(0, total - SEGMENT) / stride));
    const weight = new Float32Array(total);
    const rows = task.mode === 4 ? [0, 1, 2, 3] : [3, -1];
    const output = rows.map((): Stereo => [new Float32Array(total), new Float32Array(total)]);
    const chunk = new Float32Array(2 * SEGMENT);
    for (let n = 0; n < count; n++) {
      progress(30 + n / count * 66, `Separating · ${n + 1} / ${count}`);
      const start = n * stride, end = Math.min(start + SEGMENT, total), length = end - start;
      chunk.fill(0);
      chunk.set(task.channels[0].subarray(start, end), 0);
      chunk.set(task.channels[1].subarray(start, end), SEGMENT);
      const tensor = new ort.Tensor('float32', chunk, [1, 2, SEGMENT]);
      const result = await session.run({ mix: tensor });
      const predicted = result.stems;
      if (predicted.dims.length !== 4 || predicted.dims[1] !== 4 || predicted.dims[2] !== 2 || predicted.dims[3] !== SEGMENT) {
        throw new Error('Incompatible model. Please clear local data and try again.');
      }
      const data = predicted.data as Float32Array;
      for (let i = 0; i < length; i++) {
        let window = 1;
        if (n > 0 && i < overlap) window = (i + 1) / (overlap + 1);
        if (n < count - 1 && i >= SEGMENT - overlap) window = Math.min(window, (SEGMENT - i) / (overlap + 1));
        weight[start + i] += window;
        for (let s = 0; s < rows.length; s++) {
          for (let ch = 0; ch < 2; ch++) {
            let value: number;
            if (rows[s] >= 0) value = data[(rows[s] * 2 + ch) * SEGMENT + i];
            else value = data[ch * SEGMENT + i] + data[(2 + ch) * SEGMENT + i] + data[(4 + ch) * SEGMENT + i];
            output[s][ch][start + i] += value * window;
          }
        }
      }
      tensor.dispose();
      for (const value of Object.values(result)) value.dispose();
    }
    progress(97, 'Finishing stems');
    for (const stem of output) for (const channel of stem) {
      for (let i = 0; i < total; i++) channel[i] /= Math.max(weight[i], 1e-8);
    }
    const names = task.mode === 4 ? ['Drums', 'Bass', 'Other', 'Vocals'] : ['Vocals', 'Instrumental'];
    const colors = task.mode === 4 ? ['#ff9c85', '#63d4ee', '#80deb8', '#b998ff'] : ['#b998ff', '#63e1e9'];
    return output.map((channels, index) => ({ name: names[index], color: colors[index], channels }));
  } finally { await session.release(); }
}

self.onmessage = async ({ data }: MessageEvent<Task>) => {
  try {
    const stems = data.quality === 'fast' ? centerSide(data.channels) : await demucs(data);
    progress(100, 'Ready');
    self.postMessage({ type: 'done', stems }, { transfer: stems.flatMap(stem => stem.channels.map(channel => channel.buffer)) });
  } catch (error) {
    const message = error instanceof Error && /download|model download|connection|incomplete|Incompatible/i.test(error.message)
      ? error.message
      : data.mode === 4
        ? 'Not enough memory for 4 stems. Try 2 stems, a shorter file, or Center/side mode.'
        : "Audio engine couldn't start. Try Center/side mode or a shorter audio file.";
    self.postMessage({ type: 'error', message });
  }
};

export {};
