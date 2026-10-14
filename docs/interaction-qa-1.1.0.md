# Export and share acceptance: 1.1.0

## Scope and integration

Based on main 1.0.5 (`b367f02`), branch `worktree-share-export`. Export/share is the release headline. The primary checkout was compared by contents: its reading/editor files add no further read-along UI; its controller already matches the timing engine on this branch. No unfinished primary-checkout files are staged. Word timing feeds exported video subtitles; reading still highlights sentences.

## Current-run evidence

- Initial `npm ci && npm run check`: 131 JavaScript and 4 Python tests, complete 388 zh/en keys, zero lint errors. The audit found a Moment advisory in development tooling; overriding Moment to 2.31.0 resolves all reported vulnerabilities. No runtime package is added by the override.
- Synthetic English speech, converted to 16 kHz mono WAV, passed the real Doubao flash ASR endpoint using the project's `recognizeCloud` implementation. Exact transcript: “This is an audio recognition test. Export and share your notes.” Credentials were supplied to the process through hidden stdin, retained only in memory, and excluded from repository/CI. This verifies the recognition API, not microphone capture, dictation insertion or TTS.
- `scripts/qa-share-host.mjs` installs the built plugin into a fresh isolated vault/profile and runs production ShareManager decoding/export/saving. Only speech synthesis uses a deterministic WAV. It checks MP3, SRT, speed 1.5×, custom folder, collisions, the export command and both video shapes/PNG or the specific unsupported-codec fallback. Windows runs this with official Obsidian 1.14.4 in CI; generated media, host JSON and screenshot are uploaded as evidence. Final Windows result pending.

## Evidence supplied in the handoff

Source commits `beb37c6` (share) and `bbb5f28` (visual styles): macOS isolated Obsidian tests opened the dialog from command/context menu; exported selection/full note through the system voice to MP3, SRT, PNG and portrait/landscape MP4. ffprobe reported H.264/AAC, 1080×1920 and 1920×1080, 30 fps, 29 seconds. Frames were inspected for cover, all four styles, subtitles/emphasis, outro and fade. Speed measurements at 1.5×/2×, absolute external-folder output, collisions, relative-path rejection, Share settings and recent-voice picker were also reported. These are inherited observations, not rerun claims.

## Limits

Linux, mobile hardware, paid-cloud TTS exports, human listening of speed changes and empty-folder picker are not verified. Edge synthesis/export is not rerun, following the user's explicit cancellation. Synthetic PCM cannot prove a cloud voice's quality or credentials. CI desktop testing cannot prove all Windows hardware. No private daily vault is replaced. Final public asset installation, official scan and release stage are recorded separately.
