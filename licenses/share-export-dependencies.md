# Third-party code used by Export and share

Both packages are bundled into `main.js` by esbuild from the npm registry at the versions pinned in `package-lock.json`.
This plugin is GPL-3.0-only, which is compatible with both licences below.

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| `@breezystack/lamejs` — a maintained ES-module build of lamejs, the JavaScript port of the LAME MP3 encoder (https://lame.sourceforge.io/) | 1.2.7 | LGPL-3.0 | Encoding the exported speech as MP3 |
| `mp4-muxer` by Vanilagy (https://github.com/Vanilagy/mp4-muxer) | 5.2.2 | MIT | Packaging the WebCodecs H.264 video and AAC audio into an MP4 file |

LGPL notice: the encoder is not modified. Its full source is available from the package pages above, and you can rebuild
`main.js` with a different version of it by changing `package.json` and running `npm run build`.
