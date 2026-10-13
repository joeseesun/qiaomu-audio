# Release evidence: 1.0.1

Recorded on 2026-10-13. This is a time-bound publication record, not a promise about future catalog state.

- Release candidate/tag: `b19c3bd38538dbb1974824a98b25c96e459ecb61`.
- Main merge: `4a6f95b5a7bab1c585499a56c3487098ab77ea59`; the complete tree matched tag 1.0.1 at merge.
- [Implementation PR](https://github.com/joeseesun/qiaomu-audio/pull/1) merged after anonymous public asset verification.
- [Three-platform CI](https://github.com/joeseesun/qiaomu-audio/actions/runs/38347423358) passed; [draft release and attestation](https://github.com/joeseesun/qiaomu-audio/actions/runs/38347914381) passed.
- [Public release](https://github.com/joeseesun/qiaomu-audio/releases/tag/1.0.1) is neither a draft nor a prerelease.
- Official preview and formal review completed for the exact candidate SHA. Formal build verification reproduced release `main.js` byte-for-byte; dependency checks found no vulnerable dependencies. No Error was reported.
- Remaining review warnings: Node filesystem access and child processes for explicitly documented desktop speech/runtime functions, plus basic CSS text-decoration none/underline compatibility. The external installer asset is a recommendation because Obsidian does not download it; it is intentionally a separate optional user-run tool.
- [Official listing](https://community.obsidian.md/plugins/qiaomu-audio) is public with Add to Obsidian and three screenshots captured from Obsidian 1.13.7.

## Artifact and installation checks

Anonymous exact release-download URLs returned HTTP 200 and matched local build bytes and hashes:

| Asset | Bytes | SHA256 |
|---|---:|---|
| main.js | 255522 | fe26a8c257f20a55688a5abf97dc6048627ff8adf067796eccacce8a009b6a8d |
| manifest.json | 295 | e1da8e0dd4e13aa3fa4057a3b4c8f3784a117a43ff849ea9026c42a92a911199 |
| styles.css | 19314 | 87e2027148d8198467da30a9143793b241fb75379d70852d09026cd32bcb7556 |

Authenticated draft assets also matched these hashes. In an isolated macOS vault, fresh initialization and upgrade preserving persisted settings passed. The Obsidian native installer downloaded the public version and enabled it successfully; installed manifest and CSS matched exactly, and main.js differed only by Obsidian's exact 18-byte `\n/* nosourcemap */` suffix.

Functional checks: 71 JavaScript and 4 Python tests, lint, 257 English/Chinese translation keys, 42 settings interaction assertions, light/dark rendering, 360px layout, real Mac speech playback, real local ASR and cancellation. Simulated narrow layout does not establish mobile-device acceptance. Every paid cloud provider with live credentials and Windows/Linux native audio remain unverified.

## Client catalog boundary

At 2026-10-13 04:52:29 UTC, the anonymous official community-plugins.json contained 8811 entries and did not include qiaomu-audio. Its SHA256 was `3c66488b19a8e08631fdec5d48101bd5267da60dd867e370c3e2cdec6a09f3f4`. Obsidian 1.13.7 macOS search for Qiaomu Audio likewise returned zero results. The public listing and native installation using an explicit repository/version do not establish catalog search or installation from a search result. Catalog synchronization is an external remaining step, with no fixed deadline claimed here.
