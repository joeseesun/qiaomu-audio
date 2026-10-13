# Interaction acceptance: 1.0.4

Verified in an isolated macOS Obsidian 1.14.4 vault on 2026-10-13.

- 84 JavaScript and 4 Python tests; translation-key checks, lint and production build passed.
- 58 host assertions covered reading, dictation and About in light/dark at 360/640 CSS pixels; all available TTS setting forms with advanced disclosure; voice search, empty results, clear and close; nine transcription setup forms at narrow/desktop sizes; first-use engine chooser; wrapped reading/dictation bars without overlap.
- The voice service selector and search input have a measured 16 CSS-pixel gap.
- Synthetic audio exercised phrase insertion before Finish, generated a valid 32,044-byte WAV attachment, and embedded its link into the test note. Recognition was stubbed for this check; no microphone or live provider claim is made.
- Saved batch/recording-off settings survived a real plugin reload; fresh settings use live/recording-on.
- Mobile hardware and live paid-provider connections remain unverified. Narrow layouts were simulated on desktop.
