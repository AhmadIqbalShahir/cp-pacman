// Procedural pixel-art sprite generation for CP-Pacman.
//
// No pre-rendered PNG frames are shipped for animated entities: sprites are
// drawn once onto small offscreen 16x16 canvases (native resolution per the
// design spec) and cached, then blitted with drawImage at render time. This
// keeps the whole game asset-free (besides the user-supplied logo) and fully
// offline, while still giving each entity a distinct, readable silhouette.

const NATIVE = 16;

const ENEMY_THEME = {
  prof1: { name: 'Prof 1', body: '#c62828', trim: '#f3d9a4', kind: 'blazer' },
  prof2: { name: 'Prof 2', body: '#1a3a5c', trim: '#f3d9a4', kind: 'blazer' },
  pruefung1: { name: 'Pruefung 1', body: '#e8e2d0', trim: '#c62828', kind: 'paper' },
  pruefung2: { name: 'Pruefung 2', body: '#e8e2d0', trim: '#1a7a4a', kind: 'paper' },
};

const FRIGHTENED_BODY = '#1e3ab5';
const FRIGHTENED_TRIM = '#dfe6ff';
const FRIGHTENED_FLASH_BODY = '#e8e2d0';
const FRIGHTENED_FLASH_TRIM = '#1e3ab5';

const spriteCache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// ---- Player ----------------------------------------------------------

const PLAYER_HOODIE = '#f2b632';
const PLAYER_HOODIE_SHADE = '#c98f1e';
const PLAYER_SKIN = '#f0c9a0';
const PLAYER_BACKPACK = '#3a6ea5';
const PLAYER_SHOE = '#2a2f3a';

function buildPlayerSprite(direction, frame) {
  const c = makeCanvas(NATIVE, NATIVE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // backpack on the side opposite the facing direction
  const backOffsets = {
    up: [6, 10], down: [6, 2], left: [11, 5], right: [1, 5],
  };
  const [bx, by] = backOffsets[direction] || backOffsets.down;
  px(ctx, bx, by, 4, 6, PLAYER_BACKPACK);

  // body (rounded hoodie silhouette via layered rects)
  px(ctx, 4, 3, 8, 9, PLAYER_HOODIE);
  px(ctx, 3, 5, 1, 6, PLAYER_HOODIE_SHADE);
  px(ctx, 12, 5, 1, 6, PLAYER_HOODIE_SHADE);
  px(ctx, 5, 2, 6, 1, PLAYER_HOODIE);

  // shoes, alternate for walk frames
  const step = frame % 2 === 0;
  px(ctx, step ? 4 : 5, 13, 3, 2, PLAYER_SHOE);
  px(ctx, step ? 9 : 8, 13, 3, 2, PLAYER_SHOE);

  // face / chomp wedge in facing direction (classic Pacman chomp cadence,
  // adapted as a small "bite" gag while walking)
  const chompOpen = frame === 2;
  px(ctx, 5, 5, 6, 5, PLAYER_SKIN);
  ctx.fillStyle = '#000000';
  if (chompOpen) {
    ctx.beginPath();
    const cx = 8, cy = 7.5;
    let a1 = 0, a2 = 0;
    if (direction === 'right') { a1 = -0.35; a2 = 0.35; }
    else if (direction === 'left') { a1 = Math.PI - 0.35; a2 = Math.PI + 0.35; }
    else if (direction === 'up') { a1 = -Math.PI / 2 - 0.35; a2 = -Math.PI / 2 + 0.35; }
    else { a1 = Math.PI / 2 - 0.35; a2 = Math.PI / 2 + 0.35; }
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 5, a1, a2);
    ctx.closePath();
    ctx.fill();
  } else {
    // small eye dots to keep the face readable when mouth is closed
    const eyeSpots = {
      down: [[6, 6], [9, 6]],
      up: [[6, 5], [9, 5]],
      left: [[5, 6]],
      right: [[10, 6]],
    };
    for (const [ex, ey] of (eyeSpots[direction] || eyeSpots.down)) {
      px(ctx, ex, ey, 1, 1, '#000000');
    }
  }

  return c;
}

function getPlayerSprite(direction, frame) {
  const key = `player_${direction}_${frame}`;
  if (!spriteCache.has(key)) spriteCache.set(key, buildPlayerSprite(direction, frame));
  return spriteCache.get(key);
}

// ---- Enemies -----------------------------------------------------------

function drawGhostBlob(ctx, bodyColor, trimColor, direction, frame) {
  // rounded-top blob body with a wavy skirt, classic ghost silhouette
  px(ctx, 4, 2, 8, 1, bodyColor);
  px(ctx, 3, 3, 10, 1, bodyColor);
  px(ctx, 2, 4, 12, 8, bodyColor);
  // wavy bottom skirt, alternates for animation
  const wave = frame % 2 === 0;
  for (let i = 0; i < 4; i++) {
    const x = 2 + i * 3;
    const h = wave ? (i % 2 === 0 ? 2 : 0) : (i % 2 === 0 ? 0 : 2);
    px(ctx, x, 12, 3, 2 + h, bodyColor);
  }
  // blazer trim / tie stripe down the front
  px(ctx, 7, 5, 2, 7, trimColor);

  drawEyes(ctx, direction);
}

