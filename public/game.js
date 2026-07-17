// CP-Pacman core engine.

const TILE = 16;
const SCALE = 2;
const RTILE = TILE * SCALE;
const HUD_HEIGHT = 56;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = MAP_COLS * RTILE;
canvas.height = MAP_ROWS * RTILE + HUD_HEIGHT;

const nameEntryInput = document.getElementById('nameEntry');

const DIRS = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const KEY_TO_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

const PLAYER_SPEED = 7.2;               // tiles per second
const ENEMY_BASE_FACTOR = 0.9;
const ENEMY_SPEED_STEP = 0.025;
const ENEMY_SPEED_CAP = 1.10;
const FRIGHTENED_SPEED_FACTOR = 0.6;
const EATEN_SPEED_FACTOR = 2.0;

const FRIGHTENED_START = 8;
const FRIGHTENED_DECAY = 0.5;
const FRIGHTENED_MIN = 3;
const FRIGHTENED_FLASH_WINDOW = 2;

const RELEASE_TIMES = { prof1: 0, prof2: 3, pruefung1: 6, pruefung2: 9 };

const RESET_PAUSE_DURATION = 2;
const BOARD_CLEAR_PAUSE = 2.5;
const IDLE_TIMEOUT = 30;

// ---- Game state ------------------------------------------------------

let state = 'title';
let grid = null;
let currentMapIndex = 0;
let boardsCleared = 0;
let score = 0;
let lives = 3;
let frightenedDuration = FRIGHTENED_START;
let frightenedActive = false;
let frightenedTimer = 0;
let chainIndex = 0;
let boardTimer = 0;
let pauseTimer = 0;
let lastInputTime = Date.now();
let leaderboardEntries = [];
let player = null;
let enemies = [];
let animClock = 0;

const logoImg = new Image();
let logoLoaded = false;
logoImg.onload = () => { logoLoaded = true; };
logoImg.src = 'assets/ui/logo.webp';

// ---- Grid helpers ------------------------------------------------------

function isOpen(col, row) {
  if (row < 0 || row >= MAP_ROWS) return false;
  const c = ((col % MAP_COLS) + MAP_COLS) % MAP_COLS;
  return grid[row][c] !== '#';
}

function wrapCol(col) {
  return ((col % MAP_COLS) + MAP_COLS) % MAP_COLS;
}

function entityTile(m) {
  if (!m.dir) return { col: m.col, row: m.row };
  const [dx, dy] = DIRS[m.dir];
  return { col: Math.round(m.col + dx * m.progress), row: Math.round(m.row + dy * m.progress) };
}

function tileDistSq(aCol, aRow, bCol, bRow) {
  const dc = aCol - bCol, dr = aRow - bRow;
  return dc * dc + dr * dr;
}

// ---- Board loading -------------------------------------------------------

function parseGrid(map) {
  return map.grid.map((row) => row.split(''));
}

function findAndClear(g, ch, replacement) {
  const found = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (g[r][c] === ch) {
        found.push({ col: c, row: r });
        g[r][c] = replacement;
      }
    }
  }
  return found;
}

function countPellets() {
  let n = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r][c] === '.' || grid[r][c] === 'o') n++;
    }
  }
  return n;
}

function speedFactor() {
  return Math.min(ENEMY_SPEED_CAP, ENEMY_BASE_FACTOR + boardsCleared * ENEMY_SPEED_STEP);
}

function makeEnemy(type, homeTile) {
  return {
    type,
    homeTile,
    col: homeTile.col,
    row: homeTile.row,
    dir: null,
    progress: 0,
    state: 'waiting',
    releaseAt: RELEASE_TIMES[type],
    animFrame: 0,
  };
}

function loadBoard(index, opts) {
  const keepScore = !opts || opts.keepScore !== false;
  currentMapIndex = index;
  const map = MAPS[currentMapIndex];
  grid = parseGrid(map);

  const playerStart = findAndClear(grid, 'P', ' ')[0];
  const homes = {
    1: findAndClear(grid, '1', ' ')[0],
    2: findAndClear(grid, '2', ' ')[0],
    3: findAndClear(grid, '3', ' ')[0],
    4: findAndClear(grid, '4', ' ')[0],
  };

  player = {
    col: playerStart.col, row: playerStart.row,
    dir: null, nextDir: null, progress: 0,
    animFrame: 0, animTimer: 0, moving: false,
    startTile: playerStart,
  };

  enemies = [
    makeEnemy('prof1', homes[1]),
    makeEnemy('prof2', homes[2]),
    makeEnemy('pruefung1', homes[3]),
    makeEnemy('pruefung2', homes[4]),
  ];

  boardTimer = 0;
  frightenedActive = false;
  frightenedTimer = 0;
  chainIndex = 0;

  if (!keepScore) {
    score = 0;
    lives = 3;
    boardsCleared = 0;
    frightenedDuration = FRIGHTENED_START;
  }
}

