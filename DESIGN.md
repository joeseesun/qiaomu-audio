# Playback design

The player supports listening while reading, selecting text and taking notes. Keep the existing neutral ink/paper palette, system UI font, Lucide icons and a single filled play/pause button. No hover tooltips; controls use hidden accessible names and visible keyboard focus.

- The player has a fixed width and stable transport, status and sentence-position rows. Loading, paused, playing, finished and follow states never add/remove controls or change its bounds. Only actionable errors and the first-use network disclosure expand the message area.
- Wide notes use one transport row. Notes narrower than 500 CSS pixels use an explicit two-row grid with 44-pixel button heights. The layout responds to the note pane rather than the full app window.
- Play resumes the current position. Moving the editor caret does not seek. The caret button explicitly starts at the caret, or reads the current selection. The More menu names these operations and provides Read from start and speech settings.
- Previous/next and the sentence slider preserve pause. The slider represents sentences, never an invented audio duration. Release/change commits a jump; dragging previews the target number.
- Manual document wheel/touch scrolling stops page-follow immediately. The permanent locate control restores following without changing the audio position. The active following state is exposed through aria-pressed.
- Explicit jumps within the same note reuse the mounted player and preserve the editor selection. Empty tails do not silently restart. Ended selections replay their original scope. Settings changes retain pause; previewing a voice returns to a paused reading session.
- Save the active service, its own model/voice configuration and global speed. Keep up to eight actually played service/model/voice combinations, deduplicated and credential-free. Recent choices restore the complete configuration using that service's existing SecretStorage key. History can be cleared.
- Spacing uses 4/6/10/12/16 CSS pixels; the player keeps 10-pixel insets and a 22-pixel status row. Error actions, long voice names, long recent labels and narrow notes must remain within bounds. No layout animation.

Verification covers real Obsidian rendering in light/dark, wide/narrow panes, stable bounds across sentence transitions, exact caret restart, selection scope, paused seeking, rapid cancellation, settings reload and recent restoration. Desktop narrow simulation does not establish mobile hardware support.

# Share

Export the current selection, section(s) or complete note through one dialog. Use the established neutral ink/paper palette, system UI font, Lucide actions, hidden accessible names and visible focus; do not create hover tooltips. A few format, orientation and visual-style choices use chips. The scope selector accommodates dynamic headings; multi-section choices remain visible when needed.

Start with a useful audio/short-video/wide-video preset, text count/duration estimate, current voice and speed. Reuse speech settings and recent voices; do not ask for another key. Fold text editing and optional titles, sidecar subtitles, still cover, embedding and destination. Paid/long exports show a specific cost/time warning. Preview is generated locally and does not imply that synthesis is connected.

Keep generation phases and cancel visible. Closing cancels pending synthesis/encoding. Failures retain the input and show the recovery reason. Success lists actual files, sizes and reveal actions; another export reuses the choices. Save preferences after a successful export. Default destination follows Obsidian attachments, with optional desktop folder browsing/absolute path; avoid overwrites by numbering collisions. Insertion is optional and applies to the connected note editor after generation.

Video owns its subtitle/word-emphasis timeline, independent of reading highlights. Support 1080×1920 and 1920×1080 with the same content hierarchy, four pluggable visual styles and optional cover/outro; platform circles are not brand logos. Check WebCodecs at runtime, offer MP3 on unsupported desktops, and hide video/custom system folders on mobile. Actual Windows/macOS results and untested hardware are reported separately.
