# Playback design

Playback lives in the note header. The idle trigger expands in place to Play, Speed, More and Close (160px). Panes at or below 650px use Play and More (80px), with 40×44px targets and a restrained 32px visual capsule. Expansion/collapse is 320ms and respects reduced motion. State/segment changes do not resize the control. A thin ring represents the selected reading scope; sentence counts and seeking live under More.

More has at most four groups: playback options, sound/setup, position/follow, and end reading. Keep explicit cursor, selection and from-start actions. Moving the caret never seeks; paused navigation remains paused. Selection playback retains the full selected range and does not highlight unrelated text. Dictation stays separate. Native editor selection and undo remain untouched.

Sound setup uses a temporary per-provider draft. Missing credentials expose inline fields before audition. Only actual playback completion verifies that exact service/key/model/voice combination; changes invalidate it. Applying saves the selected profile and provider-specific SecretStorage key. Cancel does not switch the current voice. Preview restores the original reading owner, sentence and rate paused; late completions cannot restore a closed session. The dialog has one scrolling body and a fixed footer. Existing settings and history persist; recent voices are folded. New Mac users are offered installed voices, not a fabricated enhancement of unavailable voices.

Use neutral ink/paper colors, Lucide icons, hidden accessible labels, calm single borders and visible keyboard focus. Verify real wide/narrow/short/light/dark states, popovers, errors, paused seeking, cursor boundaries and release assets. Desktop simulation is not mobile hardware verification.

# Share

Export the current selection, section(s) or complete note through one dialog. Use the established neutral ink/paper palette, system UI font, Lucide actions, hidden accessible names and visible focus; do not create hover tooltips. A few format, orientation and visual-style choices use chips. The scope selector accommodates dynamic headings; multi-section choices remain visible when needed.

Start with a useful audio/short-video/wide-video preset, text count/duration estimate, current voice and speed. Reuse speech settings and recent voices; do not ask for another key. Fold text editing and optional titles, sidecar subtitles, still cover, embedding and destination. Paid/long exports show a specific cost/time warning. Preview is generated locally and does not imply that synthesis is connected.

Keep generation phases and cancel visible. Closing cancels pending synthesis/encoding. Failures retain the input and show the recovery reason. Success lists actual files, sizes and reveal actions; another export reuses the choices. Save preferences after a successful export. Default destination follows Obsidian attachments, with optional desktop folder browsing/absolute path; avoid overwrites by numbering collisions. Insertion is optional and applies to the connected note editor after generation.

Video owns its subtitle/word-emphasis timeline, independent of reading highlights. Support 1080×1920 and 1920×1080 with the same content hierarchy, four pluggable visual styles and optional cover/outro; platform circles are not brand logos. Check WebCodecs at runtime, offer MP3 on unsupported desktops, and hide video/custom system folders on mobile. Actual Windows/macOS results and untested hardware are reported separately.
