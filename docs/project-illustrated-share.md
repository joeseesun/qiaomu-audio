# Project: illustrated share (图文)

Status: approved, not started. Builds on Export and share (1.1.0).

## Goal

A note usually contains pictures, quotes and structure, not only sentences. Exported videos and images should carry them,
so a friend or a feed sees the note, not only hears it.

## Who and when

- Someone shares a note with screenshots or diagrams: the picture should appear while the sentence about it is read.
- Someone posts to Xiaohongshu or WeChat Moments: a set of text-and-image cards (no audio) is often better than a video.
- Someone shares a quote or a key list: it should look designed, not like body subtitles.

## What the current code already gives us

- Every spoken item keeps its source offsets (`start`, `end`), so anything in the note can be tied to a moment of the audio.
- The video is a pure function of time (`drawFrame(ctx, scene, t)`), so a new layer is one more function, not a new pipeline.
- Visual styles are pluggable (`docs/visual-styles.md`), and layout code for subtitles is canvas-independent.
- Embedded images are currently skipped when reading (`![[a.png]]`, `![alt](b.png)` in `markdownSpeech`).

## Phases

**1. Pictures in the video (MVP).**
`markdownSpeech` records where an image embed occurs; `markdownChunks` attaches it to the next spoken item (`item.images`).
The scene turns these into picture spans (from the item's start to the next picture or the end of the section). While a
span is active, the picture fills the band above the subtitles with a slow zoom, and the audio visual shrinks to a thin
strip at its bottom edge. Vault images only; web URLs are shown only if already downloadable without credentials, otherwise
skipped with a note in the dialog. A toggle "Show pictures from the note" (on when the scope contains pictures).
Acceptance: portrait and landscape pictures both fit without distortion; no picture means no change from today; memory stays
bounded (decode once, downscale to 1920 px on the long side, release after export); cancelling frees them.

**2. Image cards without audio.**
Export the chosen scope as a set of PNG cards (default 3:4, 1080×1440) for posts: title card, text cards paginated with
the same subtitle layout (no highlight), pictures as full cards, end card with the signature. Reuses `scene.js` drawing
and the signature settings. Acceptance: a card never cuts a sentence; page count shown before export; files named in order.

**3. Rich blocks.**
Callouts and quotes as quote cards, code as a monospaced card with a title, tables as a card, chapter title cards on
heading changes, optional per-chapter accent colour. Each is a block type with its own layout function.

## Decisions needed before phase 1

- Maximum pictures per video and what to do with a very tall screenshot (letterbox with blurred fill, or pan down it).
- Whether a picture replaces the audio visual completely or shares the band (the proposal above shares it).
- GIF and video embeds: skipped in phase 1.

## Risks

- Large notes with many full-resolution screenshots: decode lazily by span and downscale.
- Timing: a picture placed before a heading belongs to the next section; confirm with real notes.
- Licensing and privacy: pictures stay local; nothing is uploaded. Exported files can contain private screenshots, so the
  dialog lists how many pictures will appear before the user generates.
