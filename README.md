# Qiaomu Audio

Read any Obsidian note aloud with one click, and dictate speech straight into your notes.

[Official directory](https://community.obsidian.md/plugins/qiaomu-audio) · [中文说明](README_ZH.md) · [Releases](https://github.com/joeseesun/qiaomu-audio/releases) · [Help and feedback](https://github.com/joeseesun/qiaomu-audio/issues)

## Read aloud

- Use the speaker button in any Markdown note. Read selected text, start at the cursor, or start from the visible text in reading view.
- Pause/resume, move between sentences or drag the sentence slider. Seeking while paused stays paused. The player keeps its size across loading, playback and following states.
- Place the caret and use the caret button to read from that exact character; selected text is read on its own. Moving the caret does not interrupt playback. Use **More → Read current note from the start** to restart the full note. Finished selections replay their original scope.
- The current sentence is highlighted in the editor; reading view follows the relevant text. Manual scrolling pauses following. The locate button returns to the spoken text without seeking audio.
- Your service, model, voice and speed survive a restart. The voice picker offers up to eight recently played combinations for one-click restoration; auditioning voices does not fill history. Keys stay in SecretStorage.
- Frontmatter, code blocks, formulas, comments, embedded media and raw URLs are skipped. Links read their visible text.
- Choose system speech, Mac speech, Edge TTS, offline Kokoro/MeloTTS, OpenAI and compatible services, Qwen, Doubao, MiniMax, SiliconFlow, ElevenLabs or Azure.
- Import saved reading settings and keys from Qiaomu Reader. Matching downloaded model data is reused.

## Dictate

Use the microphone button or the dictation command. Finish to insert recognised text at the captured cursor position; Escape cancels. Failed recognition keeps the recording available for retry or saving.

- Local SenseVoice supports Chinese, English, Japanese, Korean and Cantonese on desktop. An [external runtime setup](docs/local-runtime.md) is required once; then download about 156 MB of model data in settings.
- Cloud recognition supports SiliconFlow, Doubao, GLM, StepFun, Xiaomi MiMo, Groq and OpenAI, plus local/custom compatible services. Choose a service in the Add dialog, confirm its required settings, then switch between saved configurations. Cancel discards the draft and identical configurations are reused.
- Choose recognition after finishing, or recognition of each phrase after a pause. Optional saved audio uses the vault's attachment folder.

## Cloud setup

Choose a provider, follow **Get a key** or **Setup guide**, paste its API key, and test the voice or connection. Required fields such as Azure region and custom service URL are visible. Service addresses for named providers and low-frequency options are under Advanced.

Keys are hidden by default, can be shown temporarily, and are stored in Obsidian SecretStorage rather than plugin `data.json`. Speech-to-text keys are isolated by provider, and existing keys are migrated to the saved provider. Switching settings or cancelling a test clears its result; a saved configuration is never labelled connected until its test succeeds.

Voice tests send a short sample sentence. Recognition tests send one second of generated audio without opening the microphone. Tests may incur a small provider charge. Tests run only when requested.

## Privacy, network use and external files

- System speech, Mac speech and local model inference do not upload your text or recordings. System voices may depend on your device's OS configuration.
- Edge TTS sends reading text to Microsoft's speech service. It requires network access, uses an unofficial interoperability protocol, needs no API key, and is desktop-only. Availability is not guaranteed; system speech is an alternative.
- Cloud providers receive only the text or recording required for the selected action. Their accounts, service access and usage charges are governed by their terms. Local compatible services use localhost; custom remote services receive the same request data.
- Local model data is downloaded only after you choose Download and use, from fixed upstream Sherpa GitHub releases. File sizes and SHA-256 checksums are verified. Model data, worker configuration, temporary audio and runtime files are outside the vault, in platform application data/cache directories, so multiple vaults can share model data without syncing it. macOS uses `~/Library/Application Support/qiaomu-audio/speech`; Windows uses `%LOCALAPPDATA%\qiaomu-audio\speech`; Linux uses `$XDG_DATA_HOME/qiaomu-audio/speech` or `~/.local/share/qiaomu-audio/speech`.
- Python/Sherpa dependencies are prepared by a separate optional installer run outside Obsidian. The plugin does not install or update executable dependencies. See [local runtime setup](docs/local-runtime.md) for the external tool's downloads and storage.
- There is no telemetry. Provider console/help links open in your browser without API credentials. About-page support images are requested from `radio.qiaomu.ai` only when the About section is opened.

## Install

Open the [official directory entry](https://community.obsidian.md/plugins/qiaomu-audio) and choose **Add to Obsidian**, or search **Qiaomu Audio** in Community plugins once the client catalog includes it. Version 1.0.1 has completed its automated official review and its listing is public; the last recorded client-catalog check is in the [release evidence](docs/release-evidence-1.0.1.md).

For manual installation, use the [latest release](https://github.com/joeseesun/qiaomu-audio/releases/latest), put `main.js`, `manifest.json` and `styles.css` in `<vault>/.obsidian/plugins/qiaomu-audio/`, then enable Qiaomu Audio in Community plugins.

Mobile uses system speech and cloud services; Edge, Mac speech and managed local models are desktop features. The minimum Obsidian version is 1.11.4. Windows/Linux automated checks do not prove native device playback; mobile device playback and microphone acceptance have not yet been verified.

## For other plugins

```js
const audio = app.plugins.plugins['qiaomu-audio']?.api;
await audio?.speak('Hello');
const text = await audio?.transcribe(blob); // Blob / ArrayBuffer / Float32Array
// Start dictation in the current note:
audio?.startDictation();
```

## Development

```sh
npm ci
npm run check
```

The check runs English/Chinese translation validation, ESLint, Node/Python tests and the production build. `node scripts/e2e-local-asr.mjs` downloads and checks the local recognition model when its external runtime is prepared. See [architecture](docs/architecture.md).

## License and attribution

GPL-3.0-only. Reading code is adapted from Qiaomu Reader (GPL-3.0), and cloud recognition provider protocols from Qiaomu Clipper (MIT), both by 向阳乔木.

Edge TTS interoperability is based on [rany2/edge-tts](https://github.com/rany2/edge-tts) (LGPL-3.0); see [the license](licenses/edge-tts-LGPL.txt). WebSocket transport uses [ws](https://github.com/websockets/ws) (MIT; license included in the bundle).

Models are not distributed with the plugin: Kokoro (Apache-2.0), MeloTTS (MIT), SenseVoice Small (FunASR Model License). The optional Sherpa ONNX runtime is Apache-2.0 and is installed separately.

## Works independently with Qiaomu AI RSS

Both plugins can read aloud on their own. Starting or previewing speech pauses the other plugin without losing its position. Copy speech settings explicitly once if desired; keys and preferences remain independent. Downloaded local model data is shared, and disabling either plugin leaves the other usable.

Mac system speech automatically lists installed enhanced voices. Search and audition voices in the voice picker; closing the audition restores your reading sentence paused.
