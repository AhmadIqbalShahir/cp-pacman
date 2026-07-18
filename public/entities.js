// Smooth, full-resolution "neon campus arcade" sprite + maze rendering.
//
// Nothing here is pixel-art blitting: every character is drawn with vector
// shapes (arcs, gradients, rounded rects) into a cached offscreen canvas at
// the current render tile size, then blitted each frame. That gives a modern,
// colourful, un-16-bit look while keeping per-frame cost low.

// Colours drawn from the Apollo palette (AdamCYounis, lospec.com/palette-list/apollo)
// so every sprite, wall and UI element shares one deliberate, hand-authored set.
const ENEMY_DEFS = {
  prof1: { kind: 'prof', face: 'mustache', accent: '#cf573c', skin: '#d8a878', skinHi: '#eec89a', label: 'PROF' },
  prof2: { kind: 'prof', face: 'beard', accent: '#4f8fba', skin: '#cf9e6e', skinHi: '#e8bd8c', label: 'PROF' },
  pruefung1: { kind: 'klausur', body: '#ebede9', bodyDark: '#c09473', trim: '#a53030', label: 'KLAUSUR' },
  pruefung2: { kind: 'klausur', body: '#ebede9', bodyDark: '#c09473', trim: '#75a743', label: 'KLAUSUR' },
};

const _spriteCache = new Map();

