// What the visual styles read from the exported audio, computed once per export from the same samples that
// are encoded. Styles say what they need (see styles.js), so cheap styles do not pay for an FFT.
import { envelope } from './audio.js';
import { FPS } from './draw.js';

// In-place radix-2 FFT; re/im lengths must be a power of two.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle), half = len >> 1;
    for (let start = 0; start < n; start += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}

// Log-spaced frequency bands (speech lives between ~80 Hz and ~7.5 kHz) for every video frame, as 0..1 levels.
// Each band is scaled by its own loudness over the whole clip so high bands move as much as low ones, then
// gated by the overall level so pauses stay quiet.
export function spectrum(pcm, rate, fps = FPS, { bands = 48, size = 2048, low = 80, high = 7500 } = {}, levels = envelope(pcm, rate, fps)) {
  const frames = Math.ceil(pcm.length / rate * fps), data = new Float32Array(frames * bands);
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const hz = rate / size, edges = Array.from({ length: bands + 1 }, (_, i) => low * (high / low) ** (i / bands));
  const ranges = Array.from({ length: bands }, (_, i) => { const from = Math.max(1, Math.floor(edges[i] / hz)); return [from, Math.max(from + 1, Math.ceil(edges[i + 1] / hz))]; });
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.round(frame * rate / fps) - size / 2;
    for (let i = 0; i < size; i++) { const at = start + i; re[i] = at >= 0 && at < pcm.length ? pcm[at] * window[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < bands; b++) {
      const [from, to] = ranges[b]; let sum = 0;
      for (let k = from; k < to; k++) sum += re[k] * re[k] + im[k] * im[k];
      data[frame * bands + b] = Math.sqrt(sum / (to - from));
    }
  }
  for (let b = 0; b < bands; b++) {
    const column = [];
    for (let frame = 0; frame < frames; frame++) column.push(data[frame * bands + b]);
    column.sort((x, y) => x - y);
    const scale = Math.max(column[Math.floor(column.length * 0.95)] || 0, column.at(-1) * 0.2, 1e-6);
    let smooth = 0;
    for (let frame = 0; frame < frames; frame++) {
      const at = frame * bands + b, gate = Math.min(1, (levels[Math.min(frame, levels.length - 1)] || 0) / 0.12);
      const level = Math.min(1, (data[at] / scale) ** 0.8) * gate;
      smooth = level > smooth ? smooth + (level - smooth) * 0.7 : smooth + (level - smooth) * 0.3;
      data[at] = smooth;
    }
  }
  return { bands, spectrum: data };
}

// Loud-but-not-clipped reference amplitude, so a drawn waveform fills its band without spikes dominating.
export function peakLevel(pcm) {
  const stride = Math.max(1, Math.floor(pcm.length / 20000)), sample = [];
  for (let i = 0; i < pcm.length; i += stride) sample.push(Math.abs(pcm[i]));
  sample.sort((a, b) => a - b);
  return Math.max(0.05, sample[Math.floor(sample.length * 0.98)] || 0);
}

export function analyse(pcm, rate, needs = [], fps = FPS) {
  const features = { envelope: envelope(pcm, rate, fps), rate };
  if (needs.includes('pcm')) { features.pcm = pcm; features.peak = peakLevel(pcm); }
  if (needs.includes('spectrum')) Object.assign(features, spectrum(pcm, rate, fps, {}, features.envelope));
  return features;
}
