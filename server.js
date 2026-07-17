const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_PATH = path.join(DATA_DIR, 'leaderboard.json');
const MAX_ENTRIES_STORED = 100;
const TOP_N = 10;

function ensureLeaderboardFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEADERBOARD_PATH)) {
    fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify({ entries: [] }, null, 2));
  }
}

function readLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch (err) {
    return { entries: [] };
  }
}

function writeLeaderboardAtomic(data) {
  const tmpPath = LEADERBOARD_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, LEADERBOARD_PATH);
}

function topEntries(data, n) {
  return [...data.entries]
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

ensureLeaderboardFile();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/leaderboard', (req, res) => {
  const data = readLeaderboard();
  res.json({ entries: topEntries(data, TOP_N) });
});

app.post('/api/leaderboard', (req, res) => {
  const name = sanitizeName(req.body && req.body.name);
  const score = Number(req.body && req.body.score);

  if (!name) {
    return res.status(400).json({ error: 'Invalid name: must be alphanumeric, 1-12 characters.' });
  }
  if (!Number.isFinite(score) || score < 0 || !Number.isInteger(score)) {
    return res.status(400).json({ error: 'Invalid score: must be a non-negative integer.' });
  }

  const data = readLeaderboard();
  data.entries.push({ name, score, timestamp: new Date().toISOString() });
  data.entries = topEntries(data, MAX_ENTRIES_STORED);
  writeLeaderboardAtomic(data);

  res.json({ entries: topEntries(data, TOP_N) });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CP-Pacman server running at http://localhost:${PORT}`);
});
