// Audio helpers for exporting speech. Samples are mono Float32Array in [-1, 1]; no DOM or Obsidian imports.
import { Mp3Encoder } from '@breezystack/lamejs';
import { defer as tick } from './defer.js';

export const SAMPLE_RATE = 44100;
const aborted = signal => { if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'aborted' }); };

// Cut leading and trailing silence, keeping a short pad. Returns the cut audio and where it started (seconds).
export function trimSilence(pcm, rate, { threshold = 0.012, pad = 0.04 } = {}) {
  let first = -1, last = -1;
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]) > threshold) { if (first < 0) first = i; last = i; }
  if (first < 0) return { pcm: pcm.subarray(0, 0), offset: 0 };
  const from = Math.max(0, first - Math.round(pad * rate)), to = Math.min(pcm.length, last + 1 + Math.round(pad * rate));
  return { pcm: pcm.subarray(from, to), offset: from / rate };
}

// Pitch-preserving speed change (WSOLA): overlap-adds ~30 ms Hann-windowed frames taken `speed` times faster,
// nudging each frame to where it best continues the previous one so voices do not warble.
export async function timeStretch(input, rate, speed, { signal, onProgress } = {}) {
  if (!(speed > 0) || Math.abs(speed - 1) < 0.005 || input.length < 2048) return input;
  const win = 2 * Math.round(rate * 0.015), hop = win / 2, tolerance = Math.round(rate * 0.012), stride = 4;
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);
  const length = Math.ceil(input.length / speed) + win, out = new Float32Array(length), norm = new Float32Array(length);
  let previous = 0;
  for (let frame = 0; ; frame++) {
    const outAt = frame * hop, ideal = Math.round(frame * hop * speed);
    if (outAt + win > length || ideal >= input.length) break;
    let best = Math.min(ideal, Math.max(0, input.length - win));
    if (frame > 0) {
      // The audio that naturally follows the previous frame is what the new frame must line up with.
      const target = previous + hop, lo = Math.max(0, ideal - tolerance), hi = Math.min(input.length - win, ideal + tolerance);
      if (target + hop <= input.length && hi >= lo) {
        let top = -Infinity;
        for (let c = lo; c <= hi; c += 2) {
          let sum = 0;
          for (let i = 0; i < hop; i += stride) sum += input[c + i] * input[target + i];
          if (sum > top) { top = sum; best = c; }
        }
      }
    }
    for (let i = 0; i < win; i++) { const at = best + i; if (at < input.length) { out[outAt + i] += input[at] * hann[i]; norm[outAt + i] += hann[i]; } }
    previous = best;
    if (frame % 400 === 399) { aborted(signal); onProgress?.(Math.min(1, ideal / input.length)); await tick(); }
  }
  const total = Math.min(length, Math.round(input.length / speed));
  const result = new Float32Array(total);
  for (let i = 0; i < total; i++) result[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  onProgress?.(1);
  return result;
}

// Loudness per video frame (0..1) used to animate the waveform; scaled so ordinary speech fills the range.
export function envelope(pcm, rate, fps = 30) {
  const step = Math.max(1, Math.round(rate / fps)), count = Math.ceil(pcm.length / step), values = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    let sum = 0; const from = k * step, to = Math.min(pcm.length, from + step);
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    values[k] = Math.sqrt(sum / Math.max(1, to - from));
  }
  const sorted = Array.from(values).filter(v => v > 0.002).sort((a, b) => a - b);
  const scale = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] || sorted.at(-1) : 1;
  let smooth = 0;
  for (let k = 0; k < count; k++) {
    const level = Math.min(1, values[k] / (scale || 1));
    smooth = level > smooth ? smooth + (level - smooth) * 0.6 : smooth + (level - smooth) * 0.25;
    values[k] = smooth;
  }
  return values;
}

const text = value => new TextEncoder().encode(value);
function frame(id, body) {
  const out = new Uint8Array(10 + body.length), size = body.length;
  out.set(text(id)); out[4] = (size >>> 24) & 255; out[5] = (size >>> 16) & 255; out[6] = (size >>> 8) & 255; out[7] = size & 255;
  out.set(body, 10); return out;
}
// ID3v2.3 tag with title, artist and an optional cover picture, so podcast apps show something meaningful.
export function id3Tag({ title = '', artist = '', album = '', cover = null } = {}) {
  const frames = [];
  const utf16 = value => { const out = new Uint8Array(3 + value.length * 2); out[0] = 1; out[1] = 255; out[2] = 254; for (let i = 0; i < value.length; i++) { out[3 + i * 2] = value.charCodeAt(i) & 255; out[4 + i * 2] = value.charCodeAt(i) >> 8; } return out; };
  for (const [id, value] of [['TIT2', title], ['TPE1', artist], ['TALB', album]]) if (value) frames.push(frame(id, utf16(value)));
  if (cover?.bytes?.length) {
    const head = [0, ...text(cover.mime || 'image/png'), 0, 3, 0], body = new Uint8Array(head.length + cover.bytes.length);
    body.set(head); body.set(cover.bytes, head.length); frames.push(frame('APIC', body));
  }
  const size = frames.reduce((sum, f) => sum + f.length, 0), out = new Uint8Array(10 + size);
  out.set(text('ID3')); out[3] = 3;
  out[6] = (size >>> 21) & 127; out[7] = (size >>> 14) & 127; out[8] = (size >>> 7) & 127; out[9] = size & 127;
  let at = 10; for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
}

// Mono MP3 at 96 kbit/s, which is transparent for speech and keeps files small enough to message.
export async function encodeMp3(pcm, rate, { bitrate = 96, signal, onProgress, meta } = {}) {
  const encoder = new Mp3Encoder(1, rate, bitrate), block = 1152 * 20, chunks = [];
  const tag = meta ? id3Tag(meta) : null; if (tag) chunks.push(tag);
  const int = new Int16Array(block);
  for (let at = 0; at < pcm.length; at += block) {
    const end = Math.min(pcm.length, at + block), view = end - at === block ? int : new Int16Array(end - at);
    for (let i = at; i < end; i++) view[i - at] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    const data = encoder.encodeBuffer(view); if (data.length) chunks.push(new Uint8Array(data));
    if ((at / block) % 40 === 39) { aborted(signal); onProgress?.(at / pcm.length); await tick(); }
  }
  const tail = encoder.flush(); if (tail.length) chunks.push(new Uint8Array(tail));
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0)); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  onProgress?.(1);
  return out;
}

const stamp = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000)), pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
// SubRip subtitles: one cue per spoken sentence.
export function srt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.from)} --> ${stamp(cue.to)}\n${cue.text}\n`).join('\n');
}
