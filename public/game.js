// CP-Pacman core engine (revamped).

const RTILE = 28;
const HUD_HEIGHT = 60;
const SPRITE = Math.round(RTILE * 1.62);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = MAP_COLS * RTILE;
canvas.height = MAP_ROWS * RTILE + HUD_HEIGHT;

// ---- constants -------------------------------------------------------

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const KEY_TO_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

const PLAYER_SPEED = 6.7;         // tiles/sec
const ENEMY_BASE = 0.88;
const ENEMY_STEP = 0.025;
const ENEMY_CAP = 1.08;
const FRIGHT_SPEED = 0.55;
const EATEN_SPEED = 2.2;
const TURN_TOL = 0.32;

const FRIGHT_START = 9;
const FRIGHT_DECAY = 0.4;
const FRIGHT_MIN = 4;
const FLASH_WINDOW = 2;

const RELEASE = { prof1: 0, prof2: 1.5, pruefung1: 3, pruefung2: 4.5 };
const TOTAL_LEVELS = 3;

// Classic scatter/chase waves: enemies periodically break off to their own
// corners so they spread across the maze instead of trailing the player in
// one clump. Direction reversal on each switch signals the change.
const WAVES = [
  { dur: 6, mode: 'scatter' }, { dur: 18, mode: 'chase' },
  { dur: 6, mode: 'scatter' }, { dur: 18, mode: 'chase' },
  { dur: 4, mode: 'scatter' }, { dur: Infinity, mode: 'chase' },
];
const SCATTER_TARGETS = {
  prof1: { col: 25, row: 1 }, prof2: { col: 2, row: 1 },
  pruefung1: { col: 25, row: 29 }, pruefung2: { col: 2, row: 29 },
};
const ELROY_PELLETS = 50;          // prof1 stops scattering below this
const ELROY_PELLETS_2 = 20;        // ...and gets a second speed bump here
const EXTRA_LIFE_AT = 5000;
const READY_TIME = 2.2;
const DEATH_TIME = 1.5;
const BOARD_CLEAR_TIME = 2.6;
const IDLE_TIMEOUT = 30;
const BONUS_EVERY = 60;           // a bonus item spawns every N pellets eaten
const BONUS_LIFETIME = 9;

// ---- state -----------------------------------------------------------

let state = 'title';
let grid = null, mazeImg = null, map = null;
let mapIndex = 0, boardsCleared = 0, semester = 1;
let score = 0, lives = 3;
let frightDuration = FRIGHT_START, frightActive = false, frightTimer = 0, frightMax = FRIGHT_START, chain = 0;
let boardTimer = 0, phaseTimer = 0, animClock = 0;
let pelletsEaten = 0, totalPellets = 0, bonusesSpawned = 0;
let player = null, enemies = [], particles = [], floaters = [];
let bonus = null;
let hitstop = 0, shake = 0;
let waveIndex = 0, waveTimer = 0, mode = 'scatter';
let pelletsLeft = 999, extraLifeGiven = false;
let lastInput = Date.now();
let leaderboard = [];

// ---- DOM -------------------------------------------------------------

const el = (id) => document.getElementById(id);
const overlays = ['titleScreen', 'controlsScreen', 'howScreen', 'settingsScreen', 'pauseScreen', 'gameOverScreen'];
const playControls = el('playControls');
const nameEntry = el('nameEntry');

function showOverlay(id) {
  overlays.forEach((o) => el(o).classList.toggle('hidden', o !== id));
  playControls.classList.toggle('hidden', id !== null);
}

const logoImg = new Image();
logoImg.src = 'assets/ui/logo.webp';

// inline speaker icons (no emoji)
const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M15.5 8.5a4 4 0 010 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

// ---- grid helpers ----------------------------------------------------

function isOpen(col, row) {
  if (row < 0 || row >= MAP_ROWS) return false;
  const c = ((col % MAP_COLS) + MAP_COLS) % MAP_COLS;
  return grid[row][c] !== '#';
}
function wrapCol(c) { return ((c % MAP_COLS) + MAP_COLS) % MAP_COLS; }
// The player may never walk into the ghost house (only eaten enemies re-enter).
function isOpenForPlayer(col, row) { return isOpen(col, row) && !needsExit(col, row); }
function px(x) { return (x + 0.5) * RTILE; }
function py(y) { return HUD_HEIGHT + (y + 0.5) * RTILE; }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// ---- board loading ---------------------------------------------------

function parseGrid(m) { return m.grid.map((r) => r.split('')); }

function findAndClear(g, ch) {
  const out = [];
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (g[r][c] === ch) { out.push({ col: c, row: r }); g[r][c] = ' '; }
  return out;
}
function countPellets() {
  let n = 0;
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (grid[r][c] === '.' || grid[r][c] === 'o') n++;
  return n;
}
function enemySpeedFactor() { return Math.min(ENEMY_CAP, ENEMY_BASE + boardsCleared * ENEMY_STEP); }

function makeEnemy(type, home) {
  return { type, homeTile: home, x: home.col, y: home.row, dir: null,
    state: 'waiting', releaseAt: RELEASE[type], animFrame: 0, animTimer: 0, lastCell: null };
}

