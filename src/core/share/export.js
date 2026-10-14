// Turns chosen sentences into shareable files: speech → one track → speed → MP3 / SRT / cover / MP4.
// Browser-only pieces (decoding, canvas, encoders) are injected through `deps`, so the flow is testable.
import { SAMPLE_RATE, encodeMp3, srt, timeStretch, trimSilence } from './audio.js';
import { analyse } from './analysis.js';
import { styleNeeds } from './styles.js';
import { assemble, retime, subtitleCues } from './timeline.js';
import { FPS, buildScene } from './scene.js';
import { renderCoverImage, renderVideo } from './video.js';

const aborted = signal => { if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'aborted' }); };
const encoder = new TextEncoder();

// Turns a title into something safe to use as a file name.
export function fileBase(title, fallback = 'qiaomu-audio') {
  const cleaned = String(title || '').replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return cleaned || fallback;
}

// job: { items, speed, title, artist, baseName, caption, outputs: { mp3, srt, cover, videos: ['portrait', 'landscape'] },
//        cover: { image }|null, outro: {...}|null, signal, onProgress({ phase, fraction }) }
// deps: { synthesize(item, signal) → { bytes, mime, marks? }, decode(bytes) → { pcm, rate }, makeContext(w, h) → 2D context,
//         renderVideo, renderCoverImage, concurrency }
export async function runExport(job, deps) {
  const { items, signal, onProgress = () => {} } = job, speed = job.speed || 1, outputs = job.outputs || {};
  const parts = new Array(items.length);
  let done = 0, next = 0;
  const worker = async () => {
    while (next < items.length) {
      aborted(signal);
      const index = next++, item = items[index], result = await deps.synthesize(item, signal);
      aborted(signal);
      const decoded = await deps.decode(result.bytes);
      if (decoded.rate !== SAMPLE_RATE) throw Object.assign(new Error('rate'), { code: 'response' });
      const { pcm, offset } = trimSilence(decoded.pcm, decoded.rate);
      if (!pcm.length) throw Object.assign(new Error('empty'), { code: 'response' });
      parts[index] = { item, pcm, trimmed: offset, marks: result.marks };
      onProgress({ phase: 'voice', fraction: ++done / items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.concurrency || 3, items.length)) }, worker));

  let { pcm, cues } = assemble(parts, SAMPLE_RATE);
  if (Math.abs(speed - 1) >= 0.005) {
    onProgress({ phase: 'speed', fraction: 0 });
    const stretched = await timeStretch(pcm, SAMPLE_RATE, speed, { signal, onProgress: fraction => onProgress({ phase: 'speed', fraction }) });
    cues = retime(cues, stretched.length / pcm.length); pcm = stretched;
  }
  const duration = pcm.length / SAMPLE_RATE, base = job.baseName || fileBase(job.title), files = [];
  const meta = { title: job.title || base, artist: job.artist || '', album: 'Qiaomu Audio' };

  if (outputs.mp3) {
    const bytes = await encodeMp3(pcm, SAMPLE_RATE, { meta, signal, onProgress: fraction => onProgress({ phase: 'audio', fraction }) });
    files.push({ kind: 'audio', name: `${base}.mp3`, mime: 'audio/mpeg', bytes });
  }
  if (outputs.srt) files.push({ kind: 'subtitle', name: `${base}.srt`, mime: 'application/x-subrip', bytes: encoder.encode(srt(subtitleCues(cues))) });

  const orientations = outputs.videos || [], features = outputs.videos?.length || outputs.cover ? analyse(pcm, SAMPLE_RATE, styleNeeds(job.visual), FPS) : null;
  const sceneFor = orientation => {
    const size = orientation === 'landscape' ? [1920, 1080] : [1080, 1920];
    return buildScene({ orientation, title: job.title || base, caption: job.caption || '', byline: job.outro?.name || job.artist || '', cues, features, visual: job.visual, avatar: job.avatar, duration,
      cover: job.cover || null, outro: job.outro || null }, deps.makeContext(...size));
  };
  for (let i = 0; i < orientations.length; i++) {
    aborted(signal);
    const orientation = orientations[i], scene = sceneFor(orientation);
    const bytes = await (deps.renderVideo || renderVideo)({ scene, pcm, rate: SAMPLE_RATE, signal, doc: deps.doc,
      onProgress: fraction => onProgress({ phase: 'video', fraction: (i + fraction) / orientations.length }) });
    files.push({ kind: 'video', name: `${base}-${orientation}.mp4`, mime: 'video/mp4', bytes, orientation });
  }
  if (outputs.cover) {
    const scene = sceneFor(orientations[0] || 'portrait');
    files.push({ kind: 'image', name: `${base}-cover.png`, mime: 'image/png', bytes: await (deps.renderCoverImage || renderCoverImage)(scene, deps.doc) });
  }
  return { files, duration, cues };
}
