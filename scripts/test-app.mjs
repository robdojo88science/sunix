import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

// These tests exercise the actual React UI, event handlers, and localStorage.
// Audio rendering and IndexedDB are bounded test doubles: their browser-specific
// engines have separate verification, and no real audio/model is loaded here.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://robdojo88science.github.io/sunix/',
  pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Node']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

const state = {
  mixers: [], events: [], project: null, clearFails: false, saves: [],
  decode: async () => ({ duration: 12, sampleRate: 44100, numberOfChannels: 2, length: 529200 }),
}
globalThis.__sunixTestState = state

const mockedAudio = `
const state = globalThis.__sunixTestState;
export class Mixer {
  constructor(onChange) { this.onChange = onChange; this.tracks = []; this.position = 0; this.isPlaying = false; state.mixers.push(this); }
  get duration() { return Math.max(0, ...this.tracks.map(t => t.buffer.duration)); }
  emit() { this.onChange({ time: this.position, duration: this.duration, playing: this.isPlaying }); }
  configure(tracks, master = 1) { this.tracks = tracks; this.master = master; state.events.push({ type: 'configure', names: tracks.map(t => t.name) }); this.emit(); }
  unlock() { state.events.push({ type: 'unlock' }); return Promise.resolve(); }
  play() { this.isPlaying = true; state.events.push({ type: 'play' }); this.emit(); return Promise.resolve(); }
  pause() { this.isPlaying = false; state.events.push({ type: 'pause' }); this.emit(); }
  stop() { this.position = 0; this.isPlaying = false; state.events.push({ type: 'stop' }); this.emit(); }
  seek(time) { this.position = time; this.emit(); }
  destroy() { this.isPlaying = false; }
}
export const decodeFile = file => state.decode(file);
export const downloadBlob = () => {};
export const encodeWav = () => new Blob(['wav']);
export const encodeWavAsync = async () => new Blob(['wav']);
export const encodeMp3 = async () => new Blob(['mp3']);
export const renderMix = async tracks => tracks[0]?.buffer;
export const renderOriginal = async buffer => { state.events.push({type:'render'}); return {...buffer}; };
export const separateAudio = async () => [];
`
const mockedStorage = `
const state = globalThis.__sunixTestState;
export const clearProjects = async () => { if(state.clearFails) throw new Error('Local project storage is unavailable.'); };
export const loadProject = async () => state.project;
export const saveProject = async (...args) => state.saves.push(args);
`
const result = await build({
  entryPoints: ['src/App.tsx'], bundle: true, platform: 'node', format: 'esm',
  packages: 'external', write: false, jsx: 'automatic',
  plugins: [{ name: 'bounded-browser-engines', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/audio$/ }, () => ({ path: 'audio', namespace: 'test-double' }))
    plugin.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: 'storage', namespace: 'test-double' }))
    plugin.onResolve({ filter: /^\.\/components\/Waveform$/ }, () => ({ path: 'waveform', namespace: 'test-double' }))
    plugin.onLoad({ filter: /.*/, namespace: 'test-double' }, ({ path }) => ({
      contents: path === 'audio' ? mockedAudio : path === 'storage' ? mockedStorage : 'export default function Waveform() { return null; }',
    }))
  } }],
})
const bundlePath = resolve('node_modules/.cache/sunix-app-test.mjs')
await mkdir(resolve('node_modules/.cache'), { recursive: true })
await writeFile(bundlePath, result.outputFiles[0].text)
const { createRoot } = await import('react-dom/client')
const { default: App } = await import(pathToFileURL(bundlePath).href)
let root

async function mount(hash = '') {
  dom.window.history.replaceState({}, '', `/sunix/${hash}`)
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(App)); await Promise.resolve() })
}
async function click(element) {
  assert.ok(element, 'Expected a clickable element')
  await act(async () => { element.click(); await Promise.resolve() })
}
function button(text, scope = document) {
  return [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === text)
}
async function type(selector, value) {
  const element = document.querySelector(selector)
  assert.ok(element, `Missing input: ${selector}`)
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function waitForAutosave() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 520)) }) }
async function nav(name) { await click(button(name, document.querySelector('.bottom-nav'))) }
async function openLyrics() { await nav('Lyrics'); assert.ok(document.getElementById('lyrics-editor')) }
function storedLyrics() { return JSON.parse(localStorage.getItem('sunix:lyrics:v1') || 'null') }

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null }
  localStorage.clear()
  document.getElementById('root').replaceChildren()
  state.mixers.length = 0; state.events.length = 0; state.project = null; state.clearFails = false; state.saves.length = 0
})
after(() => dom.window.close())

test('home starts empty and every tool opens through the navigation dock', async () => {
  await mount()
  assert.match(document.querySelector('h1').textContent, /SUNIX/)
  assert.equal(document.querySelector('.master-player'), null)
  assert.equal(document.querySelectorAll('.tool-card').length, 4)
  for (const name of ['Dismantle', 'Reassemble', 'Original']) {
    await nav(name)
    assert.equal(document.querySelector('h1').textContent.trim(), name)
    assert.ok(button('Choose Audio'))
    assert.equal(document.querySelector('.master-player'), null)
  }
  await openLyrics()
  assert.equal(document.getElementById('lyrics-editor').value, '')
  assert.equal(document.getElementById('lyrics-title').value, '')
})

