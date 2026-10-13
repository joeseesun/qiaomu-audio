import test from 'node:test';
import assert from 'node:assert/strict';
import { ASR_PROVIDERS, asrBaseUrl, cleanProfile, cloudConfig, newProfile, providerOf, withProvider } from '../src/core/asr/providers.js';
import { buildAsrRequest, multipart, parseAsrResponse, recognizeCloud, tidyTranscript } from '../src/core/asr/request.js';
import { PhraseSegmenter, TARGET_RATE, encodeWav, hasSpeech, joinTranscript, pauseMidpoints, planChunks, resample, splitForRecognition } from '../src/core/asr/audio.js';
import { defaultSettings, normalizeSettings, asrSecretId, ttsSecretId } from '../src/settings.js';

globalThis.window = globalThis;
const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const decode = body => new TextDecoder().decode(new Uint8Array(body));

test('every provider maps to a known protocol and has a usable default', () => {
  for (const p of ASR_PROVIDERS) {
    assert.ok(['openai-transcriptions', 'chat-audio', 'doubao-flash'].includes(p.protocol), p.id);
    if (p.id !== 'custom') assert.doesNotThrow(() => cloudConfig(newProfile(p.id)), p.id);
  }
  assert.equal(providerOf('nope').id, 'custom');
});
test('remote services require https; loopback http is allowed and needs no key', () => {
  assert.throws(() => asrBaseUrl('http://example.com/v1'), { code: 'https' });
  assert.throws(() => asrBaseUrl('https://user:pw@example.com'), { code: 'url' });
  assert.equal(asrBaseUrl('http://127.0.0.1:8765/v1/audio/transcriptions'), 'http://127.0.0.1:8765/v1');
  const cfg = cloudConfig(newProfile('local'));
  assert.equal(cfg.local, true);
  assert.equal(buildAsrRequest(cfg, '', wav).headers.Authorization, undefined);
  assert.throws(() => buildAsrRequest(cloudConfig(newProfile('siliconflow')), '', wav), { code: 'key' });
});
test('OpenAI-style upload is multipart with model, format and the WAV bytes', () => {
  const cfg = cloudConfig(newProfile('openai'));
  const request = buildAsrRequest(cfg, 'sk-test', wav, 'zh');
  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(request.headers.Authorization, 'Bearer sk-test');
  assert.match(request.contentType, /^multipart\/form-data; boundary=/);
  const body = decode(request.body);
  assert.match(body, /name="model"\r\n\r\ngpt-4o-mini-transcribe/);
  assert.match(body, /name="response_format"\r\n\r\njson/);
  assert.match(body, /name="language"\r\n\r\nzh/);
  assert.match(body, /filename="speech.wav"\r\nContent-Type: audio\/wav/);
  // SiliconFlow does not take a language field.
  assert.doesNotMatch(decode(buildAsrRequest(cloudConfig(newProfile('siliconflow')), 'k', wav, 'zh').body), /name="language"/);
});
test('multipart keeps binary bytes intact', () => {
  const bytes = new Uint8Array([0, 255, 13, 10, 45]);
  const { body } = multipart([], 'a.wav', bytes, 'audio/wav', 'B');
  const all = new Uint8Array(body), head = new TextEncoder().encode('--B\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n').length;
  assert.deepEqual([...all.slice(head, head + 5)], [0, 255, 13, 10, 45]);
});
test('chat-audio and Doubao flash send base64 audio with their own headers', () => {
  const mimo = buildAsrRequest(cloudConfig(newProfile('mimo')), 'k', wav, 'ja');
  const payload = JSON.parse(mimo.body);
  assert.equal(mimo.url, 'https://api.xiaomimimo.com/v1/chat/completions');
  assert.equal(payload.messages[0].content[0].input_audio.data, 'data:audio/wav;base64,UklGRgECAwQ=');
  assert.equal(payload.asr_options.language, 'auto');
  const doubao = buildAsrRequest(cloudConfig(newProfile('doubao')), 'uuid-key', wav, 'zh', () => 'req-1');
  assert.equal(doubao.url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash');
  assert.equal(doubao.headers['X-Api-Key'], 'uuid-key');
  assert.equal(doubao.headers['X-Api-Resource-Id'], 'volc.bigasr.auc_turbo');
  assert.equal(doubao.headers['X-Api-Request-Id'], 'req-1');
  assert.equal(JSON.parse(doubao.body).audio.data, 'UklGRgECAwQ=');
});
test('responses parse per protocol; Doubao status headers decide success', () => {
  const openai = cloudConfig(newProfile('openai')), mimo = cloudConfig(newProfile('mimo')), doubao = cloudConfig(newProfile('doubao'));
  assert.equal(parseAsrResponse(openai, { text: '{"text":" 你好 <|zh|>世界😀 "}' }), '你好 世界');
  assert.equal(parseAsrResponse(mimo, { json: { choices: [{ message: { content: 'hello' } }] } }), 'hello');
  assert.equal(parseAsrResponse(doubao, { headers: { 'x-api-status-code': '20000000' }, json: { result: { text: '好的。' } } }), '好的。');
  assert.equal(parseAsrResponse(doubao, { headers: { 'X-Api-Status-Code': '20000003' }, text: '' }), '');
  assert.throws(() => parseAsrResponse(doubao, { headers: { 'X-Api-Status-Code': '45000010', 'X-Api-Message': 'insufficient balance' }, text: '{}' }), { code: 'quota' });
  assert.throws(() => parseAsrResponse(doubao, { headers: { 'X-Api-Status-Code': '45000011', 'X-Api-Message': 'bad key' }, text: '{}' }), { code: 'auth' });
  assert.throws(() => parseAsrResponse(openai, { text: '<html>' }), { code: 'response' });
  assert.equal(tidyTranscript('<|en|><|NEUTRAL|>  hi  there '), 'hi there');
});
test('cloud recognition retries rate limits and server errors, but not auth failures', async () => {
  const cfg = cloudConfig(newProfile('siliconflow')), sleeps = [];
  let calls = 0;
  const flaky = async () => (++calls < 3 ? { status: calls === 1 ? 429 : 503, text: '{}', headers: { 'retry-after': '2' } } : { status: 200, text: '{"text":"ok"}', headers: {} });
  assert.equal(await recognizeCloud(cfg, 'k', wav, { request: flaky, sleep: async ms => { sleeps.push(ms); } }), 'ok');
  assert.deepEqual(sleeps, [2000, 2000]);
  calls = 0;
  await assert.rejects(recognizeCloud(cfg, 'k', wav, { request: async () => { calls++; return { status: 401, text: '{"error":{"message":"bad"}}' }; }, sleep: async () => {} }), { code: 'auth' });
  assert.equal(calls, 1);
  await assert.rejects(recognizeCloud(cfg, 'k', wav, { request: async () => ({ status: 402, text: '{}' }), sleep: async () => {} }), { code: 'quota' });
});
test('cloud recognition stops waiting immediately when cancelled', async () => {
  const cfg = cloudConfig(newProfile('siliconflow')), abort = new AbortController();
  const pending = recognizeCloud(cfg, 'k', wav, { request: () => new Promise(() => {}), signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
test('profiles are cleaned, deduplicated and keep the key out of settings', () => {
  const taken = new Set();
  const a = cleanProfile({ id: 'p1', provider: 'glm', apiKey: 'secret' }, taken), b = cleanProfile({ id: 'p1', provider: 'zzz' }, taken);
  assert.equal(a.apiKey, undefined); assert.notEqual(a.id, b.id); assert.equal(b.provider, 'custom');
  assert.equal(withProvider(a, 'doubao').model, 'bigmodel');
  assert.match(asrSecretId(a.id), /^[a-z0-9-]+$/); assert.equal(ttsSecretId('openai'), 'qiaomu-audio-tts-openai');
});
test('settings normalise unknown values and drop the local engine on mobile', () => {
  const s = normalizeSettings({ tts: { provider: 'nope', rate: 9 }, asr: { engine: 'local', mode: 'x', language: 'xx', profiles: [{ id: 'p1', provider: 'glm' }] } }, false);
  assert.equal(s.tts.provider, 'system'); assert.equal(s.tts.rate, 1);
  assert.equal(s.asr.engine, ''); assert.equal(s.asr.mode, 'live'); assert.equal(s.asr.language, 'auto');
  const d = normalizeSettings({ asr: { engine: 'cloud:missing', profiles: [{ id: 'p1', provider: 'glm' }] } }, true);
  assert.equal(d.asr.engine, 'cloud:p1');
  assert.equal(normalizeSettings(undefined, true).tts.provider, 'edge');
});

test('fresh and incomplete dictation settings default to live text with an audio attachment', () => {
  for (const desktop of [true, false]) {
    for (const settings of [defaultSettings(desktop), ...[undefined, null, {}, { asr: {} }, { asr: { mode: 'invalid', keepAudio: 'false' } }].map(raw => normalizeSettings(raw, desktop))]) {
      assert.equal(settings.asr.mode, 'live');
      assert.equal(settings.asr.keepAudio, true);
    }
  }
});

test('saved dictation choices survive normalization and save/reload', () => {
  for (const mode of ['live', 'batch']) for (const keepAudio of [true, false]) {
    const saved = { asr: { mode, keepAudio, language: 'zh' } };
    const reloaded = normalizeSettings(JSON.parse(JSON.stringify(normalizeSettings(saved))));
    assert.equal(reloaded.asr.mode, mode);
    assert.equal(reloaded.asr.keepAudio, keepAudio);
    assert.equal(reloaded.asr.language, 'zh');
  }
});

const tone = (seconds, amp = 0.3, rate = TARGET_RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin(i / 3));
const concat = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test('resampling keeps duration and WAV encoding writes a valid 16-bit header', () => {
  assert.equal(resample(new Float32Array(48000), 48000).length, 16000);
  assert.equal(resample(new Float32Array(44100), 44100).length, 16000);
  assert.equal(resample(new Float32Array(8000), 8000).length, 16000);
  const bytes = encodeWav(Float32Array.from([0, 1, -1, 2]));
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8); assert.equal(view.getInt16(46, true), 32767); assert.equal(view.getInt16(48, true), -32768);
});
test('long recordings are cut in pauses and never exceed the service maximum', () => {
  const audio = concat(tone(12), tone(0.5, 0), tone(12), tone(0.5, 0), tone(12));
  const mids = pauseMidpoints(audio);
  assert.equal(mids.length, 2);
  assert.ok(Math.abs(mids[0] - 12.25) < 0.1);
  const pieces = splitForRecognition(audio, TARGET_RATE, 18, 28);
  assert.ok(pieces.length >= 2);
  for (const p of pieces) assert.ok(p.length / TARGET_RATE <= 28.01);
  assert.equal(pieces.reduce((n, p) => n + p.length, 0), audio.length);
  assert.deepEqual(planChunks([], 100, 20, 40), [[0, 40], [40, 80], [80, 100]]);
  assert.deepEqual(planChunks([], 10, 20, 40), [[0, 10]]);
});
test('silence is not sent for recognition; transcript pieces join without stray spaces', () => {
  assert.equal(hasSpeech(new Float32Array(TARGET_RATE * 2)), false);
  assert.equal(hasSpeech(tone(1)), true);
  assert.equal(joinTranscript(['你好。', '世界。']), '你好。世界。');
  assert.equal(joinTranscript(['Hello there.', 'General Kenobi', '', '。']), 'Hello there. General Kenobi。');
});
test('live segmenter emits a phrase after a pause and ignores pure silence', () => {
  const phrases = [], seg = new PhraseSegmenter({ onPhrase: p => phrases.push(p.length / TARGET_RATE) });
  const feed = audio => { for (let i = 0; i < audio.length; i += 1600) seg.push(audio.subarray(i, i + 1600)); };
  feed(tone(3, 0)); assert.equal(phrases.length, 0);
  feed(tone(1.5)); feed(tone(1, 0));
  assert.equal(phrases.length, 1);
  feed(tone(30)); assert.equal(phrases.length, 2);
  assert.ok(phrases[1] <= 25.01);
  seg.flush(); assert.ok(phrases.length >= 2);
});
