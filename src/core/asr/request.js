// One recognition request, three wire protocols (ported from Qiaomu Clipper native/asr_cloud.py):
// an OpenAI-style /audio/transcriptions upload, an audio-capable /chat/completions model, and Doubao's "flash" call.
// `request` is Obsidian's requestUrl (or a test double); it cannot be aborted, so we stop waiting on abort.
import { asrError } from './providers.js';

const encoder = new TextEncoder();
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return window.btoa(binary);
}
export function multipart(fields, filename, content, contentType, boundary = '----qiaomu' + Math.random().toString(16).slice(2) + Date.now().toString(16)) {
  const parts = fields.map(([name, value]) => encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(content, encoder.encode(`\r\n--${boundary}--\r\n`));
  const size = parts.reduce((n, p) => n + p.length, 0), body = new Uint8Array(size);
  let offset = 0; for (const p of parts) { body.set(p, offset); offset += p.length; }
  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}
export function buildAsrRequest(cfg, key, wav, language = 'auto', uuid = () => window.crypto.randomUUID()) {
  if (!key && !cfg.local) throw asrError('key');
  if (cfg.protocol === 'doubao-flash') {
    return { url: cfg.baseUrl + '/auc/bigmodel/recognize/flash', method: 'POST', contentType: 'application/json',
      headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': 'volc.bigasr.auc_turbo', 'X-Api-Request-Id': uuid(), 'X-Api-Sequence': '-1' },
      body: JSON.stringify({ user: { uid: 'qiaomu-audio' }, audio: { data: bytesToBase64(wav) }, request: { model_name: cfg.model, enable_itn: true, enable_punc: true } }) };
  }
  const headers = { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  if (cfg.protocol === 'openai-transcriptions') {
    // Some services (StepFun) require an explicit response format.
    const fields = [['model', cfg.model], ['response_format', 'json']];
    if (cfg.languageParam && language !== 'auto' && language !== 'yue') fields.push(['language', language]);
    const { body, contentType } = multipart(fields, 'speech.wav', wav, 'audio/wav');
    return { url: cfg.baseUrl + '/audio/transcriptions', method: 'POST', headers, contentType, body };
  }
  if (cfg.protocol === 'chat-audio') {
    return { url: cfg.baseUrl + '/chat/completions', method: 'POST', headers, contentType: 'application/json',
      body: JSON.stringify({ model: cfg.model, stream: false,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,' + bytesToBase64(wav) } }] }],
        asr_options: { language: ['zh', 'en'].includes(language) ? language : 'auto' } }) };
  }
  throw asrError('protocol');
}
// SenseVoice-style emotion/event tags and emoji are not dictation text.
const NOISE = /<\|[^|>]*\|>|[\u{1F300}-\u{1FAFF}☀-➿]|️/gu;
export function tidyTranscript(text) { return String(text || '').replace(NOISE, '').replace(/\s+/g, ' ').trim(); }
function header(headers, name) {
  if (!headers) return '';
  const found = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return found ? String(headers[found]) : '';
}
function messageOf(response) {
  try { const data = JSON.parse(response.text); const e = data?.error; return String((typeof e === 'object' ? e?.message : e) || data?.message || '').slice(0, 160); }
  catch { return String(response.text || '').slice(0, 160); }
}
export function parseAsrResponse(cfg, response) {
  if (cfg.protocol === 'doubao-flash') {
    // Doubao answers HTTP 200 and reports the outcome in headers.
    const code = header(response.headers, 'X-Api-Status-Code'), detail = header(response.headers, 'X-Api-Message');
    if (code === '20000003') return '';
    if (code && code !== '20000000') {
      if (/quota|balance|insufficient|额度|余额|欠费/i.test(detail)) throw asrError('quota', detail);
      if (code.startsWith('4500001')) throw asrError('auth', detail);
      throw asrError(code.startsWith('55') ? 'server' : 'service', `${code} ${detail}`.trim());
    }
  }
  let data;
  try { data = typeof response.json === 'object' && response.json ? response.json : JSON.parse(response.text); }
  catch { throw asrError('response'); }
  if (cfg.protocol === 'doubao-flash') return tidyTranscript(data?.result?.text);
  if (cfg.protocol === 'openai-transcriptions') return tidyTranscript(data?.text);
  const content = data?.choices?.[0]?.message?.content;
  return tidyTranscript(typeof content === 'string' ? content : '');
}
export function classifyHttp(response) {
  const detail = messageOf(response);
  if (response.status === 401 || response.status === 403) return asrError('auth', detail);
  if (response.status === 402 || /balance|quota|insufficient|余额|额度|欠费/i.test(detail)) return asrError('quota', detail);
  if (response.status === 429) return asrError('rateLimit', detail);
  if (response.status >= 500) return asrError('server', `HTTP ${response.status} ${detail}`.trim());
  return asrError('service', `HTTP ${response.status} ${detail}`.trim());
}
const aborted = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });
function race(promise, signal, timeoutMs) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { window.clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(v); };
    const abort = () => done(reject, aborted());
    const timer = window.setTimeout(() => done(reject, asrError('timeout')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(v => done(resolve, v), e => done(reject, e));
  });
}
const wait = (ms, signal) => race(new Promise(r => window.setTimeout(r, ms)), signal, ms + 1000);
// Retries what is worth retrying (rate limits, server errors, a dropped connection) a few times.
export async function recognizeCloud(cfg, key, wav, { request, language = 'auto', signal, retries = 3, sleep = wait, timeoutMs = 90000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw aborted();
    const spec = buildAsrRequest(cfg, key, wav, language);
    let response;
    try { response = await race(request({ ...spec, throw: false }), signal, timeoutMs); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      last = error.code === 'timeout' ? error : asrError('network', String(error?.message || '').slice(0, 120));
      if (attempt < retries) { await sleep(Math.min(30000, 1000 * 2 ** attempt), signal); continue; }
      throw last;
    }
    try {
      if (response.status < 200 || response.status >= 300) throw classifyHttp(response);
      return parseAsrResponse(cfg, response);
    } catch (error) {
      last = error;
      if (['rateLimit', 'server'].includes(error.code) && attempt < retries) {
        const after = Number(header(response.headers, 'Retry-After'));
        await sleep(Math.min(30000, after > 0 ? after * 1000 : 1000 * 2 ** attempt + Math.floor(Math.random() * 500)), signal);
        continue;
      }
      throw error;
    }
  }
  throw last || asrError('network');
}