function findBonusTile() {
  // random open corridor tile, away from the player and outside the house,
  // so every bonus shows up somewhere new
  const cands = [];
  for (let r = 1; r < MAP_ROWS - 1; r++) {
    for (let c = 1; c < MAP_COLS - 1; c++) {
      const ch = grid[r][c];
      if (ch !== '.' && ch !== ' ') continue;
      if (needsExit(c, r)) continue;
      if (dist2(c, r, player.x, player.y) < 64) continue;   // >= 8 tiles away
      cands.push({ col: c, row: r });
    }
  }
  if (!cands.length) return { col: 13, row: 22 };
  return cands[Math.floor(Math.random() * cands.length)];
}

function placePowerNear(g, r, c) {
  for (let rad = 0; rad < 4; rad++)
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr > 0 && rr < MAP_ROWS - 1 && cc > 0 && cc < MAP_COLS - 1 && g[rr][cc] === '.') { g[rr][cc] = 'o'; return; }
      }
}

// Extra Freiversuch pellets beyond the four corners, kept left/right symmetric.
function addExtraPower(g) {
  for (const [r, c] of [[16, 1], [10, 1]]) { placePowerNear(g, r, c); placePowerNear(g, r, MAP_COLS - 1 - c); }
}

function loadBoard(index, freshGame) {
  mapIndex = index;
  map = MAPS[mapIndex];
  grid = parseGrid(map);
  addExtraPower(grid);

  const p = findAndClear(grid, 'P')[0];
  const homes = { 1: findAndClear(grid, '1')[0], 2: findAndClear(grid, '2')[0],
    3: findAndClear(grid, '3')[0], 4: findAndClear(grid, '4')[0] };

  player = { x: p.col, y: p.row, dir: null, want: null, startTile: p,
    animFrame: 0, animTimer: 0, moving: false };
  enemies = [makeEnemy('prof1', homes[1]), makeEnemy('prof2', homes[2]),
    makeEnemy('pruefung1', homes[3]), makeEnemy('pruefung2', homes[4])];

  mazeImg = prerenderMaze(grid, map, RTILE, MAP_ROWS, MAP_COLS);
  totalPellets = countPellets();
  pelletsLeft = totalPellets;
  bonus = null;
  particles = []; floaters = [];
  boardTimer = 0; frightActive = false; frightTimer = 0; chain = 0;
  waveIndex = 0; waveTimer = 0; mode = WAVES[0].mode;

  if (freshGame) {
    score = 0; lives = 3; boardsCleared = 0; semester = 1;
    frightDuration = FRIGHT_START; pelletsEaten = 0; bonusesSpawned = 0;
    extraLifeGiven = false;
  }
}

function resetActors() {
  player.x = player.startTile.col; player.y = player.startTile.row;
  player.dir = null; player.want = null;
  for (const e of enemies) {
    e.x = e.homeTile.col; e.y = e.homeTile.row;
    e.dir = null; e.state = 'waiting'; e.lastCell = null;
  }
  boardTimer = 0; frightActive = false; frightTimer = 0; chain = 0;
  waveIndex = 0; waveTimer = 0; mode = WAVES[0].mode;
}

// ---- movement --------------------------------------------------------

function moveMover(e, speed, dt, wantFn, pass) {
  pass = pass || isOpen;
  const step = speed * dt;
  const col = Math.round(e.x), row = Math.round(e.y);
  const want = wantFn(e, col, row);

  if (want) {
    if (e.dir && want === OPP[e.dir]) {
      e.dir = want;                                   // instant reversal
    } else if (want !== e.dir) {
      const nearCenter = Math.abs(e.x - col) <= Math.max(TURN_TOL, step) &&
                         Math.abs(e.y - row) <= Math.max(TURN_TOL, step);
      const [dx, dy] = DIRS[want];
      if ((nearCenter || !e.dir) && pass(col + dx, row + dy)) {
        e.x = col; e.y = row; e.dir = want;
      }
    }
  }
  if (!e.dir) return;

  const [dx, dy] = DIRS[e.dir];
  e.x += dx * step; e.y += dy * step;

  const cc = Math.round(e.x), cr = Math.round(e.y);
  if (!pass(cc + dx, cr + dy)) {                       // stop at wall centre
    if (dx > 0) e.x = Math.min(e.x, cc);
    if (dx < 0) e.x = Math.max(e.x, cc);
    if (dy > 0) e.y = Math.min(e.y, cr);
    if (dy < 0) e.y = Math.max(e.y, cr);
  }
  if (e.x < -0.5) e.x += MAP_COLS;
  else if (e.x > MAP_COLS - 0.5) e.x -= MAP_COLS;
}

function playerWant() { return player.want; }

// ---- enemy AI --------------------------------------------------------

