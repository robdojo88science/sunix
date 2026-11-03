# Third-party acknowledgments

SUNIX uses the following open-source projects. Their respective licenses apply to those components. Full notices are included in [`public/licenses/`](public/licenses/) and are served with the published site at `/sunix/licenses/`.

| Component | Version / revision | License | Source and notice |
| --- | --- | --- | --- |
| React | 19.3.1 | MIT | [Source](https://github.com/facebook/react/tree/v19.3.1), [license](public/licenses/React-MIT.txt) |
| React DOM | 19.3.1 | MIT | [Source](https://github.com/facebook/react/tree/v19.3.1/packages/react-dom), [license](public/licenses/React-DOM-MIT.txt) |
| Vite | 7.3.7 | MIT; bundled dependencies have additional permissive notices | [Source](https://github.com/vitejs/vite/tree/v7.3.7), [full bundled notices](public/licenses/Vite-LICENSE.md) |
| ONNX Runtime Web | 1.31.1 | MIT; third-party notices included | [Source](https://github.com/microsoft/onnxruntime/tree/v1.31.1), [license](public/licenses/ONNX-Runtime-MIT.txt), [third-party notices](public/licenses/ONNX-Runtime-ThirdPartyNotices.txt) |
| Demucs / HTDemucs | Model described below | MIT, Meta Platforms, Inc. and affiliates | [Source](https://github.com/facebookresearch/demucs), [license](public/licenses/Demucs-MIT.txt) |
| StemSplit HTDemucs ONNX conversion | `d54ed9eb60e258ea82131c6ee14578628816456a` | MIT as declared by the model publisher | [Pinned model repository](https://huggingface.co/StemSplitio/htdemucs-onnx/tree/d54ed9eb60e258ea82131c6ee14578628816456a) |
| @breezystack/lamejs | 1.2.7 | LGPL-3.0 | [Exact source revision](https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c), [package notice](public/licenses/lamejs-LICENSE.txt), [LGPL text](public/licenses/LGPL-3.0.txt), [GPL text](public/licenses/GPL-3.0.txt) |

## Separation model

The app downloads `htdemucs_fp16weights.onnx` from the pinned StemSplit model revision only when AI separation is selected. The model is not bundled in the initial app. Download size: 165,612,636 bytes. SHA-256: `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`.

The app's model worker is [`src/separation/separate.worker.ts`](src/separation/separate.worker.ts). It downloads model weights; it does not upload the chosen audio.

## MP3 encoder and corresponding source

SUNIX uses LAME through the unmodified JavaScript encoder package **@breezystack/lamejs 1.2.7**, published from commit `1fb0ef5fa177413107e2e107d054a9b994e3f79c`. LAME is developed by the [LAME project](https://lame.sourceforge.io/). Alex Zhukov's [lamejs](https://github.com/zhuker/lamejs) port and [this package's source](https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c) provide the JavaScript implementation.

The exact published package is available at [npm](https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7), with the [versioned package archive](https://registry.npmjs.org/@breezystack/lamejs/-/lamejs-1.2.7.tgz). Corresponding source is available from the [pinned source tree](https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c) and its [source archive](https://github.com/shijinyu/lamejs/archive/1fb0ef5fa177413107e2e107d054a9b994e3f79c.tar.gz). The package is imported lazily in [`src/separation/encode.worker.ts`](src/separation/encode.worker.ts) and bundled into a separate encoder chunk by Vite. SUNIX makes no changes to the encoder's source code.

You may replace or modify this encoder under its license. To rebuild it, obtain that source revision, run its `npm install` and `npm run build`, replace the package in a local SUNIX checkout with the modified package, and run SUNIX's `npm install` and `npm run build`. The SUNIX application source, package lockfile, and worker import are published in [this repository](https://github.com/robdojo88science/sunix). No application terms restrict reverse engineering for debugging modifications to this LGPL component.

## License provenance

React, React DOM, Vite, and the lamejs package notice were copied from the exact installed packages. ONNX Runtime license and third-party notices were copied from upstream tag `v1.31.1`. The Demucs license was copied from the upstream Meta repository. GNU GPL/LGPL texts are reproduced from SPDX's canonical license-list-data texts; the LGPL file also includes the incorporated GPL terms. These notices do not replace the original projects' licenses or grant rights to unrelated user audio.