function resetPositions() {
  player.col = player.startTile.col;
  player.row = player.startTile.row;
  player.dir = null;
  player.nextDir = null;
  player.progress = 0;
  for (const e of enemies) {
    e.col = e.homeTile.col;
    e.row = e.homeTile.row;
    e.dir = null;
    e.progress = 0;
    e.state = 'waiting';
  }
  boardTimer = 0;
  frightenedActive = false;
  frightenedTimer = 0;
  chainIndex = 0;
}

// ---- Movement ------------------------------------------------------------

function stepMover(m, tilesPerSec, dt, chooseDir) {
  if (!m.dir) {
    const d = chooseDir(m, null);
    if (d) { m.dir = d; } else { return; }
  }
  m.progress += tilesPerSec * dt;
  let guard = 0;
  while (m.progress >= 1 && guard < 4) {
    guard++;
    m.progress -= 1;
    const [dx, dy] = DIRS[m.dir];
    m.col = wrapCol(m.col + dx);
    m.row = m.row + dy;
    const newDir = chooseDir(m, m.dir);
    if (newDir) {
      m.dir = newDir;
    } else {
      m.progress = 0;
      m.dir = null;
      break;
    }
  }
}

function playerChooseDir(m, currentDir) {
  const tryOpen = (d) => isOpen(m.col + DIRS[d][0], m.row + DIRS[d][1]);
  if (player.nextDir && tryOpen(player.nextDir)) return player.nextDir;
  if (currentDir && tryOpen(currentDir)) return currentDir;
  for (const d of ['up', 'down', 'left', 'right']) if (tryOpen(d)) return d;
  return null;
}

function openNeighbors(m) {
  return ['up', 'down', 'left', 'right'].filter((d) => isOpen(m.col + DIRS[d][0], m.row + DIRS[d][1]));
}