function greedy(col, row, opts, target) {
  let best = opts[0], bd = Infinity;
  for (const d of opts) {
    const [dx, dy] = DIRS[d];
    const nc = wrapCol(col + dx), nr = row + dy;
    const dd = dist2(nc, nr, target.col, target.row);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

function reverseEnemies() {
  for (const e of enemies) {
    if (e.state !== 'normal' || !e.dir) continue;
    e.dir = OPP[e.dir];
    e.lastCell = null;
  }
}

function isElroy(e) { return e.type === 'prof1' && e.state === 'normal' && pelletsLeft < ELROY_PELLETS; }

function getTarget(e) {
  const pt = { col: Math.round(player.x), row: Math.round(player.y) };
  // scatter phase: everyone retreats to their own corner (except an elroy
  // prof1, who never stops hunting once the board is nearly cleared)
  if (mode === 'scatter' && !isElroy(e)) return SCATTER_TARGETS[e.type];
  switch (e.type) {
    case 'prof1': return pt;
    case 'prof2': {
      const d = player.dir || 'right';
      const [dx, dy] = DIRS[d];
      const t = { col: wrapCol(pt.col + dx * 4), row: pt.row + dy * 4 };
      return isOpen(t.col, t.row) ? t : pt;
    }
    case 'pruefung1': return pt;
    case 'pruefung2': {
      const d2 = dist2(e.x, e.y, pt.col, pt.row);
      return d2 > 64 ? pt : e.homeTile;
    }
    default: return pt;
  }
}

// Tiles that make up the ghost-house box (interior + the exit gap).
function needsExit(col, row) {
  return (row >= 14 && row <= 16 && col >= 12 && col <= 15) ||
         (row === 13 && (col === 13 || col === 14));
}
const HOUSE_EXIT = { col: 13, row: 10 };
const HOUSE_DOOR = { col: 13, row: 12 };   // corridor tile directly above the gap

// True shortest-path first step (BFS). Greedy tile-distance strands eaten
// enemies below the house, where every step toward the door looks "farther".
function bfsDir(fromCol, fromRow, target) {
  if (fromCol === target.col && fromRow === target.row) return null;
  const seen = new Uint8Array(MAP_COLS * MAP_ROWS);
  const q = [[fromCol, fromRow, null]];
  seen[fromRow * MAP_COLS + fromCol] = 1;
  for (let h = 0; h < q.length; h++) {
    const [c, r, first] = q[h];
    for (const d of ['up', 'down', 'left', 'right']) {
      const [dx, dy] = DIRS[d];
      const nc = wrapCol(c + dx), nr = r + dy;
      if (nr < 0 || nr >= MAP_ROWS || !isOpen(nc, nr)) continue;
      const idx = nr * MAP_COLS + nc;
      if (seen[idx]) continue;
      seen[idx] = 1;
      const f = first || d;
      if (nc === target.col && nr === target.row) return f;
      q.push([nc, nr, f]);
    }
  }
  return null;
}

function chooseEnemyDir(e, col, row) {
  const opts = ['up', 'down', 'left', 'right'].filter((d) => {
    const [dx, dy] = DIRS[d]; return isOpen(col + dx, row + dy);
  });
  if (!opts.length) return e.dir;
  let allowed = e.dir ? opts.filter((d) => d !== OPP[e.dir]) : opts;
  if (!allowed.length) allowed = opts;

  // While still inside the house (and not returning as eyes), steer to the exit.
  if (e.state !== 'eaten' && needsExit(col, row)) {
    return greedy(col, row, opts, HOUSE_EXIT);
  }

  // Once out, non-eaten enemies never walk back into the house (one-way door).
  if (e.state !== 'eaten') {
    const filtered = allowed.filter((d) => {
      const [dx, dy] = DIRS[d];
      return !needsExit(wrapCol(col + dx), row + dy);
    });
    if (filtered.length) allowed = filtered;
  }

  if (e.state === 'frightened') {
    const pt = { col: Math.round(player.x), row: Math.round(player.y) };
    const away = allowed.filter((d) => {
      const [dx, dy] = DIRS[d];
      return dist2(wrapCol(col + dx), row + dy, pt.col, pt.row) >= dist2(col, row, pt.col, pt.row);
    });
    const pool = away.length ? away : allowed;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (e.state === 'eaten') {
    // outside the house: BFS to the tile above the door (guaranteed arrival),
    // then drop down through the gap to the home slot
    if (!needsExit(col, row)) {
      const d = bfsDir(col, row, HOUSE_DOOR);
      if (d) return d;
    }
    return greedy(col, row, opts, e.homeTile);
  }
  // pruefung1 is only erratic while chasing; during scatter it heads home
  if (e.type === 'pruefung1' && mode !== 'scatter') {
    return Math.random() < 0.5 ? greedy(col, row, allowed, getTarget(e))
      : allowed[Math.floor(Math.random() * allowed.length)];
  }
  return greedy(col, row, allowed, getTarget(e));
}

function enemyWant(e, col, row) {
  const atCenter = Math.abs(e.x - col) < 0.12 && Math.abs(e.y - row) < 0.12;
  if (!atCenter) return e.dir;
  const key = col + ',' + row;
  if (e.lastCell === key && e.dir) return e.dir;
  e.lastCell = key;
  return chooseEnemyDir(e, col, row);
}

// ---- particles / floaters -------------------------------------------

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, color });
  }
}
function floatText(x, y, text, color) { floaters.push({ x, y, text, color, life: 1.1 }); }

// ---- playing update --------------------------------------------------