// ---- optional imported PNG sprites -------------------------------------
// Drop PNGs in public/assets/sprites/ and list them in manifest.json to
// override the drawn characters. Understood keys: player[/_dir], prof1[/_dir],
// prof2[/_dir], klausur1[/_dir], klausur2[/_dir]  (dir = up|down|left|right).
const SPRITE_IMG = {};
function _tryImg(key, path) {
  const im = new Image();
  im.onload = () => { if (im.naturalWidth > 0) SPRITE_IMG[key] = im; };
  im.src = path;
}
async function loadSpriteAssets() {
  try {
    const res = await fetch('assets/sprites/manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const man = await res.json();
    for (const [key, file] of Object.entries(man)) if (file) _tryImg(key, 'assets/sprites/' + file);
  } catch (e) { /* no imported sprites; drawn characters are used */ }
}
function _assetFor(name, dir) { return SPRITE_IMG[`${name}_${dir}`] || SPRITE_IMG[name] || null; }
function _blitAsset(img, size) {
  const key = 'img_' + img.src + '_' + size;
  if (_spriteCache.has(key)) return _spriteCache.get(key);
  const c = _canvas(size);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.drawImage(img, 0, 0, size, size);
  _spriteCache.set(key, c);
  return c;
}

function _canvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---- Player: coffee-fuelled student (chomping disc + grad cap) ---------

function _drawPlayer(ctx, S, dir, frame) {
  const cx = S / 2, cy = S * 0.52, r = S * 0.38;
  const angles = { right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2 };
  const base = angles[dir] ?? 0;
  const open = [0.05, 0.2, 0.36][frame % 3] * Math.PI;

  // hoodie hood wrapping the head (student look)
  ctx.fillStyle = '#c94f3d';                        // warm hoodie
  ctx.beginPath();
  ctx.arc(cx, cy + S * 0.05, r * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2f37';                         // hood opening shade behind head
  ctx.beginPath();
  ctx.arc(cx, cy - S * 0.02, r * 1.06, Math.PI * 0.86, Math.PI * 0.14);
  ctx.closePath();
  ctx.fill();
  // hood drawstrings
  ctx.strokeStyle = '#e7d5b3';
  ctx.lineWidth = Math.max(1, S * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.35, cy + r * 0.9); ctx.lineTo(cx - r * 0.28, cy + r * 1.25);
  ctx.moveTo(cx + r * 0.35, cy + r * 0.9); ctx.lineTo(cx + r * 0.28, cy + r * 1.25);
  ctx.stroke();

  // face (chomping)
  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
  grad.addColorStop(0, '#ffe0a8');
  grad.addColorStop(0.7, '#f0c07a');
  grad.addColorStop(1, '#d69a4e');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, base + open, base + Math.PI * 2 - open);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, S * 0.022);
  ctx.strokeStyle = '#b07d38';
  ctx.stroke();

  // hair fringe peeking from the hood (skip facing up)
  if (dir !== 'up') {
    ctx.fillStyle = '#3a2716';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy - r * 0.45);
    for (let i = 0; i <= 5; i++) {
      const x = cx + (i / 5 - 0.5) * r * 1.4;
      ctx.lineTo(x, cy - r * (i % 2 === 0 ? 0.98 : 0.7));
      ctx.lineTo(x + r * 0.14, cy - r * 0.5);
    }
    ctx.lineTo(cx + r * 0.7, cy - r * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  // round glasses biased toward the facing side
  const gb = { right: 0.16, left: -0.16, up: 0, down: 0 }[dir] || 0;
  const gy = cy - r * 0.1;
  ctx.strokeStyle = '#2b2018';
  ctx.lineWidth = Math.max(1, S * 0.028);
  for (const s of [-1, 1]) {
    const ex = cx + gb * r + s * r * 0.33;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex, gy, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#10141f';
    ctx.beginPath(); ctx.arc(ex + gb * r * 0.4, gy, r * 0.09, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx + gb * r - r * 0.11, gy);
  ctx.lineTo(cx + gb * r + r * 0.11, gy);
  ctx.stroke();
}

// ---- Professors: floating Einstein-style heads (no ghost body) ---------

function _puff(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function _drawProf(ctx, S, def, dir, frame) {
  const cx = S / 2, cy = S * 0.44, rx = S * 0.3, ry = S * 0.32;
  const HAIR = '#eef0ec', HAIR_SH = '#c9cfca';
  const bob = (frame % 2 === 0) ? 0 : S * 0.015;

  // suit shoulders + bow tie (accent colour distinguishes the two profs)
  ctx.fillStyle = '#2a2f37';
  roundRectPath(ctx, cx - S * 0.24, S * 0.8, S * 0.48, S * 0.2, S * 0.06);
  ctx.fill();
  ctx.fillStyle = '#ebede9';
  ctx.beginPath();
  ctx.moveTo(cx - S * 0.1, S * 0.8); ctx.lineTo(cx, S * 0.92); ctx.lineTo(cx + S * 0.1, S * 0.8);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = def.accent;
  ctx.beginPath();
  ctx.moveTo(cx, S * 0.83); ctx.lineTo(cx - S * 0.1, S * 0.79); ctx.lineTo(cx - S * 0.1, S * 0.87); ctx.closePath();
  ctx.moveTo(cx, S * 0.83); ctx.lineTo(cx + S * 0.1, S * 0.79); ctx.lineTo(cx + S * 0.1, S * 0.87); ctx.closePath();
  ctx.fill();
  ctx.beginPath(); ctx.arc(cx, S * 0.83, S * 0.028, 0, Math.PI * 2); ctx.fill();

  // wild hair halo behind the head
  for (let i = 0; i < 11; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    _puff(ctx, cx + Math.cos(a) * rx * 1.18, cy + bob - S * 0.03 + Math.sin(a) * ry * 1.0, S * 0.1, i % 2 ? HAIR_SH : HAIR);
  }

  // ears
  ctx.fillStyle = def.skin;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * rx * 0.98, cy + bob + S * 0.02, S * 0.05, S * 0.07, 0, 0, Math.PI * 2); ctx.fill(); }

  // head
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, rx * 0.2, cx, cy, rx * 1.15);
  g.addColorStop(0, def.skinHi); g.addColorStop(1, def.skin);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy + bob, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

  // front hair tufts
  for (const s of [-1, 1]) {
    _puff(ctx, cx + s * rx * 0.72, cy + bob - ry * 0.72, S * 0.11, HAIR);
    _puff(ctx, cx + s * rx * 0.98, cy + bob - ry * 0.35, S * 0.1, HAIR_SH);
  }
  _puff(ctx, cx, cy + bob - ry * 0.95, S * 0.12, HAIR);
  _puff(ctx, cx - S * 0.1, cy + bob - ry * 0.9, S * 0.08, HAIR_SH);
  _puff(ctx, cx + S * 0.1, cy + bob - ry * 0.9, S * 0.08, HAIR_SH);

  // bushy eyebrows
  ctx.fillStyle = HAIR;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * S * 0.12, cy + bob - S * 0.09, S * 0.09, S * 0.045, 0, 0, Math.PI * 2); ctx.fill(); }

  // eyes + round glasses
  const look = { right: [0.09, 0], left: [-0.09, 0], up: [0, -0.07], down: [0, 0.07] }[dir] || [0, 0];
  for (const s of [-1, 1]) {
    const gx = cx + s * S * 0.12, gy = cy + bob;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(gx, gy, S * 0.088, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10141f'; ctx.beginPath(); ctx.arc(gx + look[0] * S, gy + look[1] * S, S * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2f28'; ctx.lineWidth = Math.max(1, S * 0.02);
    ctx.beginPath(); ctx.arc(gx, gy, S * 0.108, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx - S * 0.02, cy + bob); ctx.lineTo(cx + S * 0.02, cy + bob); ctx.stroke();

  // full white moustache (both)
  ctx.fillStyle = HAIR;
  ctx.beginPath(); ctx.ellipse(cx, cy + bob + S * 0.15, S * 0.15, S * 0.06, 0, 0, Math.PI * 2); ctx.fill();

  // beard for the second prof
  if (def.face === 'beard') {
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.72, cy + bob + S * 0.06);
    ctx.quadraticCurveTo(cx - rx * 0.55, cy + bob + ry * 1.15, cx, cy + bob + ry * 1.2);
    ctx.quadraticCurveTo(cx + rx * 0.55, cy + bob + ry * 1.15, cx + rx * 0.72, cy + bob + S * 0.06);
    ctx.quadraticCurveTo(cx, cy + bob + S * 0.3, cx - rx * 0.72, cy + bob + S * 0.06);
    ctx.closePath(); ctx.fill();
  }
}