function pickGreedyDir(options, m, target) {
  let best = null, bestDist = Infinity;
  for (const d of options) {
    const [dx, dy] = DIRS[d];
    const nc = wrapCol(m.col + dx), nr = m.row + dy;
    const dist = tileDistSq(nc, nr, target.col, target.row);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

function pickFrightenedDir(m, options) {
  const pTile = entityTile(player);
  const away = options.filter((d) => {
    const [dx, dy] = DIRS[d];
    const nc = wrapCol(m.col + dx), nr = m.row + dy;
    const dCur = tileDistSq(m.col, m.row, pTile.col, pTile.row);
    const dNew = tileDistSq(nc, nr, pTile.col, pTile.row);
    return dNew >= dCur;
  });
  const pool = away.length ? away : options;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getTargetTile(enemy) {
  const pTile = entityTile(player);
  switch (enemy.type) {
    case 'prof1':
      return pTile;
    case 'prof2': {
      const dir = player.dir || 'right';
      const [dx, dy] = DIRS[dir];
      const target = { col: wrapCol(pTile.col + dx * 4), row: pTile.row + dy * 4 };
      if (!isOpen(target.col, target.row)) return pTile;
      return target;
    }
    case 'pruefung1':
      return pTile;
    case 'pruefung2': {
      const distSq = tileDistSq(enemy.col, enemy.row, pTile.col, pTile.row);
      if (distSq > 64) return pTile;
      return enemy.homeTile;
    }
    default:
      return pTile;
  }
}

function enemyChooseDir(enemy, currentDir) {
  const candidates = openNeighbors(enemy);
  if (candidates.length === 0) return null;
  const forbidden = currentDir ? OPPOSITE[currentDir] : null;
  let options = candidates.filter((d) => d !== forbidden);
  if (options.length === 0) options = candidates;

  if (enemy.state === 'frightened') {
    return pickFrightenedDir(enemy, options);
  }
  if (enemy.state === 'eaten') {
    return pickGreedyDir(options, enemy, enemy.homeTile);
  }
  if (enemy.type === 'pruefung1') {
    if (Math.random() < 0.5) return pickGreedyDir(options, enemy, getTargetTile(enemy));
    return options[Math.floor(Math.random() * options.length)];
  }
  return pickGreedyDir(options, enemy, getTargetTile(enemy));
}

// ---- Playing update --------------------------------------------------

function updatePlaying(dt) {
  boardTimer += dt;
  animClock += dt;

  // release enemies on staggered timers
  for (const e of enemies) {
    if (e.state === 'waiting' && boardTimer >= e.releaseAt) {
      e.state = 'normal';
    }
  }

  // frightened countdown
  if (frightenedActive) {
    frightenedTimer -= dt;
    if (frightenedTimer <= 0) {
      frightenedActive = false;
      for (const e of enemies) if (e.state === 'frightened') e.state = 'normal';
    }
  }

  // player movement + input buffering
  stepMover(player, PLAYER_SPEED, dt, playerChooseDir);
  player.moving = !!player.dir;
  if (player.moving) {
    player.animTimer += dt;
    if (player.animTimer > 0.09) {
      player.animTimer = 0;
      player.animFrame = (player.animFrame + 1) % 3;
    }
  } else {
    player.animFrame = 0;
  }

  // pellet collection at the tile the player currently occupies (col/row are
  // always whole tiles; sub-tile position lives in `progress`)
  const cell = grid[player.row][player.col];
  if (cell === '.') {
    grid[player.row][player.col] = ' ';
    score += 10;
  } else if (cell === 'o') {
    grid[player.row][player.col] = ' ';
    score += 50;
    frightenedActive = true;
    frightenedTimer = frightenedDuration;
    frightenedDuration = Math.max(FRIGHTENED_MIN, frightenedDuration - FRIGHTENED_DECAY);
    chainIndex = 0;
    for (const e of enemies) {
      if (e.state === 'normal') {
        e.state = 'frightened';
        if (e.dir && isOpen(e.col + DIRS[OPPOSITE[e.dir]][0], e.row + DIRS[OPPOSITE[e.dir]][1])) {
          e.dir = OPPOSITE[e.dir];
        }
      }
    }
  }

  // enemy movement
  const sf = speedFactor();
  for (const e of enemies) {
    if (e.state === 'waiting') continue;
    let tps = PLAYER_SPEED * sf;
    if (e.state === 'frightened') tps = PLAYER_SPEED * sf * FRIGHTENED_SPEED_FACTOR;
    if (e.state === 'eaten') tps = PLAYER_SPEED * sf * EATEN_SPEED_FACTOR;
    stepMover(e, tps, dt, enemyChooseDir);
    e.animTimer = (e.animTimer || 0) + dt;
    if (e.animTimer > 0.15) {
      e.animTimer = 0;
      e.animFrame = (e.animFrame + 1) % 2;
    }
    if (e.state === 'eaten' && e.col === e.homeTile.col && e.row === e.homeTile.row) {
      e.state = 'normal';
    }
  }

  // collisions
  for (const e of enemies) {
    if (e.state === 'waiting') continue;
    const d = tileDistSq(e.col + (e.dir ? DIRS[e.dir][0] * e.progress : 0), e.row + (e.dir ? DIRS[e.dir][1] * e.progress : 0),
      player.col + (player.dir ? DIRS[player.dir][0] * player.progress : 0), player.row + (player.dir ? DIRS[player.dir][1] * player.progress : 0));
    if (d < 0.35) {
      if (e.state === 'normal') {
        loseLife();
        return;
      } else if (e.state === 'frightened') {
        e.state = 'eaten';
        score += 200 * Math.pow(2, chainIndex);
        chainIndex++;
      }
    }
  }

  // board clear check
  if (countPellets() === 0) {
    score += 1000;
    boardsCleared++;
    state = 'boardClear';
    pauseTimer = BOARD_CLEAR_PAUSE;
  }
}

function loseLife() {
  lives--;
  if (lives <= 0) {
    state = 'gameOverEntry';
    lastInputTime = Date.now();
    nameEntryInput.value = '';
    nameEntryInput.classList.add('visible');
    positionNameEntry();
    nameEntryInput.focus();
  } else {
    state = 'resetPause';
    pauseTimer = RESET_PAUSE_DURATION;
  }
}

function positionNameEntry() {
  const rect = canvas.getBoundingClientRect();
  nameEntryInput.style.left = `${rect.left + rect.width / 2 - 160}px`;
  nameEntryInput.style.top = `${rect.top + rect.height * 0.55}px`;
}

// ---- Input -----------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  lastInputTime = Date.now();
  if (state === 'title') {
    startNewGame();
    return;
  }
  if (state === 'playing') {
    const d = KEY_TO_DIR[ev.key];
    if (d) { player.nextDir = d; ev.preventDefault(); }
    return;
  }
  if (state === 'gameOverEntry') {
    if (ev.key === 'Enter') {
      submitScoreAndShowLeaderboard();
    }
    return;
  }
  if (state === 'gameOverBoard') {
    startNewGame();
  }
});

nameEntryInput.addEventListener('input', () => {
  lastInputTime = Date.now();
  nameEntryInput.value = nameEntryInput.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
});

function startNewGame() {
  nameEntryInput.classList.remove('visible');
  loadBoard(0, { keepScore: false });
  state = 'playing';
}

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    leaderboardEntries = data.entries || [];
  } catch (err) {
    leaderboardEntries = [];
  }
}

