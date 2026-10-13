# Shared speech

Prior-art assessment: Qiaomu Audio (this GPL-3.0-only repository) already supplies the tested TTS controller, cloud adapters and local worker. Reuse this implementation via the `qiaomu-audio/speech` package export, pinned to an immutable Git commit by consumers. Obsidian's public Workspace Events API coordinates separately bundled instances; no consumer requires another installed plugin. No new runtime dependency installer is introduced.

`qiaomu-speech:claim-v1` carries an opaque source object. A user starts/resumes/skips/retries or previews speech: every other instance pauses, without automatic resume. System speech releases its global utterance and resumes at its saved sentence; audio providers retain current playback time. Unload removes only this instance's listener/player.

Secrets use `<plugin-id>-tts-<provider>` in Obsidian SecretStorage. Import is an explicit one-time copy and preserves existing target keys. Model data, download locks and worker endpoints use the existing application-data directory, independent of either plugin's install directory. Shared data is never removed on unload.

Progress identifies the exact spoken body by two hashes and length; it stores offsets, completion and a timestamp, bounded to 500 entries. RSS keys include article id and actual rendered mode; Audio keys use note path. Selection speech does not overwrite article/note progress.

API reference: https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts

## Reader settings parity

Reference: Qiaomu Reader GPL-3.0 sources `src/tts-ui.js`, `tts-choices.js`, `tts-mac-voices.js`, `tts-local.js` and `tts-local-models.json`. Audio and RSS bundle this same implementation; their settings and voice pickers are consumers, not separate voice registries.

- Provider presets, curated model choices, account voice/model discovery, custom IDs and model-scoped voice defaults.
- Native AVFoundation catalog loads automatically for Mac system speech; enhanced/premium quality and readable aliases remain visible while the synthesis request keeps the original Apple identifier. Browser system speech explains its smaller catalog.
- Searchable voice picker offers per-voice audition and model changes. Audition pauses the reading session and restores its sentence/rate paused when closed. Changing voices never silently selects a different model.
- Account discovery can be refreshed; aborted or late responses cannot replace a different provider/account. Changing a key, region or service address invalidates its catalog.
- Local TTS model/voice choices exclude ASR, share verified model data, and preserve downloaded files on unload. The standalone runtime installer is an explicit external step rather than a plugin download of executable code.

ASR additions use a native draft modal: choose provider, fill required settings, confirm Add and use. Cancel/Escape leaves saved profiles and the active engine unchanged. Identical endpoint/model/account configurations are reused. Readiness is unverified until the explicit connection test succeeds.
