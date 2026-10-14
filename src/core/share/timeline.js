// Joins spoken sentences into one track with word timings. Pure: no DOM or Obsidian imports.
import { estimateMarks } from '../tts/timing.js';

const SENTENCE_END = /[。！？.!?…”"」』）)]\s*$/u;
// Breath between sentences; headings and unfinished clauses get a longer beat.
export const gapAfter = item => (SENTENCE_END.test(item.text) ? 0.22 : 0.55);

// parts: [{ item, pcm, trimmed, marks? }] where `trimmed` is the seconds cut from the start of the provider
// audio (provider word times are measured before the cut). Missing marks are estimated over the audio.
export function assemble(parts, rate) {
  const gaps = parts.map((part, i) => (i < parts.length - 1 ? Math.round(gapAfter(part.item) * rate) : 0));
  const total = parts.reduce((sum, part, i) => sum + part.pcm.length + gaps[i], 0), pcm = new Float32Array(total), cues = [];
  let at = 0;
  parts.forEach((part, i) => {
    const from = at / rate, duration = part.pcm.length / rate;
    pcm.set(part.pcm, at);
    let marks;
    if (part.marks?.length) {
      marks = part.marks.map(m => ({ s: m.s, e: m.e, from: from + Math.max(0, m.from - (part.trimmed || 0)), to: from + Math.min(duration, Math.max(0, m.to - (part.trimmed || 0))) }));
    } else marks = estimateMarks(part.item.text, Math.max(0.1, duration), from);
    cues.push({ item: part.item, from, to: from + duration, marks });
    at += part.pcm.length + gaps[i];
  });
  return { pcm, cues, duration: total / rate };
}

// Re-time cues after the audio was stretched by a different amount than the nominal speed.
export function retime(cues, factor) {
  return cues.map(cue => ({ ...cue, from: cue.from * factor, to: cue.to * factor, marks: cue.marks.map(m => ({ ...m, from: m.from * factor, to: m.to * factor })) }));
}
export const subtitleCues = cues => cues.map(cue => ({ from: cue.from, to: cue.to, text: cue.item.text }));
