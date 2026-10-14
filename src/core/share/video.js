// Encodes the share video in the browser: Canvas frames → H.264, speech → AAC, muxed to an MP4 that opens
// in WeChat, Douyin, Xiaohongshu and Bilibili. Frames are rendered as fast as the encoder takes them, not in real time.
/* global VideoEncoder, AudioEncoder, AudioData, VideoFrame -- WebCodecs ship with the desktop Chromium; availability is checked at run time */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { FPS, drawCover, drawFrame } from './scene.js';
import { defer as tick } from './defer.js';

const aborted = signal => { if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'aborted' }); };
const fail = code => Object.assign(new Error(code), { code });

export function makeCanvas(width, height, doc) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = (doc || window.document).createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
export const videoSupported = () => typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function' && typeof VideoFrame === 'function' && typeof AudioData === 'function';

const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a'];
async function pickVideoCodec(width, height, bitrate) {
  for (const codec of AVC) {
    try { const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: FPS, avc: { format: 'avc' } }); if (supported) return codec; } catch { /* Try the next profile. */ }
  }
  throw fail('videoUnsupported');
}

export async function renderVideo({ scene, pcm, rate, signal, onProgress, doc }) {
  if (!videoSupported()) throw fail('videoUnsupported');
  const { width, height } = scene, bitrate = Math.round(width * height * FPS * 0.026), audioBitrate = 96000;
  const codec = await pickVideoCodec(width, height, bitrate);
  const audioConfig = { codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: 1, bitrate: audioBitrate };
  try { if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) throw fail('videoUnsupported'); } catch (error) { throw error.code ? error : fail('videoUnsupported'); }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: FPS }, audio: { codec: 'aac', numberOfChannels: 1, sampleRate: rate }, fastStart: 'in-memory' });
  let failure = null;
  const video = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: error => { failure = error; } });
  const audio = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: error => { failure = error; } });
  video.configure({ codec, width, height, bitrate, bitrateMode: 'variable', framerate: FPS, avc: { format: 'avc' } });
  audio.configure(audioConfig);
  const canvas = makeCanvas(width, height, doc), ctx = canvas.getContext('2d');
  const check = () => { aborted(signal); if (failure) throw failure; };
  try {
    // Audio first: the cover and end card are silent, the speech starts when the cover ends.
    const lead = Math.round(scene.intro * rate), total = Math.ceil(scene.total * rate), block = 4096;
    for (let at = 0; at < total; at += block) {
      const frames = Math.min(block, total - at), data = new Float32Array(frames);
      const from = Math.max(0, at - lead), to = Math.min(pcm.length, at + frames - lead);
      if (to > from) data.set(pcm.subarray(from, to), Math.max(0, lead - at));
      const chunk = new AudioData({ format: 'f32', sampleRate: rate, numberOfFrames: frames, numberOfChannels: 1, timestamp: Math.round(at * 1e6 / rate), data });
      audio.encode(chunk); chunk.close();
      while (audio.encodeQueueSize > 12) { check(); await tick(); }
    }
    const count = Math.ceil(scene.total * FPS);
    for (let i = 0; i < count; i++) {
      check();
      drawFrame(ctx, scene, i / FPS);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      video.encode(frame, { keyFrame: i % (FPS * 2) === 0 }); frame.close();
      while (video.encodeQueueSize > 6) { check(); await tick(); }
      if (i % 12 === 11) { onProgress?.(i / count); await tick(); }
    }
    await video.flush(); await audio.flush(); check();
    muxer.finalize();
  } finally { for (const codecObject of [video, audio]) try { if (codecObject.state !== 'closed') codecObject.close(); } catch { /* Already closed. */ } }
  onProgress?.(1);
  return new Uint8Array(target.buffer);
}

// The cover as a still image, for posting on its own.
export async function renderCoverImage(scene, doc) {
  const canvas = makeCanvas(scene.width, scene.height, doc), ctx = canvas.getContext('2d');
  drawCover(ctx, scene, 1);
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
