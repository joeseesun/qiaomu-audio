import { MarkdownView } from 'obsidian';
import { TARGET_RATE, resample } from './core/asr/audio.js';

// For other plugins: app.plugins.plugins['qiaomu-audio']?.api. Look it up at call time; it is absent when disabled.
export function createApi(plugin) {
  const activeView = () => plugin.app.workspace.getActiveViewOfType(MarkdownView);
  async function toSamples(audio, sampleRate) {
    if (audio instanceof Float32Array) return resample(audio, sampleRate || TARGET_RATE, TARGET_RATE);
    const buffer = audio instanceof ArrayBuffer ? audio : ArrayBuffer.isView(audio) ? audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) : await audio.arrayBuffer();
    const Context = window.AudioContext || window.webkitAudioContext, context = new Context();
    try {
      const decoded = await context.decodeAudioData(buffer);
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) { const data = decoded.getChannelData(c); for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels; }
      return resample(mono, decoded.sampleRate, TARGET_RATE);
    } finally { void context.close(); }
  }
  return Object.freeze({
    version: 1,
    // Reads plain text with the voice chosen in settings. Resolves when finished or stopped.
    speak(text) {
      const speech = plugin.speech, controller = speech.controller, owner = { clearHighlight() {} };
      const problem = speech.configurationError();
      if (problem) return Promise.reject(problem);
      plugin.reading.stop();
      return new Promise((resolve, reject) => {
        const unsubscribe = speech.subscribe(c => {
          if (c.owner !== owner) { unsubscribe(); resolve(); }
          else if (c.state === 'ended') { unsubscribe(); controller.stop(owner); resolve(); }
          else if (c.state === 'error') { const error = c.error; unsubscribe(); controller.stop(owner); reject(error); }
        });
        controller.makeAudio = () => new window.Audio();
        if (!speech.speak(owner, String(text || ''))) { unsubscribe(); resolve(); }
      });
    },
    stop() { plugin.reading.stop(); plugin.speech.controller.stop(); },
    isReading: () => plugin.reading.isPlaying(),
    readNote: (view = activeView()) => plugin.reading.start(view, 'start'),
    // Audio (Blob, ArrayBuffer, encoded bytes, or Float32Array samples with `sampleRate`) → text, using the chosen recognition method.
    async transcribe(audio, { sampleRate, signal } = {}) {
      return plugin.transcription.transcribe(await toSamples(audio, sampleRate), { signal });
    },
    startDictation: (view = activeView()) => plugin.dictation.start(view),
    isDictating: () => plugin.dictation.isActive(),
  });
}
