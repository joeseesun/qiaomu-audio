import { TARGET_RATE, concatSamples, resample, rmsDb } from '../core/asr/audio.js';

const WORKLET = `class QiaomuCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.size = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) for (let i = 0; i < channel.length; i++) {
      this.buffer[this.size++] = channel[i];
      if (this.size === this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.size = 0; }
    }
    return true;
  }
}
registerProcessor('qiaomu-capture', QiaomuCapture);`;
export const MAX_SECONDS = 60 * 60;

export function micError(error) {
  const name = error?.name || '';
  const code = name === 'NotAllowedError' || name === 'SecurityError' ? 'micDenied'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'micMissing'
      : name === 'NotReadableError' || name === 'AbortError' ? 'micBusy' : 'micUnsupported';
  return Object.assign(new Error(code), { code });
}

// Captures microphone audio as 16 kHz mono samples. Optionally records a compressed copy for keeping.
export class Recorder {
  constructor({ win = window, onFrame, onLevel, keepAudio = false }) {
    Object.assign(this, { win, onFrame, onLevel, keepAudio });
    this.blocks = []; this.length = 0; this.pending = []; this.pendingLength = 0; this.media = []; this.stopped = false;
  }
  get seconds() { return this.length / TARGET_RATE; }
  async start() {
    const devices = this.win.navigator?.mediaDevices;
    if (!devices?.getUserMedia) throw micError();
    try {
      this.stream = await devices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) { throw micError(error); }
    const Context = this.win.AudioContext || this.win.webkitAudioContext;
    if (!Context) { this.release(); throw micError(); }
    this.context = new Context();
    await this.context.resume?.();
    this.rate = this.context.sampleRate;
    this.source = this.context.createMediaStreamSource(this.stream);
    this.sink = this.context.createGain(); this.sink.gain.value = 0; this.sink.connect(this.context.destination);
    try {
      if (!this.context.audioWorklet) throw new Error('worklet');
      const url = this.win.URL.createObjectURL(new this.win.Blob([WORKLET], { type: 'text/javascript' }));
      try { await this.context.audioWorklet.addModule(url); } finally { this.win.URL.revokeObjectURL(url); }
      this.node = new this.win.AudioWorkletNode(this.context, 'qiaomu-capture');
      this.node.port.onmessage = event => this.accept(event.data);
    } catch {
      // Older WebViews: the deprecated ScriptProcessor still captures reliably.
      this.node = this.context.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = event => this.accept(new Float32Array(event.inputBuffer.getChannelData(0)));
    }
    this.source.connect(this.node); this.node.connect(this.sink);
    if (this.keepAudio && this.win.MediaRecorder) {
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(x => this.win.MediaRecorder.isTypeSupported?.(x));
      try {
        this.mediaRecorder = new this.win.MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
        this.mediaRecorder.ondataavailable = event => { if (event.data?.size) this.media.push(event.data); };
        this.mediaRecorder.start(1000);
      } catch { this.mediaRecorder = null; }
    }
  }
  accept(raw) {
    if (this.stopped) return;
    this.onLevel?.(rmsDb(raw));
    this.pending.push(raw); this.pendingLength += raw.length;
    // Resample in ~0.1 s blocks: small enough for live phrases, large enough to avoid edge artefacts.
    if (this.pendingLength >= this.rate / 10) this.drain();
  }
  drain() {
    if (!this.pendingLength) return;
    const block = resample(concatSamples(this.pending), this.rate, TARGET_RATE);
    this.pending = []; this.pendingLength = 0;
    this.blocks.push(block); this.length += block.length;
    this.onFrame?.(block);
  }
  samples() { return concatSamples(this.blocks); }
  async stop() {
    if (this.stopped) return; this.stopped = true;
    this.drain();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise(resolve => { this.mediaRecorder.onstop = resolve; this.mediaRecorder.stop(); });
    }
    this.release();
  }
  audioBlob() {
    if (!this.media.length) return null;
    return new this.win.Blob(this.media, { type: this.mediaRecorder?.mimeType || this.media[0].type || 'audio/webm' });
  }
  release() {
    try { this.source?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch { /* Already disconnected. */ }
    if (this.node?.port) this.node.port.onmessage = null;
    for (const track of this.stream?.getTracks?.() || []) track.stop();
    void this.context?.close?.().catch(() => {});
    this.stream = null; this.context = null;
  }
}
