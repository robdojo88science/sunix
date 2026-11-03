# SUNIX

**Split. Mix. Create.** A local-first browser audio and lyrics studio, designed for iPhone and iPad and usable on modern desktop browsers.

Public site: **https://robdojo88science.github.io/sunix/**

## Tools

- **Dismantle:** local AI separation into vocals/instrumental or vocals/drums/bass/other, real download and inference progress, cancel, stem playback, WAV downloads, and transfer to the mixer.
- **Reassemble:** synchronized multi-track playback, seek, volume, mute, solo, stereo pan, track naming/order/removal, master volume, reset, an explicit local project save, and WAV/MP3 export.
- **Original:** waveform preview, trim, fades, volume, peak normalization, project naming, and WAV/MP3 export.
- **Lyrics:** local drafts, song sections, undo/redo, find/replace, writing statistics, approximate syllables, duplicate-line detection, a basic offline rhyme helper, copy, and TXT export.

The app starts empty. Audio is selected from your own files; there are no sample projects, accounts, paid APIs, analytics, or upload backend.

## AI separation and device limits

Balanced and High modes lazy-load ONNX Runtime Web and a **166 MB HTDemucs model** on the first separation. The model is pinned to an exact revision and SHA-256 verified, then cached locally when storage permits. High mode adds overlapping chunks. AI 2-stem mode uses the same four-stem model and combines the accompaniment, so it still needs substantial memory and processing time.

Processing uses a Web Worker and single-threaded WebAssembly for GitHub Pages compatibility. It can be slow and memory intensive on phones and tablets; short audio is the best starting point. A browser may stop processing if it runs out of memory or is backgrounded. Cancel terminates the worker.

**Fast / Center-side** is a lightweight stereo processing option that needs no AI download. It creates Center and Sides tracks using stereo mid/side arithmetic. It does **not** isolate vocals or individual instruments, and it requires stereo input. Use it when the AI model cannot run on your device.

## Run locally

```sh
npm install
npm run dev
```

Build a static release with `npm run build`. Preview it with `npm run preview`; the app lives at `/sunix/` to match GitHub Pages.

Run `npm test` for the 13 functional and audio regression checks. GitHub Actions runs these checks before building and publishing.

## Publish

The `Publish SUNIX` GitHub Actions workflow builds and deploys every push to `main`. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions** once. The workflow also supports a manual run from the Actions tab.

The optional helper uses `GH_TOKEN`, `GITHUB_TOKEN`, or an existing noninteractive Git Credential Manager session in memory. It never saves credentials:

```sh
node scripts/github-pages.mjs enable
node scripts/github-pages.mjs deploy
node scripts/github-pages.mjs status
```

The API token needs repository Pages administration permission to enable hosting and Actions write permission for manual dispatch. SSH authentication for Git push is separate from API authentication.

## Local data and offline use

Audio processing runs on your device. Choose audio with the browser file picker; no account, payment, or audio-upload service is required. Lyrics and preferences use browser-local storage. Saving a local project is an explicit action. Clearing browser data removes local drafts and settings.

The optional PWA uses a subdirectory-safe manifest and caches the app shell after a visit. The same-origin AI runtime is cached only after it is requested. The verified model uses a separate cache; first use requires a connection. Browser eviction, private mode, or storage limits can remove or prevent these caches. User audio is never put in the service-worker cache. The explicit mixer save stores one project, including its audio, in IndexedDB.

Browser audio-format support, processing speed, and memory limits depend on the device. WAV is the lossless 16-bit export; MP3 is encoded locally at 192 kbps with lamejs. Keep a copy of valuable source audio and exported projects outside browser storage. Settings includes **Clear Local Data** for saved drafts, preferences, projects, and model caches.

## Validation

TypeScript checks and the production Vite build passed. The pinned HTDemucs model was run with ONNX Runtime Web 1.31.1 WASM on a real one-second stereo tone input, padded to the model's 7.8-second chunk. It produced four finite, nonzero stereo stems with the correct output length. That inference took approximately 24.9 seconds in the test environment; this is not a mobile performance or music-quality benchmark. Summing the stems had approximately 6.27% left / 6.41% right relative RMS reconstruction error on that synthetic input.

Physical iPhone/iPad Safari testing has not been performed. Automated browser visual verification was unavailable in this environment. Responsive layouts and Safari-safe audio startup are implemented, but device playback, downloads, memory behavior, and installed PWA behavior still need hands-on verification.

## Open-source acknowledgments

React, Vite, ONNX Runtime, Demucs/HTDemucs, and StemSplit's ONNX conversion provide the interface, build tooling, and separation runtime/model. MP3 encoding uses **@breezystack/lamejs 1.2.7 (LGPL-3.0)**. See [Third-party notices](THIRD_PARTY_NOTICES.md) for versions, source locations, license texts, and encoder rebuild instructions. The published site includes the notices under [`licenses/`](public/licenses/).