// ---- Klausur (exam sheet) ---------------------------------------------

function _drawKlausur(ctx, S, def, dir, frame) {
  const w = S * 0.66, h = S * 0.78;
  const x = (S - w) / 2, y = S * 0.06;
  const fold = S * 0.14;
  const RED = '#c22a2a';

  // little legs
  ctx.strokeStyle = '#7a6f58';
  ctx.lineWidth = Math.max(1, S * 0.05);
  ctx.lineCap = 'round';
  const legWob = (frame % 2 === 0) ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.32, y + h);
  ctx.lineTo(x + w * 0.32 + legWob * S * 0.05, S * 0.96);
  ctx.moveTo(x + w * 0.68, y + h);
  ctx.lineTo(x + w * 0.68 - legWob * S * 0.05, S * 0.96);
  ctx.stroke();

  // paper with a folded top-right corner
  ctx.fillStyle = def.body;
  ctx.strokeStyle = def.bodyDark;
  ctx.lineWidth = Math.max(1, S * 0.02);
  ctx.beginPath();
  ctx.moveTo(x + S * 0.05, y);
  ctx.lineTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w, y + h - S * 0.05);
  ctx.quadraticCurveTo(x + w, y + h, x + w - S * 0.05, y + h);
  ctx.lineTo(x + S * 0.05, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - S * 0.05);
  ctx.lineTo(x, y + S * 0.05);
  ctx.quadraticCurveTo(x, y, x + S * 0.05, y);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // fold shadow
  ctx.fillStyle = def.bodyDark;
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y); ctx.lineTo(x + w, y + fold); ctx.lineTo(x + w - fold, y + fold);
  ctx.closePath(); ctx.fill();

  // header label bar (trim colour) with a couple of title ticks
  ctx.fillStyle = def.trim;
  roundRectPath(ctx, x + S * 0.08, y + S * 0.06, w - fold - S * 0.06, S * 0.06, S * 0.02);
  ctx.fill();

  // ruled answer lines
  ctx.strokeStyle = '#c9bfa6';
  ctx.lineWidth = Math.max(1, S * 0.012);
  for (let i = 0; i < 3; i++) {
    const ly = y + h * (0.3 + i * 0.12);
    ctx.beginPath(); ctx.moveTo(x + w * 0.14, ly); ctx.lineTo(x + w * 0.86, ly); ctx.stroke();
  }

  // big red failing grade, circled like a teacher's pen
  const gx = x + w * 0.5, gy = y + h * 0.62;
  ctx.fillStyle = RED;
  ctx.font = `bold ${Math.floor(S * 0.26)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('5,0', gx, gy);
  ctx.strokeStyle = RED;
  ctx.lineWidth = Math.max(1, S * 0.03);
  ctx.beginPath();
  ctx.ellipse(gx, gy, S * 0.2, S * 0.16, -0.12, 0.2, Math.PI * 2 + 0.05);
  ctx.stroke();

  // googly eyes peeking over the header
  const look = { right: [0.05, 0], left: [-0.05, 0], up: [0, -0.03], down: [0, 0.03] }[dir] || [0, 0];
  for (const s of [-1, 1]) {
    const eyeX = gx + s * w * 0.2, eyeY = y - S * 0.01;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(eyeX, eyeY, S * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a5040'; ctx.lineWidth = Math.max(1, S * 0.015); ctx.stroke();
    ctx.fillStyle = '#10141f';
    ctx.beginPath(); ctx.arc(eyeX + look[0] * S, eyeY + look[1] * S, S * 0.035, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- frightened / eaten ------------------------------------------------

function _drawFrightened(ctx, S, kind, flash, frame) {
  const body = flash ? '#ebede9' : '#3c5e8b';
  const dark = flash ? '#c7cfcc' : '#253a5e';
  if (kind === 'klausur') {
    const w = S * 0.62, h = S * 0.74, x = (S - w) / 2, y = S * 0.08;
    roundRectPath(ctx, x, y, w, h, S * 0.06);
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, S * 0.025); ctx.stroke();
  } else {
    // panicked professor head
    ctx.fillStyle = dark;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      _puff(ctx, S / 2 + Math.cos(a) * S * 0.34, S * 0.42 + Math.sin(a) * S * 0.3, S * 0.08, dark);
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(S / 2, S * 0.46, S * 0.3, S * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  }
  const cy = S * 0.42;
  // worried eyes
  ctx.fillStyle = flash ? '#a53030' : '#e7d5b3';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(S / 2 + s * S * 0.16, cy, S * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  // wavy scared mouth
  ctx.strokeStyle = flash ? '#a53030' : '#e7d5b3';
  ctx.lineWidth = Math.max(1, S * 0.03);
  ctx.beginPath();
  const my = S * 0.64;
  for (let i = 0; i <= 6; i++) {
    const mx = S * 0.28 + (S * 0.44) * (i / 6);
    const yy = my + (i % 2 === 0 ? -S * 0.03 : S * 0.03);
    if (i === 0) ctx.moveTo(mx, yy); else ctx.lineTo(mx, yy);
  }
  ctx.stroke();
  // sweat drop
  ctx.fillStyle = '#73bed3';
  ctx.beginPath();
  ctx.arc(S * 0.72, S * 0.34, S * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

function _drawEaten(ctx, S, dir) {
  const look = { right: [0.14, 0], left: [-0.14, 0], up: [0, -0.12], down: [0, 0.12] }[dir] || [0, 0];
  const cy = S * 0.44;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(S / 2 + s * S * 0.16, cy, S * 0.11, S * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3c5e8b';
    ctx.beginPath();
    ctx.arc(S / 2 + s * S * 0.16 + look[0] * S, cy + look[1] * S, S * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- cache accessors ---------------------------------------------------

const ENEMY_ASSET_NAME = { prof1: 'prof1', prof2: 'prof2', pruefung1: 'klausur1', pruefung2: 'klausur2' };

function getPlayerSprite(dir, frame, size) {
  const img = _assetFor('player', dir);
  if (img) return _blitAsset(img, size);
  const key = `p_${dir}_${frame}_${size}`;
  if (_spriteCache.has(key)) return _spriteCache.get(key);
  const c = _canvas(size);
  _drawPlayer(c.getContext('2d'), size, dir, frame);
  _spriteCache.set(key, c);
  return c;
}

function getEnemySprite(type, dir, frame, stateKey, size) {
  if (stateKey === 'normal') {
    const img = _assetFor(ENEMY_ASSET_NAME[type], dir);
    if (img) return _blitAsset(img, size);
  }
  const key = `e_${type}_${dir}_${frame}_${stateKey}_${size}`;
  if (_spriteCache.has(key)) return _spriteCache.get(key);
  const c = _canvas(size);
  const ctx = c.getContext('2d');
  const def = ENEMY_DEFS[type];
  if (stateKey === 'eaten') _drawEaten(ctx, size, dir);
  else if (stateKey === 'frightened') _drawFrightened(ctx, size, def.kind, false, frame);
  else if (stateKey === 'frightened-flash') _drawFrightened(ctx, size, def.kind, true, frame);
  else if (def.kind === 'klausur') _drawKlausur(ctx, size, def, dir, frame);
  else _drawProf(ctx, size, def, dir, frame);
  _spriteCache.set(key, c);
  return c;
}

// ---- pellets -----------------------------------------------------------

function drawCpPellet(ctx, cx, cy, size, pulse) {
  const r = size * 0.1 * (1 + 0.1 * Math.sin(pulse));
  ctx.save();
  ctx.fillStyle = '#d7b594';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ebede9';
  ctx.beginPath();
  ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPowerPellet(ctx, cx, cy, size, pulse) {
  const r = size * 0.32 * (1 + 0.08 * Math.sin(pulse * 2));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pulse * 0.3);
  ctx.shadowColor = 'rgba(232,193,112,0.55)';
  ctx.shadowBlur = size * 0.28;
  // Freiversuch seal: gently scalloped stamp
  ctx.fillStyle = '#e8c170';
  ctx.beginPath();
  const spikes = 10;
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (Math.PI / spikes) * i;
    const rad = (i % 2 === 0) ? r : r * 0.82;
    ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.rotate(-pulse * 0.3);
  ctx.strokeStyle = '#4d2b32';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#4d2b32';
  ctx.font = `bold ${Math.floor(size * 0.3)}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('F', 0, size * 0.02);
  ctx.restore();
}