function drawPaperSprite(ctx, bodyColor, trimColor, direction, frame) {
  // clipboard/exam-paper body with small stick legs
  px(ctx, 3, 2, 10, 11, bodyColor);
  px(ctx, 3, 2, 10, 2, trimColor); // header band (clip)
  // ruled lines suggesting exam text
  px(ctx, 5, 6, 6, 1, trimColor);
  px(ctx, 5, 8, 6, 1, trimColor);
  px(ctx, 5, 10, 4, 1, trimColor);
  // small legs, alternate for walk animation
  const step = frame % 2 === 0;
  px(ctx, step ? 4 : 6, 13, 2, 2, '#7a7060');
  px(ctx, step ? 10 : 8, 13, 2, 2, '#7a7060');

  drawEyes(ctx, direction);
}

function drawEyes(ctx, direction) {
  const offsets = {
    down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
  };
  const [dx, dy] = offsets[direction] || offsets.down;
  px(ctx, 5, 5, 3, 3, '#ffffff');
  px(ctx, 9, 5, 3, 3, '#ffffff');
  px(ctx, 5 + 1 + dx, 5 + 1 + dy, 1, 1, '#0a0a12');
  px(ctx, 9 + 1 + dx, 5 + 1 + dy, 1, 1, '#0a0a12');
}

function drawFrightenedFace(ctx, flash) {
  const body = flash ? FRIGHTENED_FLASH_BODY : FRIGHTENED_BODY;
  const trim = flash ? FRIGHTENED_FLASH_TRIM : FRIGHTENED_TRIM;
  px(ctx, 4, 2, 8, 1, body);
  px(ctx, 3, 3, 10, 1, body);
  px(ctx, 2, 4, 12, 8, body);
  for (let i = 0; i < 4; i++) {
    px(ctx, 2 + i * 3, 12, 3, 2, body);
  }
  // worried eyes + wavy mouth
  px(ctx, 5, 6, 2, 2, trim);
  px(ctx, 9, 6, 2, 2, trim);
  px(ctx, 5, 10, 1, 1, trim);
  px(ctx, 6, 9, 1, 1, trim);
  px(ctx, 7, 10, 1, 1, trim);
  px(ctx, 8, 9, 1, 1, trim);
  px(ctx, 9, 10, 1, 1, trim);
  px(ctx, 10, 9, 1, 1, trim);
}

function drawEatenEyes(ctx, direction) {
  const offsets = {
    down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
  };
  const [dx, dy] = offsets[direction] || offsets.down;
  px(ctx, 5, 6, 3, 3, '#ffffff');
  px(ctx, 9, 6, 3, 3, '#ffffff');
  px(ctx, 5 + 1 + dx, 6 + 1 + dy, 1, 1, '#0a0a12');
  px(ctx, 9 + 1 + dx, 6 + 1 + dy, 1, 1, '#0a0a12');
}

function buildEnemySprite(enemyType, direction, frame, state) {
  const c = makeCanvas(NATIVE, NATIVE);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const theme = ENEMY_THEME[enemyType];

  if (state === 'eaten') {
    drawEatenEyes(ctx, direction);
    return c;
  }
  if (state === 'frightened') {
    drawFrightenedFace(ctx, false);
    return c;
  }
  if (state === 'frightened-flash') {
    drawFrightenedFace(ctx, true);
    return c;
  }

  if (theme.kind === 'paper') {
    drawPaperSprite(ctx, theme.body, theme.trim, direction, frame);
  } else {
    drawGhostBlob(ctx, theme.body, theme.trim, direction, frame);
  }
  return c;
}

function getEnemySprite(enemyType, direction, frame, state) {
  const key = `enemy_${enemyType}_${direction}_${frame}_${state}`;
  if (!spriteCache.has(key)) spriteCache.set(key, buildEnemySprite(enemyType, direction, frame, state));
  return spriteCache.get(key);
}

// ---- Pellets -------------------------------------------------------------

function drawCpPellet(ctx, cx, cy, tileSize) {
  const s = tileSize * 0.16;
  ctx.fillStyle = '#f5f0e6';
  // small graduation-cap silhouette: a diamond top + a flat brim
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s * 1.6, cy);
  ctx.lineTo(cx, cy + s);
  ctx.lineTo(cx - s * 1.6, cy);
  ctx.closePath();
  ctx.fill();
  px(ctx, cx - s * 0.15, cy, s * 0.3, s * 1.4, '#f5f0e6');
}

function drawPowerPellet(ctx, cx, cy, tileSize, pulsePhase) {
  const base = tileSize * 0.32;
  const pulse = base + Math.sin(pulsePhase) * base * 0.18;
  ctx.save();
  ctx.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(pulsePhase));
  ctx.fillStyle = '#ffd54a';
  ctx.beginPath();
  ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, tileSize * 0.05);
  ctx.strokeStyle = '#a8781a';
  ctx.beginPath();
  ctx.arc(cx, cy, pulse * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---- HUD life glyph --------------------------------------------------

function drawLifeIcon(ctx, x, y, size) {
  const c = getPlayerSprite('right', 0);
  ctx.drawImage(c, x, y, size, size);
}
