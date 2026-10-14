# Release handoff: 1.1.0 (for Codex)

Working notes, not a product document: delete this file in the release commit.

## What to release

Branch `worktree-share-export`, rebased on `origin/main` at `b367f02` (1.0.5). Three commits on top:

1. `58c5672` Report the spoken word for read-along highlighting. The earlier karaoke commit, **engine only**: word timing
   (`src/core/tts/timing.js`), real word timestamps from Doubao, estimates for every other voice, `owner.onProgress` in the
   controller. No editor or player code uses it yet, so users see no difference. It is included because the share video
   uses the same word timings for its subtitles.
2. Export and share (MP3 / MP4 / SRT / cover image) with a dialog, a Share settings tab and export folder.
3. Pluggable visual styles for the video (spectrum, ring, live waveform, loudness bars).

The release headline is **Export and share**. Do not announce word-by-word highlighting while reading aloud: the editor side
does not exist in any committed code. Your uncommitted karaoke work in the main checkout was compared with `origin/main`
(1.0.5): every modified file is identical to 1.0.5 except `src/core/tts/controller.js` (karaoke engine merged with 1.0.5), so
nothing else new was found there. If the read-along UI is finished before release, merge it and add it to the notes.

## Do

1. Check out the branch; run `npm ci && npm run check` (expect 131 JavaScript tests, 4 Python tests, 0 lint errors).
2. Bump to `1.1.0` in `manifest.json`, `package.json`, `package-lock.json` (two places) and add `"1.1.0"` to `versions.json`
   with the same minimum app version as the previous entries (the new code uses `fileManager.getAvailablePathForAttachment`,
   available long before 1.11.4).
3. Write `docs/release-1.1.0.md` (the workflow uses it as the release notes) in the style of the earlier ones: short, plain,
   what changed for the user, what was verified and what was not. Write `docs/interaction-qa-1.1.0.md` from the evidence
   below. Add a Share section to `DESIGN.md` (neutral palette, no tooltips, chips instead of dropdowns for few choices).
4. Commit, push, open the pull request. After it merges, tag `1.1.0`; `.github/workflows/release.yml` drafts the release
   with `main.js`, `manifest.json`, `styles.css`. Review the draft before publishing.

## Verified

- `npm run check` on this branch. New tests: scope and outline, emphasis ranges, WSOLA time stretch, MP3/ID3, SubRip,
  timeline assembly, subtitle layout, export pipeline with fakes, settings normalisation, FFT/spectrum, every visual style
  drawn in both shapes against a recording canvas.
- Real Obsidian (macOS, isolated vault and user-data directory, debugging port): the dialog opens from the command and the
  context menu; export of selection and whole note with the macOS system voice produced MP3, SRT, cover PNG, portrait and
  landscape MP4. ffprobe: H.264 + AAC, 1080×1920 and 1920×1080, 30 fps, 29 s, about 5 MB each. Frames inspected for cover,
  all four visual styles, highlighted word, emphasised words, end card and fade-out.
- Speed: durations exact at 1.5× and 2×; pitch ratio compared with ffmpeg `atempo` on the same material (1.030 vs 1.030 at
  1.5×, 1.079 vs 1.062 at 2×; both inflated by the measuring method).
- Export folder: absolute folder outside the vault, name collision (` 2`), relative path rejected with a message, nothing
  left in the vault, Share tab renders.
- Voice picker from the dialog still works with 1.0.5's recent voices.

## Not verified (say so in the notes)

- Windows and Linux: WebCodecs H.264 / AAC encoding is checked at run time; when unsupported the user gets "This device
  cannot encode video" and can export MP3. Please test on Windows if you can.
- Mobile hardware: video and custom folders are hidden on mobile, MP3 only. Not run on a phone.
- Edge online voice and paid cloud voices through the export path: the Edge service rate-limited the test run, so the
  macOS voice was used. The limit message displayed correctly. Run one Edge export before publishing.
- Listening test of the stretched speech by a person. Only measurements were done.
- Folder picker for an empty folder: Electron cannot report it, so the user is told to type the path (message tested by
  reading the code only).

## Worth knowing

- `main.js` is about 550 KB; the MP3 encoder (LGPL-3.0) and MP4 muxer (MIT) are bundled. Notices are in
  `licenses/share-export-dependencies.md` and the bundle banner.
- Platform badges on the end card are coloured circles with a character, not brand logos, by decision.
- `docs/project-illustrated-share.md` is the approved follow-up (pictures from the note in the video, image cards, rich
  blocks); `docs/visual-styles.md` explains how to add a visual style.