function updatePlaying(dt) {
  animClock += dt;
  // brief freeze for impact when a prof/klausur is eaten
  if (hitstop > 0) { hitstop -= dt; updateFx(dt); return; }
  boardTimer += dt;

  for (const e of enemies)
    if (e.state === 'waiting' && boardTimer >= e.releaseAt) e.state = 'normal';

  // scatter/chase wave clock (paused during Freiversuch, like the original)
  if (!frightActive) {
    waveTimer += dt;
    while (waveTimer >= WAVES[waveIndex].dur) {
      waveTimer -= WAVES[waveIndex].dur;
      waveIndex = Math.min(waveIndex + 1, WAVES.length - 1);
      mode = WAVES[waveIndex].mode;
      reverseEnemies();
    }
  }

  if (frightActive) {
    frightTimer -= dt;
    AudioEngine.frightPulse(dt, frightTimer / frightMax);
    if (frightTimer <= 0) {
      frightActive = false;
      AudioEngine.endFright();
      for (const e of enemies) if (e.state === 'frightened') e.state = 'normal';
    }
  }

  // player (blocked from entering the ghost house)
  moveMover(player, PLAYER_SPEED, dt, playerWant, isOpenForPlayer);
  player.moving = !!player.dir;
  if (player.moving) {
    player.animTimer += dt;
    if (player.animTimer > 0.08) { player.animTimer = 0; player.animFrame = (player.animFrame + 1) % 3; }
  } else {
    player.animFrame = 0;                        // mouth closes when standing still
  }

  // pellet pickup
  const pcol = Math.round(player.x), prow = Math.round(player.y);
  if (Math.abs(player.x - pcol) < 0.25 && Math.abs(player.y - prow) < 0.25) {
    const cell = grid[prow][pcol];
    if (cell === '.') {
      grid[prow][pcol] = ' '; score += 10; pelletsEaten++;
      AudioEngine.sfx.chomp();
      maybeBonus();
    } else if (cell === 'o') {
      grid[prow][pcol] = ' '; score += 50; pelletsEaten++;
      AudioEngine.sfx.power();
      triggerFright();
      burst(px(pcol), py(prow), '#ffcf33', 14);
      maybeBonus();
    }
  }

  // bonus pickup
  if (bonus) {
    bonus.life -= dt; bonus.age += dt;
    if (bonus.life <= 0) bonus = null;
    else if (dist2(player.x, player.y, bonus.col, bonus.row) < 0.4) {
      score += map.bonus.points;
      AudioEngine.sfx.bonus();
      floatText(px(bonus.col), py(bonus.row), '+' + map.bonus.points, '#7fffd4');
      burst(px(bonus.col), py(bonus.row), '#7fffd4', 16);
      bonus = null;
    }
  }

  // enemies
  const sf = enemySpeedFactor();
  for (const e of enemies) {
    if (e.state === 'waiting') continue;
    let sp = PLAYER_SPEED * sf;
    if (e.state === 'frightened') sp *= FRIGHT_SPEED;
    else if (e.state === 'eaten') sp *= EATEN_SPEED;
    // elroy: prof1 speeds up as the board empties
    if (isElroy(e)) sp *= pelletsLeft < ELROY_PELLETS_2 ? 1.14 : 1.07;
    // enemies take the tunnel slowly (classic), giving the player an escape route
    if (e.state !== 'eaten' && Math.round(e.y) === map.tunnelRow && (e.x < 4 || e.x > MAP_COLS - 5)) sp *= 0.6;
    moveMover(e, sp, dt, enemyWant);
    e.animTimer += dt;
    if (e.animTimer > 0.14) { e.animTimer = 0; e.animFrame = (e.animFrame + 1) % 2; }
    if (e.state === 'eaten' && Math.abs(e.x - e.homeTile.col) < 0.3 && Math.abs(e.y - e.homeTile.row) < 0.3) {
      e.state = 'normal'; e.lastCell = null;
    }
  }

  // collisions
  for (const e of enemies) {
    if (e.state === 'waiting') continue;
    if (dist2(player.x, player.y, e.x, e.y) < 0.36) {
      if (e.state === 'normal') { startDeath(); return; }
      if (e.state === 'frightened') {
        e.state = 'eaten'; e.lastCell = null;
        const pts = 200 * Math.pow(2, chain); chain++;
        score += pts;
        AudioEngine.sfx.eatGhost();
        floatText(px(e.x), py(e.y), 'BESTANDEN +' + pts, '#a8ca58');
        burst(px(e.x), py(e.y), '#a8ca58', 22);
        hitstop = 0.07;
      }
    }
  }

  updateFx(dt);

  // extra life once per game (booth crowd-pleaser)
  if (!extraLifeGiven && score >= EXTRA_LIFE_AT) {
    extraLifeGiven = true; lives++;
    AudioEngine.sfx.extraLife();
    floatText(px(player.x), py(player.y) - RTILE, '+1 LEBEN', '#a8ca58');
  }

  pelletsLeft = countPellets();
  if (pelletsLeft === 0) {
    score += 1000; boardsCleared++;
    frightActive = false; AudioEngine.endFright();
    AudioEngine.sfx.boardClear();
    state = 'boardClear'; phaseTimer = BOARD_CLEAR_TIME;
  }
}

