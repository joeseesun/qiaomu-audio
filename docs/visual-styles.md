# Share video: visual styles

The band between the title and the subtitles in an exported video is drawn by a **visual style**. Styles are
registered in [`src/core/share/styles.js`](../src/core/share/styles.js); the share dialog lists whatever is
registered and saves the user's choice in `settings.share.visual`.

| id | What it shows | Reads |
| --- | --- | --- |
| `spectrum` (default) | 48 frequency bands, bass to treble, mirrored around the centre line, cool-to-warm colour | `spectrum` |
| `ring` | The same bands wrapped around the avatar (or the author's initial); bass at the bottom, treble at the top | `spectrum`, loudness |
| `wave` | The actual samples of the audio around the current moment, one thin line per column; played half bright, upcoming half dim | `pcm` |
| `bars` | Loudness bars sliding past a centre playhead | loudness |

## Adding a style

1. Write `draw(ctx, scene, t)` in `styles.js`. It draws inside `scene.area` (`cx`, `cy`, `width`, `height`), which sits
   between the title and the subtitles for both portrait and landscape, and must be a pure function of `t` (frames can
   be rendered in any order). Helpers: `levelAt(scene, t)` for loudness, `bandsAt(scene, t)` for the 48 bands,
   `ramp(k)` for the shared colour family, `scene.avatar` for the author's picture, `scene.features.pcm` and
   `scene.features.peak` for raw samples.
2. Register it in `VISUAL_STYLES` with the features it reads in `needs`: `'pcm'`, `'spectrum'`, or `[]` for loudness only.
   Features not listed are not computed, so a cheap style never pays for an FFT. A new kind of feature goes into
   `analyse()` in [`analysis.js`](../src/core/share/analysis.js).
3. Add its label as `share.visual.<id>` in [`strings.js`](../src/strings.js) (Chinese and English).

`tests/share-styles.test.mjs` draws every registered style in both shapes against a recording canvas, so a new style is
checked automatically. Try it for real from the share dialog: the three preview frames use the same drawing code.