async function submitScoreAndShowLeaderboard() {
  const name = nameEntryInput.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  nameEntryInput.classList.remove('visible');
  if (name.length > 0) {
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score }),
      });
      const data = await res.json();
      leaderboardEntries = data.entries || [];
    } catch (err) {
      await fetchLeaderboard();
    }
  } else {
    await fetchLeaderboard();
  }
  state = 'gameOverBoard';
  lastInputTime = Date.now();
}

// ---- Rendering ---------------------------------------------------------

function drawMaze(map) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, HUD_HEIGHT, canvas.width, MAP_ROWS * RTILE);

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const ch = grid[r][c];
      const x = c * RTILE, y = HUD_HEIGHT + r * RTILE;
      if (ch === '#') {
        ctx.fillStyle = map.wallColor;
        ctx.fillRect(x, y, RTILE, RTILE);
        ctx.strokeStyle = map.wallAccent;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2, y + 2, RTILE - 4, RTILE - 4);
      } else if (ch === '.') {
        drawCpPellet(ctx, x + RTILE / 2, y + RTILE / 2, RTILE);
      } else if (ch === 'o') {
        drawPowerPellet(ctx, x + RTILE / 2, y + RTILE / 2, RTILE, animClock * 4);
      }
    }
  }
}

function drawPlayer() {
  const x = player.col * RTILE + (player.dir ? DIRS[player.dir][0] * player.progress * RTILE : 0);
  const y = HUD_HEIGHT + player.row * RTILE + (player.dir ? DIRS[player.dir][1] * player.progress * RTILE : 0);
  const sprite = getPlayerSprite(player.dir || 'right', player.animFrame);
  ctx.drawImage(sprite, x, y, RTILE, RTILE);
}

function drawEnemies() {
  for (const e of enemies) {
    const x = e.col * RTILE + (e.dir ? DIRS[e.dir][0] * e.progress * RTILE : 0);
    const y = HUD_HEIGHT + e.row * RTILE + (e.dir ? DIRS[e.dir][1] * e.progress * RTILE : 0);
    let visualState = e.state;
    if (e.state === 'frightened' && frightenedTimer <= FRIGHTENED_FLASH_WINDOW) {
      visualState = Math.floor(frightenedTimer * 6) % 2 === 0 ? 'frightened' : 'frightened-flash';
    }
    const sprite = getEnemySprite(e.type, e.dir || 'down', e.animFrame, visualState);
    ctx.drawImage(sprite, x, y, RTILE, RTILE);
  }
}

function drawHud(map) {
  ctx.fillStyle = '#12121c';
  ctx.fillRect(0, 0, canvas.width, HUD_HEIGHT);
  ctx.strokeStyle = '#8b6f2a';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, HUD_HEIGHT - 3);

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5f0e6';
  ctx.font = `${18}px PressStart2P, monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(`CP ${score}`, 16, HUD_HEIGHT / 2);

  ctx.textAlign = 'center';
  ctx.font = `${13}px PressStart2P, monospace`;
  ctx.fillText(map.name, canvas.width / 2, HUD_HEIGHT / 2);

  const lifeSize = 22;
  const totalW = lives * (lifeSize + 6);
  let lx = canvas.width - 16 - totalW;
  for (let i = 0; i < lives; i++) {
    drawLifeIcon(ctx, lx, HUD_HEIGHT / 2 - lifeSize / 2, lifeSize);
    lx += lifeSize + 6;
  }
}

function drawPlayingScene() {
  const map = MAPS[currentMapIndex];
  drawMaze(map);
  drawEnemies();
  drawPlayer();
  drawHud(map);
}

function centerText(text, y, size, color) {
  ctx.fillStyle = color || '#f5f0e6';
  ctx.font = `${size}px PressStart2P, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, y);
}