function updateFx(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    floaters[i].y -= 22 * dt; floaters[i].life -= dt;
    if (floaters[i].life <= 0) floaters.splice(i, 1);
  }
}

function triggerFright() {
  frightActive = true; frightTimer = frightDuration; frightMax = frightDuration;
  frightDuration = Math.max(FRIGHT_MIN, frightDuration - FRIGHT_DECAY);
  AudioEngine.startFright();
  chain = 0;
  for (const e of enemies) {
    if (e.state === 'normal') {
      e.state = 'frightened'; e.lastCell = null;
      if (e.dir) e.dir = OPP[e.dir];
    }
  }
}

function maybeBonus() {
  if (bonus) return;                                   // one at a time
  if (pelletsEaten >= (bonusesSpawned + 1) * BONUS_EVERY) {
    bonusesSpawned++;
    const t = findBonusTile();
    bonus = { col: t.col, row: t.row, life: BONUS_LIFETIME, age: 0 };
    floatText(px(t.col), py(t.row) - RTILE * 0.9, map.bonus.label + '!', '#e8c170');
  }
}

function startDeath() {
  frightActive = false;
  AudioEngine.endFright();
  AudioEngine.sfx.death();
  burst(px(player.x), py(player.y), '#e8c170', 18);
  shake = 0.45;
  state = 'dying'; phaseTimer = DEATH_TIME;
}

function finishDeath() {
  lives--;
  if (lives <= 0) {
    gameOver();
  } else {
    resetActors();
    state = 'ready'; phaseTimer = READY_TIME;
  }
}

// ---- game flow -------------------------------------------------------

function startGame() {
  AudioEngine.unlock();
  AudioEngine.startMusic();
  loadBoard(0, true);
  state = 'controls';
  showOverlay('controlsScreen');
}

function beginRound() {
  AudioEngine.sfx.start();
  showOverlay(null);
  state = 'ready'; phaseTimer = READY_TIME;
}

function nextBoard() {
  mapIndex = (mapIndex + 1) % MAPS.length;
  semester++;
  pelletsEaten = 0; bonusesSpawned = 0;
  loadBoard(mapIndex, false);
  state = 'ready'; phaseTimer = READY_TIME;
}

function gameOver(won) {
  AudioEngine.stopMusic();
  if (won) AudioEngine.sfx.boardClear(); else AudioEngine.sfx.death();
  state = 'gameover';
  lastInput = Date.now();
  const title = el('gameOverTitle');
  title.textContent = won ? 'BACHELOR GESCHAFFT' : 'DURCHGEFALLEN';
  title.classList.toggle('fail', !won);
  title.classList.toggle('win', !!won);
  el('finalScore').textContent = score;
  el('nameEntryWrap').style.display = '';
  nameEntry.value = '';
  renderLeaderboard('gameOverLeaderboard', leaderboard);
  showOverlay('gameOverScreen');
  setTimeout(() => nameEntry.focus(), 50);
}

function quitToTitle() {
  AudioEngine.endFright();
  AudioEngine.stopMusic();
  state = 'title';
  fetchLeaderboard();
  showOverlay('titleScreen');
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    AudioEngine.sfx.pause();
    syncSettingsControls();
    showOverlay('pauseScreen');
  } else if (state === 'paused') {
    AudioEngine.sfx.unpause();
    state = 'playing';
    showOverlay(null);
  }
}

// ---- leaderboard -----------------------------------------------------

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    leaderboard = (await res.json()).entries || [];
  } catch (e) { leaderboard = []; }
  renderLeaderboard('titleLeaderboard', leaderboard);
}

function renderLeaderboard(id, entries) {
  const list = el(id);
  list.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'lb-empty'; li.textContent = 'noch keine Scores';
    list.appendChild(li); return;
  }
  const medals = ['gold', 'silver', 'bronze'];
  entries.slice(0, 10).forEach((en, i) => {
    const li = document.createElement('li');
    if (i < 3) li.className = 'top3';
    const badge = i < 3
      ? `<span class="medal ${medals[i]}">${i + 1}</span>`
      : `<span class="rank">${String(i + 1).padStart(2, '0')}</span>`;
    li.innerHTML = badge +
      `<span class="nm">${escapeHtml(en.name)}</span><span class="sc">${en.score}</span>`;
    list.appendChild(li);
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function submitScore() {
  const name = nameEntry.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  lastInput = Date.now();
  if (!name.length) { nameEntry.focus(); return; }     // need a name to save
  AudioEngine.sfx.menuSelect();
  try {
    const res = await fetch('/api/leaderboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score }),
    });
    leaderboard = (await res.json()).entries || [];
  } catch (e) { await fetchLeaderboard(); }
  el('nameEntryWrap').style.display = 'none';
  renderLeaderboard('gameOverLeaderboard', leaderboard);
  renderLeaderboard('titleLeaderboard', leaderboard);
}

// ---- rendering -------------------------------------------------------

function drawBoardBg() {
  const g = ctx.createLinearGradient(0, HUD_HEIGHT, 0, canvas.height);
  g.addColorStop(0, map.bgTop); g.addColorStop(1, map.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, HUD_HEIGHT, canvas.width, canvas.height - HUD_HEIGHT);
}

function drawPellets() {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const ch = grid[r][c];
      if (ch === '.') drawCpPellet(ctx, px(c), py(r), RTILE, animClock * 4 + c + r);
      else if (ch === 'o') drawPowerPellet(ctx, px(c), py(r), RTILE, animClock * 3);
    }
  }
}