test('lyrics autosave, section insertion, undo/redo, and reopening survive tool navigation', async () => {
  await mount('#lyrics')
  await type('#lyrics-title', 'Night Signal')
  await type('#lyrics-editor', 'We follow the light')
  await waitForAutosave()
  assert.equal(storedLyrics().drafts[0].title, 'Night Signal')
  assert.equal(storedLyrics().drafts[0].text, 'We follow the light')

  await click(document.querySelector('[aria-label="Insert Chorus section"]'))
  assert.match(document.getElementById('lyrics-editor').value, /\[Chorus\]/)
  await click(document.querySelector('[aria-label="Undo"]'))
  assert.equal(document.getElementById('lyrics-editor').value, 'We follow the light')
  await click(document.querySelector('[aria-label="Redo"]'))
  const withSection = document.getElementById('lyrics-editor').value
  assert.match(withSection, /\[Chorus\]/)

  // Unmount before the debounce finishes: the flush must preserve the latest text.
  await nav('Home')
  assert.equal(storedLyrics().drafts[0].text, withSection)
  await openLyrics()
  assert.equal(document.getElementById('lyrics-title').value, 'Night Signal')
  assert.equal(document.getElementById('lyrics-editor').value, withSection)
})

test('writing tools replace literal punctuation without altering regex-like text', async () => {
  await mount('#lyrics')
  await type('#lyrics-editor', 'a.b aXb a.b')
  await click(button('Writing tools'))
  const findSection = [...document.querySelectorAll('.lyrics-tool-section')].find(section => section.textContent.includes('Find & replace'))
  findSection.open = true
  await type('#lyrics-find', 'a.b')
  await type('#lyrics-replacement', 'signal')
  await click(button('Replace all'))
  assert.equal(document.getElementById('lyrics-editor').value, 'signal aXb signal')
  assert.match(document.querySelector('.toast').textContent, /Replaced 2 matches/)
})

test('clear event cancels pending lyric writes and cleanup cannot restore removed data', async () => {
  await mount('#lyrics')
  await type('#lyrics-editor', 'A saved line')
  await waitForAutosave()
  await type('#lyrics-editor', 'A line still waiting to save')
  await act(async () => {
    window.dispatchEvent(new Event('sunix:clear'))
    localStorage.removeItem('sunix:lyrics:v1')
  })
  assert.equal(document.getElementById('lyrics-editor').value, '')
  await waitForAutosave()
  assert.equal(storedLyrics(), null)
  await nav('Home')
  assert.equal(storedLyrics(), null)
  await openLyrics()
  await type('#lyrics-editor', 'A fresh beginning')
  await waitForAutosave()
  assert.equal(storedLyrics().drafts[0].text, 'A fresh beginning')
})

test('a project-storage failure during clear still remounts lyrics and restores autosave', async () => {
  await mount('#lyrics')
  await type('#lyrics-editor', 'An old draft')
  await waitForAutosave()
  state.clearFails = true
  await click(document.querySelector('[aria-label="Settings"]'))
  await click(button('Clear Local Data'))
  await click(button('Clear this device'))
  assert.match(document.querySelector('.toast').textContent, /Local project storage is unavailable/)
  assert.equal(document.getElementById('lyrics-editor').value, '')
  await click(document.querySelector('[aria-label="Close Clear local data?"]'))
  await click(document.querySelector('[aria-label="Close Settings"]'))
  await type('#lyrics-editor', 'A recovered draft')
  await waitForAutosave()
  assert.equal(storedLyrics().drafts[0].text, 'A recovered draft')
})

test('a loaded mix keeps its tracks and transport while opening Home and Lyrics', async () => {
  state.project = { name: 'My local mix', master: 0.8, tracks: [{ id: 'track-1', name: 'Voice', buffer: { duration: 12 }, volume: 1, pan: 0, muted: false, solo: false }] }
  await mount('#reassemble')
  await click(button('Open local project'))
  await click(document.querySelector('[aria-label="Play"]'))
  const engine = state.mixers.at(-1)
  assert.equal(engine.isPlaying, true)
  assert.equal(engine.tracks[0].name, 'Voice')
  await nav('Home')
  assert.equal(engine.isPlaying, true)
  assert.equal(engine.tracks[0]?.name, 'Voice')
  assert.equal(document.querySelector('.player-info strong')?.textContent, 'My local mix')
  await openLyrics()
  assert.equal(engine.isPlaying, true)
  assert.equal(engine.tracks[0]?.name, 'Voice')
  assert.equal(document.querySelector('.player-info strong')?.textContent, 'My local mix')
})

test('renaming a loaded mix preserves its playback position and does not restart transport', async () => {
  state.project = { name: 'Old title', master: 1, tracks: [{ id: 'track-1', name: 'Voice', buffer: { duration: 12 }, volume: 1, pan: 0, muted: false, solo: false }] }
  await mount('#reassemble')
  await click(button('Open local project'))
  await click(document.querySelector('[aria-label="Play"]'))
  const engine = state.mixers.at(-1)
  await act(async () => engine.seek(5))
  const priorEvents = state.events.length
  await type('[aria-label="Project name"]', 'New title')
  assert.equal(engine.position, 5)
  assert.equal(engine.isPlaying, true)
  assert.equal(document.querySelector('.player-info strong').textContent, 'New title')
  assert.ok(state.events.slice(priorEvents).every(event => !['play', 'stop', 'pause'].includes(event.type)))
})
