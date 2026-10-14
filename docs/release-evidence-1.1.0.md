# Official release evidence: 1.1.0

Checked on 2026-10-14. Release headline: **导出分享 / Export and share**.

- Release/tag: [1.1.0](https://github.com/joeseesun/qiaomu-audio/releases/tag/1.1.0), public and not a prerelease, at `0be7fd60d60a8a837d9f3f406fbedd49a7832a79`. [PR #6](https://github.com/joeseesun/qiaomu-audio/pull/6) is merged. The merge tree matches the frozen candidate `f3ea7a7a17f7bfb6d56e25952a968e1f3a4f835a`.
- Final candidate [CI](https://github.com/joeseesun/qiaomu-audio/actions/runs/38576665640), [main CI](https://github.com/joeseesun/qiaomu-audio/actions/runs/38576927149) and [release CI](https://github.com/joeseesun/qiaomu-audio/actions/runs/38577494304) passed.
- Preview scan and formal review for the final merge SHA both show **Completed**, with no Error. Formal review reproduces `main.js` byte-for-byte, verifies main/styles artifact attestations, and reports no vulnerable dependencies.
- Warnings remain for direct filesystem access, shell execution, and partially supported CSS `text-decoration`/`clip-path` on the minimum Obsidian version. Recommendations cover vault enumeration and the optional external `install-local-runtime.py` asset, which Obsidian does not install. These warnings are not manual-review approval.
- The [public directory](https://community.obsidian.md/plugins/qiaomu-audio) shows current version **1.1.0**, an **Add to Obsidian** link, and an updated export-first description covering narration, remembered/recent voices, dictation, privacy and limitations. It includes four authentic desktop screenshots, including the current export dialog. The added 1200×800 image was anonymously fetched with HTTP 200. No mobile screenshot is claimed.
- Anonymous live client-index verification at `2026-10-14T14:30:21Z` found id `qiaomu-audio`, repository `joeseesun/qiaomu-audio`; catalog SHA-256 `697edfae1ecb45daa33e1e9264b836f39f47543939e9795f514e60973d2e8f1f`. The index still carried the older short description and the notice **not manually reviewed by Obsidian staff**.
- Actual Community plugins search in an isolated macOS Obsidian **1.14.4** vault found Qiaomu Audio and displayed latest version 1.1.0. Its native **Install**, then **Enable** buttons completed; the loaded plugin reports 1.1.0 and exposes the export manager. This is UI installation evidence, in addition to the earlier native-installer fresh/upgrade checks. The private daily vault and primary checkout were not replaced.

## Public and installed assets

Authenticated draft, anonymous public downloads and native installations were compared. Public assets match the frozen build. Obsidian appends only the known `\n/* nosourcemap */` suffix to installed main.js.

| Asset | Public bytes | Public SHA-256 |
| --- | ---: | --- |
| main.js | 551015 | `4908a607a7dacdb11a7e457074119f704848be52b140eac6e2cb8f3ce731e508` |
| manifest.json | 295 | `4837f0187a2fd21eb2021c7bf895f79c74e61e51e750b34947001e053d8bfa92` |
| styles.css | 31771 | `78ddcbb07fd56c120b0acd3fb8206a61dbc2c64df18c36aab04678bfcd46cb55` |

Installed main.js: 551033 bytes, SHA-256 `fd198dfe846ed049166dcf77d0c4fa486c2eefba9e03e8ed5668e212926933dc`. Manifest and styles are exact matches. Fresh/upgrade checks preserved speech settings, recent combinations and ASR configuration.

## Functional evidence and limits

See [interaction QA](interaction-qa-1.1.0.md) and [release notes](release-1.1.0.md). Windows host exports passed for MP3/SRT/PNG and both H.264/AAC video shapes using a deterministic WAV; this does not verify cloud TTS. A current macOS screenshot session used the installed Samantha voice through the real voice picker catalog and reached playing, then paused. Doubao ASR passed a real API recognition request with synthetic speech; it does not prove microphone capture or insertion. No credentials are included in repository, CI or these documents.

Reading highlights sentences. Exported video subtitles have word timing; reading-side word-by-word highlighting is not released. Linux, mobile hardware, paid-cloud TTS exports, human listening of speed changes and the empty-folder picker remain unverified. Edge export was not rerun at the user's request. Official automated review, manual review and hardware acceptance remain distinct.