function drawLeaderboardList(startY) {
  centerText('TOP 10', startY, 14, '#ffd54a');
  ctx.font = '11px PressStart2P, monospace';
  ctx.textAlign = 'center';
  let y = startY + 34;
  if (leaderboardEntries.length === 0) {
    ctx.fillStyle = '#a8a696';
    ctx.fillText('-- no scores yet --', canvas.width / 2, y);
    return;
  }
  leaderboardEntries.slice(0, 10).forEach((entry, i) => {
    ctx.fillStyle = i === 0 ? '#ffd54a' : '#f5f0e6';
    const rank = String(i + 1).padStart(2, '0');
    ctx.textAlign = 'left';
    ctx.fillText(`${rank}. ${entry.name}`, canvas.width / 2 - 180, y);
    ctx.textAlign = 'right';
    ctx.fillText(`${entry.score}`, canvas.width / 2 + 180, y);
    y += 24;
  });
}

function drawTitleScreen() {
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (logoLoaded) {
    const maxW = 260, maxH = 140;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    ctx.drawImage(logoImg, canvas.width / 2 - w / 2, 36, w, h);
  }

  centerText('CP-PACMAN', 210, 30, '#ffd54a');
  centerText('MESSE EDITION', 240, 12, '#a8a696');

  const blink = Math.floor(animClock * 2) % 2 === 0;
  if (blink) centerText('PRESS ANY KEY TO START', 300, 13, '#f5f0e6');

  drawLeaderboardList(360);
}

function drawGameOverEntryScreen() {
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  centerText('GAME OVER', canvas.height * 0.28, 26, '#c62828');
  centerText(`FINAL CP: ${score}`, canvas.height * 0.36, 14, '#f5f0e6');
  centerText('ENTER YOUR NAME', canvas.height * 0.46, 12, '#a8a696');
  centerText('(A-Z 0-9, MAX 12) - PRESS ENTER', canvas.height * 0.62, 9, '#a8a696');
}

function drawGameOverBoardScreen() {
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  centerText('GAME OVER', canvas.height * 0.14, 22, '#c62828');
  centerText(`FINAL CP: ${score}`, canvas.height * 0.21, 12, '#f5f0e6');
  drawLeaderboardList(canvas.height * 0.32);
  const blink = Math.floor(animClock * 2) % 2 === 0;
  if (blink) centerText('PRESS ANY KEY FOR NEW GAME', canvas.height * 0.9, 11, '#f5f0e6');
}

function drawBoardClearScreen() {
  drawPlayingScene();
  ctx.fillStyle = 'rgba(5, 5, 10, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  centerText('BOARD CLEAR! +1000', canvas.height / 2, 20, '#ffd54a');
}

function drawResetPauseScreen() {
  drawPlayingScene();
  ctx.fillStyle = 'rgba(5, 5, 10, 0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  centerText('OUCH!', canvas.height / 2, 22, '#c62828');
}

// ---- Main loop -----------------------------------------------------------

let lastTime = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(frame);
}

function update(dt) {
  switch (state) {
    case 'title':
      animClock += dt;
      break;
    case 'playing':
      updatePlaying(dt);
      break;
    case 'resetPause':
      pauseTimer -= dt;
      if (pauseTimer <= 0) {
        resetPositions();
        state = 'playing';
      }
      break;
    case 'boardClear':
      pauseTimer -= dt;
      if (pauseTimer <= 0) {
        loadBoard((currentMapIndex + 1) % MAPS.length);
        state = 'playing';
      }
      break;
    case 'gameOverEntry':
      animClock += dt;
      if (Date.now() - lastInputTime > IDLE_TIMEOUT * 1000) {
        nameEntryInput.classList.remove('visible');
        state = 'title';
        fetchLeaderboard();
      }
      break;
    case 'gameOverBoard':
      animClock += dt;
      if (Date.now() - lastInputTime > IDLE_TIMEOUT * 1000) {
        state = 'title';
      }
      break;
  }
}

function render() {
  switch (state) {
    case 'title':
      drawTitleScreen();
      break;
    case 'playing':
      drawPlayingScene();
      break;
    case 'resetPause':
      drawResetPauseScreen();
      break;
    case 'boardClear':
      drawBoardClearScreen();
      break;
    case 'gameOverEntry':
      drawGameOverEntryScreen();
      break;
    case 'gameOverBoard':
      drawGameOverBoardScreen();
      break;
  }
}

async function init() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.load('16px PressStart2P'); await document.fonts.ready; } catch (err) { /* ignore */ }
  }
  await fetchLeaderboard();
  loadBoard(0, { keepScore: false });
  state = 'title';
  requestAnimationFrame(frame);
}

init();
