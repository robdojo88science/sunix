import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production TypeScript modules, substituting only browser facilities
// that Node does not provide. No model is downloaded by this test suite.
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`;
const codecUrl = moduleUrl(await read('src/separation/wav-codec.ts'));
const { encodeWavPcm } = await import(codecUrl);
const audioSource = (await read('src/audio.ts'))
  .replace(/^export .* from '\.\/separation';\r?\n/gm, '')
  .replace("from './separation/wav-codec'", `from '${codecUrl}'`)
  .replace("new URL('./separation/wav.worker.ts', import.meta.url)", "'sunix-wav-worker'");
const { Mixer, encodeWav, encodeWavAsync } = await import(moduleUrl(audioSource));

function audioBuffer(channels, sampleRate = 44100) {
  return {
    numberOfChannels: channels.length, length: channels[0].length,
    sampleRate, duration: channels[0].length / sampleRate,
    getChannelData: channel => channels[channel],
  };
}

function workerModule(source, globals = {}) {
  const messages = [];
  const self = { postMessage: message => messages.push(message) };
  vm.runInNewContext(compile(source).replace(/export\s*\{\s*\};?/g, ''), {
    self, Float32Array, Uint8Array, ArrayBuffer, DataView, Math, ...globals,
  });
  return { self, messages };
}

const wavSource = (await read('src/separation/wav.worker.ts'))
  .replace("import { encodeWavPcm } from './wav-codec';", '');
const savedGlobals = new Map(['window', 'requestAnimationFrame', 'cancelAnimationFrame', 'Worker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
after(() => {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test('WAV stores PCM metadata, stereo interleaving, and clipped 16-bit samples', async () => {
  const buffer = audioBuffer([
    new Float32Array([-2, -.5, 0, 2]),
    new Float32Array([1, 0, .5, -1]),
  ]);
  const bytes = await encodeWav(buffer).arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(Buffer.from(bytes).toString('ascii', 0, 4), 'RIFF');
  assert.equal(Buffer.from(bytes).toString('ascii', 8, 12), 'WAVE');
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true)), [
    -32768, 32767, -16384, 0, 0, 16384, 32767, -32768,
  ]);
});

test('real WAV worker matches synchronous bytes and reports completed-frame progress', () => {
  const channels = [
    Float32Array.from({ length: 200000 }, (_, i) => i % 3 === 0 ? 2 : i % 3 === 1 ? -2 : .25),
    Float32Array.from({ length: 200000 }, (_, i) => Math.sin(i)),
  ];
  const worker = workerModule(wavSource, { encodeWavPcm });
  worker.self.onmessage({ data: { channels, sampleRate: 48000 } });
  const done = worker.messages.find(message => message.type === 'done');
  assert.ok(done);
  assert.deepEqual(new Uint8Array(done.bytes), new Uint8Array(encodeWavPcm(channels, 48000)));
  const progress = worker.messages.filter(message => message.type === 'progress').map(message => message.percent);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.length > 3);
  assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
});

test('asynchronous WAV wrapper returns worker bytes and cancellation terminates pending work', async () => {
  const instances = [];
  class BrowserWorker {
    terminated = false;
    constructor() { instances.push(this); }
    postMessage(data) {
      queueMicrotask(() => {
        if (this.terminated) return;
        const worker = workerModule(wavSource, { encodeWavPcm });
        worker.self.postMessage = event => this.onmessage({ data: event });
        worker.self.onmessage({ data });
      });
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = BrowserWorker;
  const buffer = audioBuffer([new Float32Array([-.5, 0, .5, 1])]);
  const progress = [];
  const result = await encodeWavAsync(buffer, percent => progress.push(percent));
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array(await encodeWav(buffer).arrayBuffer()));
  assert.equal(progress.at(-1), 100);
  assert.ok(instances[0].terminated);
  const controller = new AbortController();
  const pending = encodeWavAsync(buffer, undefined, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.ok(instances[1].terminated);
  const alreadyCanceled = new AbortController(); alreadyCanceled.abort();
  await assert.rejects(encodeWavAsync(buffer, undefined, alreadyCanceled.signal), error => error.name === 'AbortError');
});

function mockAudio({ deferred = false } = {}) {
  const pending = [];
  class Param {
    value = 0;
    setTargetAtTime(value) { this.value = value; }
  }
  class Node {
    gain = new Param(); pan = new Param();
    connect(to) { return to; }
    disconnect() {}
    start(...args) { this.started = args; }
    stop() { this.stopped = true; }
  }
  class AudioContext {
    static last;
    currentTime = 0; state = 'running'; destination = new Node();
    sources = []; gains = []; pans = [];
    constructor() { AudioContext.last = this; }
    createGain() { const node = new Node(); this.gains.push(node); return node; }
    createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
    createStereoPanner() { const node = new Node(); this.pans.push(node); return node; }
    resume() { return deferred ? new Promise(resolve => pending.push(resolve)) : Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return { AudioContext, pending };
}
const track = (id, duration = 10) => ({ id, name: id, buffer: { duration }, volume: .7, pan: .25, muted: false, solo: false });

test('mixer uses one clock and applies gain, solo, pan, master, seek, and stop', async () => {
  const { AudioContext } = mockAudio();
  const mixer = new Mixer();
  let tracks = [track('a'), track('b', 5)];
  mixer.configure(tracks, .8);
  await mixer.play(2);
  const context = AudioContext.last;
  assert.equal(context.sources.length, 2);
  assert.deepEqual(context.sources[0].started, context.sources[1].started);
  assert.equal(context.sources[0].started[1], 2);
  assert.equal(context.pans[0].pan.value, .25);
  context.currentTime = 3.025;
  assert.equal(mixer.currentTime, 5);
  tracks = [{ ...tracks[0], solo: true }, tracks[1]];
  mixer.configure(tracks, .6);
  assert.equal(context.gains[0].gain.value, .6);
  assert.equal(context.gains[1].gain.value, .7);
  assert.equal(context.gains[2].gain.value, 0);
  mixer.pause();
  assert.equal(mixer.currentTime, 5);
  assert.equal(mixer.isPlaying, false);
  mixer.seek(100);
  assert.equal(mixer.currentTime, 10);
  await mixer.play();
  assert.equal(context.sources.at(-1).started[1], 0);
  mixer.stop();
  assert.equal(mixer.currentTime, 0);
  mixer.destroy();
  assert.equal(context.state, 'closed');
});

test('mixer cancels stale concurrent play promises and pauses before pending resume', async () => {
  const { AudioContext, pending } = mockAudio({ deferred: true });
  const mixer = new Mixer();
  mixer.configure([track('original')]);
  const first = mixer.play(); pending.shift()(); await first;
  assert.equal(AudioContext.last.sources.length, 1);
  mixer.configure([track('stem')]);
  const explicit = mixer.play();
  assert.equal(pending.length, 2);
  pending.shift()(); pending.shift()();
  await explicit;
  assert.equal(AudioContext.last.sources.length, 2, 'only one new source survives the competing resume');
  mixer.pause();
  const canceled = mixer.play(); mixer.pause(); pending.shift()(); await canceled;
  assert.equal(AudioContext.last.sources.length, 2, 'pause prevents a pending resume from starting audio');
  mixer.destroy();
});

test('center/side worker outputs complement each other and reconstruct both input channels', async () => {
  const worker = workerModule(await read('src/separation/separate.worker.ts'));
  const channels = [new Float32Array([1, .5, -1, 0]), new Float32Array([0, -.5, .5, 1])];
  await worker.self.onmessage({ data: { channels, mode: 2, quality: 'fast' } });
  const done = worker.messages.find(message => message.type === 'done');
  assert.ok(done);
  assert.deepEqual(Array.from(done.stems, stem => stem.name), ['Center', 'Sides']);
  for (let ch = 0; ch < 2; ch++) {
    for (let i = 0; i < channels[ch].length; i++) {
      assert.equal(done.stems[0].channels[ch][i] + done.stems[1].channels[ch][i], channels[ch][i]);
    }
  }
});
