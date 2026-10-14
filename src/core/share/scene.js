// Draws the share video on any Canvas 2D context: cover, waveform with read-along subtitles, end card.
// Everything is a pure function of time, so frames can be rendered in any order.
import { layoutPages, pageAt, wordState } from './subtitles.js';
import { COLORS, FONT, FPS, MONO, back, circleImage, clamp, ease, rounded } from './draw.js';
import { DEFAULT_STYLE, VISUAL_STYLES } from './styles.js';

export { FPS };
export const SIZES = { portrait: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } };
export const COVER_SECONDS = 0.7;
export const OUTRO_SECONDS = 6;
const WIDE_OR_WORD = /[㐀-鿿぀-ヿ가-힯]|[^\s㐀-鿿぀-ヿ가-힯]+|\s+/gu;

// Break text into at most maxLines lines no wider than maxWidth, ending the last line with … when cut.
function greedyLines(ctx, parts, maxWidth) {
  const lines = []; let line = '';
  for (const part of parts) {
    if (!line.trim() && /^\s+$/.test(part)) continue;
    if (line && ctx.measureText(line + part).width > maxWidth && !/^\s+$/.test(part)) { lines.push(line.trimEnd()); line = part.trimStart(); } else line += part;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
export function wrapText(ctx, text, maxWidth, maxLines) {
  const parts = String(text).match(WIDE_OR_WORD) || [];
  let lines = greedyLines(ctx, parts, maxWidth);
  if (lines.length > 1 && lines.length <= maxLines) {
    // Balance the lines: narrow the measure while the line count stays the same.
    let low = maxWidth * 0.45, high = maxWidth;
    for (let i = 0; i < 8; i++) {
      const mid = (low + high) / 2, trial = greedyLines(ctx, parts, mid);
      if (trial.length <= lines.length) { lines = trial; high = mid; } else low = mid;
    }
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines); let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`; return kept;
  }
  return lines;
}
export function fitFont(ctx, weight, size, family, text, maxWidth, maxLines, min = 36) {
  for (let s = size; s >= min; s -= 4) { ctx.font = `${weight} ${s}px ${family}`; if (wrapText(ctx, text, maxWidth, 99).length <= maxLines) return s; }
  return min;
}

// options: { orientation, title, caption, cues, features, visual, avatar, duration, cover: { seconds, image }|null,
//            outro: { seconds, name, avatar, accounts: [{ glyph, color, label, handle }] }|null, byline }
// `features` holds what the visual style reads from the audio (see audio.js analyse): at least `envelope`.
export function buildScene(options, ctx) {
  const size = SIZES[options.orientation] || SIZES.portrait, portrait = options.orientation !== 'landscape';
  const subtitleSize = portrait ? 64 : 56, maxWidth = size.width * (portrait ? 0.82 : 0.8);
  ctx.font = `600 ${subtitleSize}px ${FONT}`;
  const pages = layoutPages(options.cues, { measure: s => ctx.measureText(s).width, maxWidth, maxLines: portrait ? 3 : 2 });
  const cover = options.cover ? { seconds: options.cover.seconds ?? COVER_SECONDS, image: options.cover.image || null } : null;
  const outro = options.outro ? { seconds: options.outro.seconds ?? OUTRO_SECONDS, ...options.outro } : null;
  const intro = cover?.seconds || 0;
  const features = options.features || { envelope: options.envelope };
  // The band where the visual style draws: centred, between the title and the subtitles.
  const area = { cx: size.width / 2, cy: size.height * (portrait ? 0.42 : 0.5), width: size.width * (portrait ? 0.84 : 0.78), height: portrait ? 340 : 250 };
  return { ...size, portrait, subtitleSize, maxWidth, pages, cover, outro, intro, title: options.title || '', caption: options.caption || '', byline: options.byline || '',
    features, envelope: features.envelope, visual: VISUAL_STYLES[options.visual] ? options.visual : DEFAULT_STYLE, avatar: options.avatar || outro?.avatar || null, area,
    duration: options.duration, total: intro + options.duration + (outro?.seconds || 0) };
}

function background(ctx, scene, glow = 0) {
  const { width, height } = scene, g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, COLORS.bgTop); g.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  if (glow > 0) {
    const cx = width / 2, cy = height * (scene.portrait ? 0.42 : 0.4), r = Math.max(width, height) * 0.5, radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    radial.addColorStop(0, `rgba(125,211,252,${0.16 * glow})`); radial.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = radial; ctx.fillRect(0, 0, width, height);
  }
}
function drawImageCover(ctx, image, width, height) {
  const w = image.width || image.naturalWidth, h = image.height || image.naturalHeight; if (!w || !h) return;
  const scale = Math.max(width / w, height / h);
  ctx.drawImage(image, (width - w * scale) / 2, (height - h * scale) / 2, w * scale, h * scale);
}
function textLines(ctx, lines, x, y, lineHeight, align = 'center') {
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

// ---- cover -----------------------------------------------------------------------------------------------
export function drawCover(ctx, scene, progress = 1) {
  const { width, height, portrait } = scene, cover = scene.cover || { image: null };
  background(ctx, scene, 1);
  if (cover.image) { drawImageCover(ctx, cover.image, width, height); ctx.fillStyle = 'rgba(6,10,24,0.62)'; ctx.fillRect(0, 0, width, height); }
  const enter = ease(progress / 0.55), leave = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1, alpha = clamp(Math.min(enter, leave));
  ctx.save(); ctx.globalAlpha = alpha;
  // Decorative bars echo the waveform used in the video.
  const bars = portrait ? 31 : 53, pitch = (width * 0.78) / bars, base = height * (portrait ? 0.7 : 0.78);
  ctx.fillStyle = COLORS.accent;
  for (let i = 0; i < bars; i++) {
    const wave = 0.5 + 0.5 * Math.sin(i * 0.7) * Math.cos(i * 0.23 + 1), h = (portrait ? 150 : 110) * (0.2 + 0.8 * wave * Math.sin(Math.PI * (i + 0.5) / bars));
    rounded(ctx, width * 0.11 + i * pitch, base - h / 2, pitch * 0.55, Math.max(8, h), pitch * 0.275); ctx.globalAlpha = alpha * 0.55; ctx.fill();
  }
  ctx.globalAlpha = alpha; ctx.translate(width / 2, height / 2); const s = 0.96 + 0.04 * enter; ctx.scale(s, s); ctx.translate(-width / 2, -height / 2);
  const maxWidth = width * (portrait ? 0.78 : 0.7), fontSize = fitFont(ctx, 700, portrait ? 112 : 96, FONT, scene.title, maxWidth, portrait ? 4 : 3, 52);
  ctx.font = `700 ${fontSize}px ${FONT}`; ctx.fillStyle = COLORS.text;
  const lines = wrapText(ctx, scene.title, maxWidth, portrait ? 4 : 3), lineHeight = fontSize * 1.28, top = height * (portrait ? 0.4 : 0.42) - (lines.length * lineHeight) / 2;
  textLines(ctx, lines, width / 2, top + lineHeight / 2, lineHeight);
  ctx.fillStyle = COLORS.accent; rounded(ctx, width / 2 - 48, top - fontSize * 0.9, 96, 8, 4); ctx.fill();
  if (scene.caption) { ctx.font = `500 ${portrait ? 40 : 34}px ${FONT}`; ctx.fillStyle = 'rgba(248,250,252,0.7)'; textLines(ctx, [scene.caption], width / 2, top + lines.length * lineHeight + fontSize * 0.5, 50); }
  if (scene.byline) { ctx.font = `500 ${portrait ? 36 : 30}px ${FONT}`; ctx.fillStyle = 'rgba(248,250,252,0.6)'; textLines(ctx, [scene.byline], width / 2, height - (portrait ? 150 : 90), 40); }
  ctx.restore();
}

// ---- content -----------------------------------------------------------------------------------------------
function subtitles(ctx, scene, t) {
  const page = pageAt(scene.pages, t); if (!page) return;
  const { width, height, portrait } = scene, size = scene.subtitleSize * (page.heading ? 1.12 : 1), lineHeight = size * 1.5;
  ctx.font = `${page.heading ? 700 : 600} ${size}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const centerY = height * (portrait ? 0.7 : 0.77), top = centerY - (page.lines.length * lineHeight) / 2 + lineHeight / 2;
  const fade = clamp((t - page.show) / 0.12);
  page.lines.forEach((line, row) => {
    const widths = line.map(w => ctx.measureText(w.text).width), total = widths.reduce((a, b) => a + b, 0), y = top + row * lineHeight;
    let x = (width - total) / 2;
    line.forEach((word, i) => {
      const state = wordState(word, t);
      if (state === 'now') { ctx.fillStyle = 'rgba(125,211,252,0.42)'; rounded(ctx, x - 6, y - lineHeight * 0.4, widths[i] + 12, lineHeight * 0.8, 14); ctx.fill(); }
      const base = page.heading ? COLORS.accent : word.strong ? COLORS.strong : COLORS.text, alpha = state === 'next' ? 0.4 : 1;
      ctx.globalAlpha = alpha * fade; ctx.fillStyle = base; ctx.fillText(word.text, x, y); ctx.globalAlpha = 1;
      x += widths[i];
    });
  });
}
function chrome(ctx, scene, t) {
  const { width, height, portrait } = scene, margin = width * (portrait ? 0.09 : 0.06);
  const titleLines = portrait ? 2 : 1;
  ctx.font = `700 ${fitFont(ctx, 700, portrait ? 56 : 44, FONT, scene.title, width - margin * 2, titleLines, 32)}px ${FONT}`;
  ctx.fillStyle = COLORS.text; textLines(ctx, wrapText(ctx, scene.title, width - margin * 2, titleLines), margin, height * (portrait ? 0.075 : 0.1), portrait ? 72 : 56, 'left');
  const y = height * (portrait ? 0.93 : 0.9), progress = clamp(t / Math.max(0.1, scene.duration));
  ctx.fillStyle = COLORS.line; rounded(ctx, margin, y, width - margin * 2, 8, 4); ctx.fill();
  ctx.fillStyle = COLORS.accent; rounded(ctx, margin, y, Math.max(8, (width - margin * 2) * progress), 8, 4); ctx.fill();
  if (scene.byline) { ctx.font = `500 ${portrait ? 32 : 28}px ${FONT}`; ctx.fillStyle = 'rgba(248,250,252,0.55)'; textLines(ctx, [scene.byline], margin, y + (portrait ? 54 : 44), 40, 'left'); }
}
export function drawContent(ctx, scene, t) {
  const at = Math.min(scene.envelope.length - 1, Math.max(0, Math.round(t * FPS)));
  background(ctx, scene, 0.6 + 0.4 * (scene.envelope[at] || 0));
  VISUAL_STYLES[scene.visual].draw(ctx, scene, t); subtitles(ctx, scene, t); chrome(ctx, scene, t);
}

// ---- end card ----------------------------------------------------------------------------------------------
function badge(ctx, x, y, r, account) {
  ctx.fillStyle = account.color || '#334155'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${r * (account.glyph.length > 1 ? 0.8 : 1.05)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(account.glyph, x, y + 2);
}
export function drawOutro(ctx, scene, t) {
  const outro = scene.outro, { width, height, portrait } = scene, rows = outro.accounts || [];
  ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, width, height);
  const cardW = portrait ? 900 : 1180, rowH = portrait ? 104 : 92, headH = portrait ? 330 : 280, cardH = headH + 120 + rows.length * rowH + 40;
  const x = (width - cardW) / 2, y = (height - cardH) / 2, appear = ease(t / 0.4);
  ctx.save(); ctx.globalAlpha = appear;
  ctx.fillStyle = COLORS.terminal; rounded(ctx, x, y, cardW, cardH, 28); ctx.fill(); ctx.strokeStyle = COLORS.line; ctx.lineWidth = 2; ctx.stroke();
  [['#ff5f57', 0], ['#febc2e', 1], ['#28c840', 2]].forEach(([c, i]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 40 + i * 34, y + 38, 10, 0, Math.PI * 2); ctx.fill(); });
  // Avatar pops in, then the prompt types itself.
  const pop = back((t - 0.15) / 0.5), ax = width / 2, ay = y + 130, ar = (portrait ? 78 : 66) * Math.max(0, pop);
  if (ar > 1) {
    ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
    if (outro.avatar) circleImage(ctx, outro.avatar, ax, ay, ar);
    else { ctx.fillStyle = '#1f2937'; ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2); ctx.fillStyle = COLORS.accent; ctx.font = `700 ${ar}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText([...outro.name || '·'][0], ax, ay + 4); }
    ctx.restore(); ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();
  }
  const prompt = `$ follow ${outro.name || ''}`.trim(), typed = prompt.slice(0, Math.floor(clamp((t - 0.55) / 0.9) * prompt.length));
  ctx.font = `600 ${portrait ? 44 : 38}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = COLORS.accent;
  const promptW = ctx.measureText(prompt).width, px = (width - promptW) / 2, py = y + headH - 20;
  ctx.fillText(typed, px, py);
  if (typed.length < prompt.length || Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = COLORS.text; ctx.fillRect(px + ctx.measureText(typed).width + 6, py - 22, 22, 44); }
  rows.forEach((account, i) => {
    const start = 1.55 + i * 0.32, k = ease((t - start) / 0.3); if (k <= 0) return;
    const ry = y + headH + 60 + i * rowH + rowH / 2, slide = (1 - k) * 36, left = x + 64;
    ctx.globalAlpha = appear * k; badge(ctx, left + 32 - slide * 0, ry, portrait ? 32 : 28, account);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(248,250,252,0.62)'; ctx.font = `500 ${portrait ? 30 : 28}px ${FONT}`; ctx.fillText(account.label, left + 88 + slide, ry);
    ctx.fillStyle = COLORS.text; ctx.font = `600 ${portrait ? 36 : 34}px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(account.handle, x + cardW - 64 - slide, ry);
  });
  ctx.restore();
  // Fade out to black with a short black tail.
  const fadeStart = outro.seconds - 0.85, fadeOut = clamp((t - fadeStart) / 0.7);
  if (fadeOut > 0) { ctx.fillStyle = `rgba(0,0,0,${fadeOut})`; ctx.fillRect(0, 0, width, height); }
}

// One frame of the whole video at time t (seconds): cover, then content, then end card.
export function drawFrame(ctx, scene, t) {
  if (scene.cover && t < scene.intro) { drawCover(ctx, scene, t / scene.intro); return; }
  const local = t - scene.intro;
  if (local < scene.duration || !scene.outro) { drawContent(ctx, scene, Math.min(local, scene.duration)); return; }
  drawOutro(ctx, scene, local - scene.duration);
}