function drawBonus() {
  if (!bonus) return;
  const blink = bonus.life > 2 || Math.floor(bonus.life * 6) % 2 === 0;
  if (!blink) return;
  const pop = Math.min(1, bonus.age / 0.3);
  const ease = pop * (2 - pop);                       // ease-out
  const size = RTILE * 1.15 * (0.3 + 0.7 * ease) * (1 + 0.06 * Math.sin(animClock * 4));
  drawShadow(px(bonus.col), py(bonus.row), 0.55);
  drawBonusIcon(ctx, map.bonus.icon, px(bonus.col), py(bonus.row), size);
}

function drawShadow(x, y, scale) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(x, y + SPRITE * 0.4, SPRITE * 0.28 * scale, SPRITE * 0.08 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(dyingT) {
  ctx.save();
  const x = px(player.x), y = py(player.y);
  if (dyingT == null) drawShadow(x, y, 1);
  if (dyingT != null) {
    ctx.globalAlpha = Math.max(0, dyingT);
    ctx.translate(x, y);
    ctx.rotate((1 - dyingT) * Math.PI * 2);
    ctx.translate(-x, -y);
  }
  const spr = getPlayerSprite(player.dir || 'right', player.animFrame, SPRITE);
  ctx.drawImage(spr, x - SPRITE / 2, y - SPRITE / 2, SPRITE, SPRITE);
  ctx.restore();
}

function enemyStateKey(e) {
  if (e.state === 'eaten') return 'eaten';
  if (e.state === 'frightened') {
    if (frightTimer <= FLASH_WINDOW && Math.floor(frightTimer * 6) % 2 === 0) return 'frightened-flash';
    return 'frightened';
  }
  return 'normal';
}

function drawEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    const x = px(e.x), y = py(e.y);
    // gentle idle bob, offset per enemy so they don't move in lockstep
    const bob = e.state === 'eaten' ? 0 : Math.sin(animClock * 6 + i * 1.7) * SPRITE * 0.03;
    if (e.state !== 'eaten') drawShadow(x, y, 0.9);
    const spr = getEnemySprite(e.type, e.dir || 'down', e.animFrame, enemyStateKey(e), SPRITE);
    ctx.drawImage(spr, x - SPRITE / 2, y - SPRITE / 2 + bob, SPRITE, SPRITE);
  }
}

