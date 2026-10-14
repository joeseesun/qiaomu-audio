# Playback acceptance: 1.0.5

2026-10-14, independent `qaudio-playback-qa` vault, macOS Obsidian 1.14.4. Daily vault files, settings and credentials were not used.

## Changes and causes

Loading text previously inserted a message row at each sentence boundary. Stopping follow inserted a text button in the wrapping row. Repeated render also rebuilt message actions. The new player reserves transport/status/position rows, uses a fixed follow control, reuses the mounted bar for explicit jumps and only rebuilds actionable messages when their content changes.

## Verification

- `npm run check`: 91 JavaScript tests, 4 Python tests, complete zh/en translation keys, lint and production build passed on the isolated release branch. One pre-existing unused import warning in settings remains. The separate, unshipped word-highlighting commit was not included.
- 233 host assertions covered light/dark, 360/640 CSS-pixel note panes, identical bounds during loading/playing/paused/ended and follow changes, contained controls and non-overlap. Playback used a real Audio element and a deterministic silent WAV; state snapshots also exercised each UI state.
- Exact-character restart, caret retention, reuse of the same player element, pause-preserving next/slider, selection-only playback, ended selection replay, full-note restart, manual-scroll follow recovery, stable retry/settings actions and restoration of recent service/model/voice combinations passed.
- A real plugin disable/loadManifests/enable cycle restored service, model, voice, rate and recent history. Unit tests cover bounded/deduplicated history, secret stripping, saved custom endpoints and late synthesis cancellation.
- Real Mac system synthesis played the opening and next sentence successfully. Both loading/playing transitions stayed at 456 × 106 CSS pixels, with no provider error. The used Mac voice was added to recent history.
- First capture used a hidden QA window, which did not deliver ResizeObserver notifications. After showing the QA window and activating the note, rendering and all assertions passed. Hidden-window geometry is not counted as acceptance evidence.
- Artifact audit passed. The optional tooltip regex reports false positives for `aria-labelledby`, comments and `removeAttribute`; these are reviewed as removals/accessibility labels, not tooltip creation.

## Limits

Narrow panes were simulated on desktop. Paid-provider connections and mobile hardware were not exercised. First-use disclosures and actionable errors may deliberately expand the player; ordinary playback state changes do not.
