// Fails when a static t('key') is missing, a dynamic key family has no entries, a translation is empty,
// or zh/en placeholders differ.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STRINGS } from '../src/strings.js';

const problems = [];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const [key, pair] of Object.entries(STRINGS)) {
  if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || !pair[1]) problems.push(`${key}: needs [zh, en]`);
  else if (placeholders(pair[0]) !== placeholders(pair[1])) problems.push(`${key}: placeholders differ`);
}
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.js')) files.push(path);
  }
})('src');
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(/\bt\('([^']+)'/g)) if (!STRINGS[m[1]]) problems.push(`${file}: missing key ${m[1]}`);
  for (const m of source.matchAll(/\bt\(`([a-zA-Z.]+)\$\{/g)) if (!Object.keys(STRINGS).some(k => k.startsWith(m[1]))) problems.push(`${file}: no keys for ${m[1]}*`);
  // Provider/label fields hold keys resolved later.
  for (const m of source.matchAll(/(?:label|note): '((?:asr|tts)\.[^']+)'/g)) if (!STRINGS[m[1]]) problems.push(`${file}: missing key ${m[1]}`);
}
// Every error code the core modules can raise has advice.
for (const code of ['key', 'url', 'https', 'model', 'auth', 'quota', 'server', 'service', 'rateLimit', 'timeout', 'network', 'response', 'protocol', 'noEngine',
  'micDenied', 'micMissing', 'micBusy', 'micUnsupported', 'localMissing', 'localInference', 'localEnvironment', 'localInstall', 'localDownload', 'localChecksum']) {
  if (!STRINGS[`error.${code}`]) problems.push(`error.${code}: missing`);
}
for (const phase of ['unknown', 'missing', 'runtime', 'environment', 'download', 'downloaded', 'extract', 'installed', 'verify', 'ready', 'cancelled', 'cancelling', 'server']) {
  if (!STRINGS[`phase.${phase}`]) problems.push(`phase.${phase}: missing`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`i18n ok: ${Object.keys(STRINGS).length} keys, zh/en complete`);
