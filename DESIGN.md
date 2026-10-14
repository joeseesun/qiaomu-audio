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
