const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_ENTRIES_STORED = 100;
const TOP_N = 10;

// Session-only leaderboard: held in memory, so restarting or reopening the
// server starts with a clean board. Nothing is written to disk.
let entries = [];

function topEntries(n) {
  return [...entries].sort((a, b) => b.score - a.score).slice(0, n);
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/leaderboard', (req, res) => {
  res.json({ entries: topEntries(TOP_N) });
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

  entries.push({ name, score, timestamp: new Date().toISOString() });
  entries = topEntries(MAX_ENTRIES_STORED);

  res.json({ entries: topEntries(TOP_N) });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CP-Pacman server running at http://localhost:${PORT}`);
});