function drawFx() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(RTILE * 0.34)}px "Press Start 2P", monospace`;
  for (const f of floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  ctx.fillStyle = '#0a0b18';
  ctx.fillRect(0, 0, canvas.width, HUD_HEIGHT);

  // bottom edge: Freiversuch countdown bar while active, plain accent line otherwise
  if (frightActive && frightMax > 0) {
    const w = canvas.width * Math.max(0, frightTimer / frightMax);
    const flashing = frightTimer <= FLASH_WINDOW && Math.floor(frightTimer * 6) % 2 === 0;
    ctx.fillStyle = '#20242f';
    ctx.fillRect(0, HUD_HEIGHT - 5, canvas.width, 5);
    ctx.fillStyle = flashing ? '#cf573c' : '#e8c170';
    ctx.fillRect(0, HUD_HEIGHT - 5, w, 5);
  } else {
    ctx.fillStyle = map.glow;
    ctx.fillRect(0, HUD_HEIGHT - 2, canvas.width, 2);
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '10px PressStart2P, monospace';
  ctx.fillStyle = '#8a93c8';
  ctx.fillText('CP', 16, 15);
  ctx.font = '16px PressStart2P, monospace';
  ctx.fillStyle = '#fff2c2';
  ctx.fillText(String(score), 16, 33);
  if (leaderboard.length) {
    ctx.font = '12px VT323, monospace';
    ctx.fillStyle = '#819796';
    ctx.fillText('REKORD ' + leaderboard[0].score, 16, 50);
  }

  ctx.textAlign = 'center';
  ctx.font = '13px PressStart2P, monospace';
  ctx.fillStyle = map.glow;
  ctx.fillText(map.name, canvas.width / 2, 22);
  ctx.font = '8px PressStart2P, monospace';
  ctx.fillStyle = '#9aa0c8';
  ctx.fillText('LEVEL ' + semester + '/' + TOTAL_LEVELS + ' · ' + map.subtitle, canvas.width / 2, 40);

  // lives
  const s = 26;
  let lx = canvas.width - 14 - lives * (s + 4);
  const glyph = getPlayerSprite('right', 2, s);
  for (let i = 0; i < lives; i++) { ctx.drawImage(glyph, lx, HUD_HEIGHT / 2 - s / 2, s, s); lx += s + 4; }
}

function centerBanner(text, sub, color) {
  const cy = HUD_HEIGHT + (canvas.height - HUD_HEIGHT) / 2;
  const pulse = 1 + 0.05 * Math.sin(animClock * 6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(4,5,14,0.6)';
  ctx.fillRect(0, cy - 46, canvas.width, sub ? 92 : 64);
  ctx.save();
  ctx.translate(canvas.width / 2, cy - (sub ? 12 : 0));
  ctx.scale(pulse, pulse);
  ctx.font = '22px PressStart2P, monospace';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
  if (sub) {
    ctx.font = '11px PressStart2P, monospace';
    ctx.fillStyle = '#e6e9ff';
    ctx.fillText(sub, canvas.width / 2, cy + 22);
  }
}

let vignetteG = null;
function drawVignette() {
  if (!vignetteG) {
    const cx = canvas.width / 2, cy = HUD_HEIGHT + (canvas.height - HUD_HEIGHT) / 2;
    vignetteG = ctx.createRadialGradient(cx, cy, canvas.width * 0.34, cx, cy, canvas.width * 0.74);
    vignetteG.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteG.addColorStop(1, 'rgba(0,0,0,0.34)');
  }
  ctx.fillStyle = vignetteG;
  ctx.fillRect(0, HUD_HEIGHT, canvas.width, canvas.height - HUD_HEIGHT);
}

function drawMazeDetails() {
  // thin accent frame around the play area, ties the board to the level colour
  ctx.save();
  ctx.strokeStyle = map.glow;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 2;
  roundRectPath(ctx, 3, HUD_HEIGHT + 3, canvas.width - 6, canvas.height - HUD_HEIGHT - 6, 10);
  ctx.stroke();
  ctx.restore();

  // ghost-house door: a light bar across the exit gap so the one-way door reads
  ctx.fillStyle = 'rgba(231,213,179,0.55)';
  ctx.fillRect(13 * RTILE + 2, HUD_HEIGHT + 13 * RTILE + 2, 2 * RTILE - 4, 4);

  // tunnel hints: pulsing chevrons pointing out of the wrap corridor
  const a = 0.25 + 0.2 * Math.sin(animClock * 3);
  const ty = HUD_HEIGHT + (map.tunnelRow + 0.5) * RTILE;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = map.glow;
  for (const s of [-1, 1]) {
    const bx = s === -1 ? RTILE * 0.9 : canvas.width - RTILE * 0.9;
    for (let i = 0; i < 2; i++) {
      const ox = bx + s * -i * RTILE * 0.38;
      ctx.beginPath();
      ctx.moveTo(ox, ty - RTILE * 0.22);
      ctx.lineTo(ox + s * -RTILE * 0.22, ty);
      ctx.lineTo(ox, ty + RTILE * 0.22);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function renderGame() {
  ctx.save();
  if (shake > 0) {
    const amp = 7 * (shake / 0.45);
    ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
  }
  drawBoardBg();
  ctx.drawImage(mazeImg, 0, HUD_HEIGHT);
  // board-clear: flash the walls bright (classic Pac-Man blink)
  if (state === 'boardClear' && Math.floor(phaseTimer * 6) % 2 === 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    ctx.drawImage(mazeImg, 0, HUD_HEIGHT);
    ctx.restore();
  }
  drawMazeDetails();
  drawPellets();
  drawBonus();
  drawFx();
  drawEnemies();
  if (state === 'dying') drawPlayer(phaseTimer / DEATH_TIME);
  else drawPlayer(null);
  drawVignette();
  drawHud();
  ctx.restore();

  if (state === 'ready') centerBanner('LEVEL ' + semester, map.name + ' · START IN ' + Math.max(1, Math.ceil(phaseTimer)), '#e8c170');
  else if (state === 'boardClear') centerBanner('GESCHAFFT!',
    boardsCleared >= TOTAL_LEVELS ? '+1000 CP · STUDIUM ABGESCHLOSSEN' : '+1000 CP · NAECHSTES LEVEL', '#a8ca58');
  else if (state === 'paused') { /* overlay handles it */ }
}

// ---- main loop -------------------------------------------------------

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  shake = Math.max(0, shake - dt);
  update(dt);
  if (['controls', 'ready', 'playing', 'paused', 'dying', 'boardClear'].includes(state) && grid) renderGame();
  requestAnimationFrame(frame);
}

function update(dt) {
  switch (state) {
    case 'controls':
      animClock += dt;
      break;
    case 'ready':
      animClock += dt; phaseTimer -= dt;
      if (phaseTimer <= 0) state = 'playing';
      break;
    case 'playing':
      updatePlaying(dt);
      break;
    case 'dying':
      animClock += dt; phaseTimer -= dt; updateFx(dt);
      if (phaseTimer <= 0) finishDeath();
      break;
    case 'boardClear':
      animClock += dt; phaseTimer -= dt;
      if (phaseTimer <= 0) { if (boardsCleared >= TOTAL_LEVELS) gameOver(true); else nextBoard(); }
      break;
    case 'gameover':
      if (Date.now() - lastInput > IDLE_TIMEOUT * 1000) quitToTitle();
      break;
  }
}

// ---- input & UI wiring ----------------------------------------------

window.addEventListener('keydown', (ev) => {
  lastInput = Date.now();
  if (state === 'controls') {
    if (KEY_TO_DIR[ev.key] || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); beginRound(); }
    return;
  }
  if (state === 'playing') {
    const d = KEY_TO_DIR[ev.key];
    if (d) { player.want = d; ev.preventDefault(); }
    if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') togglePause();
  } else if (state === 'paused') {
    if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') togglePause();
  } else if (state === 'gameover') {
    if (ev.key === 'Enter' && el('nameEntryWrap').style.display !== 'none') submitScore();
  }
});

nameEntry.addEventListener('input', () => {
  lastInput = Date.now();
  nameEntry.value = nameEntry.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
});

el('playBtn').addEventListener('click', () => { AudioEngine.sfx.menuSelect(); startGame(); });
el('startRoundBtn').addEventListener('click', () => { AudioEngine.sfx.menuSelect(); beginRound(); });
el('howBtn').addEventListener('click', () => { AudioEngine.unlock(); AudioEngine.sfx.menuMove(); showOverlay('howScreen'); });
el('settingsBtn').addEventListener('click', () => { AudioEngine.unlock(); AudioEngine.sfx.menuMove(); syncSettingsControls(); showOverlay('settingsScreen'); });
document.querySelector('.close-how').addEventListener('click', () => { AudioEngine.sfx.menuMove(); showOverlay('titleScreen'); });
document.querySelector('.close-settings').addEventListener('click', () => { AudioEngine.sfx.menuMove(); showOverlay('titleScreen'); });

el('pauseBtn').addEventListener('click', togglePause);
el('resumeBtn').addEventListener('click', togglePause);
el('quitBtn').addEventListener('click', () => { AudioEngine.sfx.menuSelect(); quitToTitle(); });
el('submitScore').addEventListener('click', submitScore);
el('againBtn').addEventListener('click', () => { AudioEngine.sfx.menuSelect(); startGame(); });
el('menuBtn').addEventListener('click', () => { AudioEngine.sfx.menuSelect(); quitToTitle(); });

el('muteBtn').addEventListener('click', () => {
  const s = AudioEngine.getSettings();
  const nowMuted = !(s.sfxMuted && s.musicMuted);
  AudioEngine.setSfxMuted(nowMuted); AudioEngine.setMusicMuted(nowMuted);
  syncSettingsControls();
});

// settings controls (title + pause share the AudioEngine)
function wireVol(sliderId, muteId, kind) {
  const slider = el(sliderId), mute = el(muteId);
  slider.addEventListener('input', () => {
    const v = slider.value / 100;
    if (kind === 'music') AudioEngine.setMusicVolume(v); else AudioEngine.setSfxVolume(v);
    syncSettingsControls();
  });
  mute.addEventListener('click', () => {
    const s = AudioEngine.getSettings();
    const m = kind === 'music' ? !s.musicMuted : !s.sfxMuted;
    if (kind === 'music') AudioEngine.setMusicMuted(m); else AudioEngine.setSfxMuted(m);
    AudioEngine.sfx.menuMove();
    syncSettingsControls();
  });
}
wireVol('musicVol', 'musicMute', 'music');
wireVol('sfxVol', 'sfxMute', 'sfx');
wireVol('pMusicVol', 'pMusicMute', 'music');
wireVol('pSfxVol', 'pSfxMute', 'sfx');

function syncSettingsControls() {
  const s = AudioEngine.getSettings();
  const set = (id, val) => { const e2 = el(id); if (e2) e2.value = val; };
  set('musicVol', Math.round(s.musicVolume * 100)); set('pMusicVol', Math.round(s.musicVolume * 100));
  set('sfxVol', Math.round(s.sfxVolume * 100)); set('pSfxVol', Math.round(s.sfxVolume * 100));
  const setMute = (id, muted) => {
    const e2 = el(id);
    if (e2) { e2.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON; e2.classList.toggle('muted', muted); }
  };
  setMute('musicMute', s.musicMuted); setMute('pMusicMute', s.musicMuted);
  setMute('sfxMute', s.sfxMuted); setMute('pSfxMute', s.sfxMuted);
  const mb = el('muteBtn');
  mb.innerHTML = (s.sfxMuted && s.musicMuted) ? SPEAKER_OFF : SPEAKER_ON;
}

// ---- init ------------------------------------------------------------

// little parade of the cast on the title screen, built from the live sprites
function buildCastRow() {
  const row = el('castRow');
  if (!row) return;
  const defs = [
    () => getPlayerSprite('right', 2, 96),
    () => getEnemySprite('prof1', 'down', 0, 'normal', 96),
    () => getEnemySprite('prof2', 'down', 0, 'normal', 96),
    () => getEnemySprite('pruefung1', 'down', 0, 'normal', 96),
    () => getEnemySprite('pruefung2', 'down', 1, 'normal', 96),
  ];
  row.innerHTML = '';
  for (const fn of defs) {
    const img = document.createElement('img');
    img.src = fn().toDataURL();
    img.alt = '';
    row.appendChild(img);
  }
}

async function init() {
  if (document.fonts && document.fonts.load) {
    try { await document.fonts.load('16px PressStart2P'); } catch (e) { /* ignore */ }
  }
  buildCastRow();
  await fetchLeaderboard();
  syncSettingsControls();
  showOverlay('titleScreen');
  requestAnimationFrame(frame);
}
init();
