// Pure audio helpers for dictation: no ffmpeg, no Obsidian. Recognisers all accept 16 kHz mono 16-bit WAV.
export const TARGET_RATE = 16000;
const FRAME_SECONDS = 0.02;

// Box-filtered decimation / linear interpolation is enough for speech recognition.
export function resample(samples, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate, length = Math.max(0, Math.floor(samples.length / ratio)), out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio), end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0; for (let j = start; j < end; j++) sum += samples[j];
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < length; i++) {
      const position = i * ratio, left = Math.floor(position), right = Math.min(samples.length - 1, left + 1), frac = position - left;
      out[i] = samples[left] * (1 - frac) + samples[right] * frac;
    }
  }
  return out;
}
export function concatSamples(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0), out = new Float32Array(total);
  let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}
export function encodeWav(samples, rate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
export function rmsDb(samples, start = 0, end = samples.length) {
  let sum = 0; for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}
export function frameLevels(samples, rate = TARGET_RATE) {
  const size = Math.max(1, Math.round(rate * FRAME_SECONDS)), levels = [];
  for (let i = 0; i < samples.length; i += size) levels.push(rmsDb(samples, i, Math.min(samples.length, i + size)));
  return levels;
}
// "Quiet" relative to this recording: mean level minus 13 dB, kept in a sane range (as Clipper does with ffmpeg).
export function silenceThreshold(levels) {
  const voiced = levels.filter(x => x > -90);
  if (!voiced.length) return -40;
  const mean = 10 * Math.log10(voiced.reduce((n, db) => n + 10 ** (db / 10), 0) / voiced.length);
  return Math.max(-50, Math.min(-22, mean - 13));
}
// Midpoints (seconds) of pauses at least `minSeconds` long.
export function pauseMidpoints(samples, rate = TARGET_RATE, minSeconds = 0.15) {
  const levels = frameLevels(samples, rate), threshold = silenceThreshold(levels), mids = [];
  let start = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] < threshold;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if ((i - start) * FRAME_SECONDS >= minSeconds) mids.push(((start + i) / 2) * FRAME_SECONDS);
      start = -1;
    }
  }
  return mids;
}
// Pieces of about `target` seconds, cut in the middle of a pause, never longer than `maximum`.
export function planChunks(mids, total, target = 20, maximum = 40, minimum = 4) {
  const chunks = []; let start = 0;
  target = Math.min(target, maximum - minimum);
  while (total - start > maximum) {
    const candidates = mids.filter(m => m >= start + minimum && m <= start + maximum);
    const cut = candidates.length ? candidates.reduce((a, b) => Math.abs(b - (start + target)) < Math.abs(a - (start + target)) ? b : a) : start + maximum;
    chunks.push([start, cut]); start = cut;
  }
  if (total - start >= 0.3 || !chunks.length) chunks.push([start, total]);
  return chunks;
}
export function splitForRecognition(samples, rate, target, maximum) {
  const total = samples.length / rate;
  return planChunks(total > maximum ? pauseMidpoints(samples, rate) : [], total, target, maximum)
    .map(([a, b]) => samples.subarray(Math.floor(a * rate), Math.min(samples.length, Math.ceil(b * rate))));
}
export function hasSpeech(samples, rate = TARGET_RATE) {
  const levels = frameLevels(samples, rate);
  return levels.filter(db => db > -45).length * FRAME_SECONDS >= 0.25;
}
// Joins recognised pieces: CJK text needs no space, Latin words do.
export function joinTranscript(parts) {
  return parts.filter(Boolean).reduce((all, part) => {
    if (!all) return part;
    return /[A-Za-z0-9,.;:!?]$/.test(all) && /^[A-Za-z0-9]/.test(part) ? `${all} ${part}` : all + part;
  }, '');
}

// Live dictation: cut a phrase after a pause so it can be recognised while the speaker continues.
// Feed 16 kHz frames; `onPhrase(samples)` receives each finished phrase.
export class PhraseSegmenter {
  constructor({ onPhrase, rate = TARGET_RATE, pauseSeconds = 0.7, minSeconds = 1, maxSeconds = 25 }) {
    Object.assign(this, { onPhrase, rate, pauseSeconds, minSeconds, maxSeconds });
    this.chunks = []; this.length = 0; this.quiet = 0; this.voiced = 0; this.floor = -60;
  }
  push(samples) {
    const db = rmsDb(samples);
    // Track the room's noise floor slowly upward, quickly downward.
    this.floor = db < this.floor ? db : this.floor + (db - this.floor) * 0.02;
    const speaking = db > Math.max(-48, this.floor + 10);
    const seconds = samples.length / this.rate;
    this.chunks.push(samples); this.length += samples.length;
    if (speaking) { this.voiced += seconds; this.quiet = 0; } else this.quiet += seconds;
    const duration = this.length / this.rate;
    if ((this.voiced >= 0.25 && this.quiet >= this.pauseSeconds && duration >= this.minSeconds) || duration >= this.maxSeconds) this.flush();
    else if (!this.voiced && duration > 2) { this.chunks = [samples]; this.length = samples.length; }
    return speaking;
  }
  flush() {
    const phrase = concatSamples(this.chunks), voiced = this.voiced;
    this.chunks = []; this.length = 0; this.quiet = 0; this.voiced = 0;
    if (voiced >= 0.25 && phrase.length) this.onPhrase(phrase);
  }
}