// ---- bonus item icons (drawn, no emoji) --------------------------------

function drawBonusIcon(ctx, kind, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  const s = size;
  if (kind === 'coffee') {
    // cup
    ctx.fillStyle = '#e7d5b3';
    roundRectPath(ctx, -s * 0.3, -s * 0.18, s * 0.5, s * 0.42, s * 0.06);
    ctx.fill();
    ctx.fillStyle = '#4d2b32';                 // coffee
    roundRectPath(ctx, -s * 0.26, -s * 0.14, s * 0.42, s * 0.12, s * 0.04);
    ctx.fill();
    ctx.strokeStyle = '#e7d5b3';               // handle
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.arc(s * 0.24, s * 0.04, s * 0.12, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = '#c7cfcc';               // steam
    ctx.lineWidth = s * 0.035;
    for (const dx of [-0.12, 0.02]) {
      ctx.beginPath();
      ctx.moveTo(dx * s, -s * 0.26);
      ctx.quadraticCurveTo(dx * s + s * 0.08, -s * 0.34, dx * s, -s * 0.42);
      ctx.stroke();
    }
  } else if (kind === 'wurst') {
    // plate
    ctx.fillStyle = '#819796';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.16, s * 0.42, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // sausage
    ctx.fillStyle = '#a53030';
    roundRectPath(ctx, -s * 0.3, -s * 0.06, s * 0.6, s * 0.2, s * 0.1);
    ctx.fill();
    // curry sauce dots
    ctx.fillStyle = '#e8c170';
    for (const dx of [-0.18, 0, 0.18]) {
      ctx.beginPath();
      ctx.arc(dx * s, s * 0.02, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'book') {
    ctx.fillStyle = '#a53030';                 // cover
    roundRectPath(ctx, -s * 0.32, -s * 0.28, s * 0.64, s * 0.52, s * 0.04);
    ctx.fill();
    ctx.fillStyle = '#ebede9';                 // pages
    roundRectPath(ctx, -s * 0.26, -s * 0.22, s * 0.52, s * 0.4, s * 0.02);
    ctx.fill();
    ctx.strokeStyle = '#c09473';               // spine + lines
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.22); ctx.lineTo(0, s * 0.18);
    for (let i = -1; i <= 1; i += 2) {
      for (const ly of [-0.12, 0, 0.12]) {
        ctx.moveTo(i * s * 0.05, ly * s);
        ctx.lineTo(i * s * 0.2, ly * s);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---- maze pre-render (soft minimal: flat walls, thin borders) ----------

function _cornerRectPath(ctx, x, y, w, h, tl, tr, br, bl) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

function prerenderMaze(grid, map, rtile, rows, cols) {
  const c = _canvas(1);
  c.width = cols * rtile;
  c.height = rows * rtile;
  const ctx = c.getContext('2d');
  const isWall = (r, cc) => (r >= 0 && r < rows && cc >= 0 && cc < cols && grid[r][cc] === '#');
  const R = rtile * 0.34;                 // gentle corner rounding
  const inset = rtile * 0.06;

  // flat matte walls
  ctx.fillStyle = map.wall;
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      if (grid[r][cc] !== '#') continue;
      const up = isWall(r - 1, cc), dn = isWall(r + 1, cc), lf = isWall(r, cc - 1), rt = isWall(r, cc + 1);
      _cornerRectPath(ctx, cc * rtile + inset, r * rtile + inset, rtile - inset * 2, rtile - inset * 2,
        (up || lf) ? 0 : R, (up || rt) ? 0 : R, (dn || rt) ? 0 : R, (dn || lf) ? 0 : R);
      ctx.fill();
    }
  }

  // thin subtle border on exposed edges only (keeps it calm, not chunky)
  ctx.strokeStyle = map.wallHi || map.wall;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, rtile * 0.05);
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      if (grid[r][cc] !== '#') continue;
      const up = isWall(r - 1, cc), dn = isWall(r + 1, cc), lf = isWall(r, cc - 1), rt = isWall(r, cc + 1);
      if (up && dn && lf && rt) continue;   // fully enclosed tile needs no border
      _cornerRectPath(ctx, cc * rtile + inset, r * rtile + inset, rtile - inset * 2, rtile - inset * 2,
        (up || lf) ? 0 : R, (up || rt) ? 0 : R, (dn || rt) ? 0 : R, (dn || lf) ? 0 : R);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  return c;
}

loadSpriteAssets();
