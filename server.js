// Minimal .env loader (avoids an extra dependency). Safe to skip if no .env file exists.
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && !process.env[m[1]]) {
      let val = (m[2] || '').trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      process.env[m[1]] = val;
    }
  }
}

const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { db, init, where } = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
// Render sets RENDER_EXTERNAL_URL to the app's public https address.
const BASE_URL = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Express 4 does not catch errors from async handlers; this passes them on
// to the error handler at the bottom instead of crashing the server.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- helpers ----------
// Helpers that touch the database take `q`: either `db`, or the `tx` of a
// transaction they are part of.

function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}
function verify(signed) {
  if (!signed || typeof signed !== 'string' || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  if (sig.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? value : null;
}

function requireAdmin(req, res, next) {
  const raw = req.cookies.admin_session;
  const value = verify(raw);
  if (!value) return res.status(401).json({ error: 'Not authenticated' });
  const [, expiresAt] = value.split('|');
  if (Date.now() > Number(expiresAt)) return res.status(401).json({ error: 'Session expired' });
  next();
}

function getMilestones(q) {
  return q.all('SELECT *, title_ar AS titleAr FROM milestones ORDER BY order_index ASC');
}

function getParticipantByToken(q, token) {
  return q.get('SELECT * FROM participants WHERE token = ?', String(token || ''));
}

async function getProgressSet(q, participantId) {
  const rows = await q.all('SELECT milestone_id, completed_at FROM progress WHERE participant_id = ?', participantId);
  const map = {};
  for (const r of rows) map[r.milestone_id] = r.completed_at;
  return map;
}

function completeMilestone(q, participantId, milestoneId) {
  return q.run(
    'INSERT OR IGNORE INTO progress (participant_id, milestone_id, completed_at) VALUES (?, ?, ?)',
    participantId, milestoneId, new Date().toISOString()
  );
}

// Assigns the next finish rank (1, 2, 3, ...) to a participant. Called
// inside the check-in transaction, so the "how many have finished so far"
// read and the write that claims the next rank happen as one atomic unit -
// safe even if two admins scan a final milestone for two different people
// at nearly the same moment.
async function claimFinishRank(tx, participantId, finishedAt) {
  const already = (await tx.get('SELECT COUNT(*) AS c FROM participants WHERE finish_rank IS NOT NULL')).c;
  const rank = already + 1;
  await tx.run('UPDATE participants SET finished_at = ?, finish_rank = ? WHERE id = ?', finishedAt, rank, participantId);
  return rank;
}

async function maybeAutoFinish(tx, participantId) {
  const milestones = await getMilestones(tx);
  const physical = milestones.filter((m) => m.order_index > 0 && m.order_index < milestones.length - 1);
  const finish = milestones[milestones.length - 1];
  const progress = await getProgressSet(tx, participantId);
  const allDone = physical.every((m) => progress[m.id]);
  if (allDone && finish && !progress[finish.id]) {
    await completeMilestone(tx, participantId, finish.id);
    await claimFinishRank(tx, participantId, new Date().toISOString());
    await drawPoolPrize(tx, participantId);
  }
}

function getTiers(q) {
  return q.all('SELECT * FROM reward_tiers ORDER BY from_rank ASC');
}

function getTierForRank(q, rank) {
  return q.get('SELECT * FROM reward_tiers WHERE ? BETWEEN from_rank AND to_rank', rank);
}

// The first tier (the one starting at rank 1) is the lucky-draw group.
function getDrawGroup(q) {
  return getTierForRank(q, 1);
}

// Everyone who finishes after the last tier gets a thank-you note.
async function thanksFromRank(q) {
  return (await q.get('SELECT COALESCE(MAX(to_rank), 0) + 1 AS r FROM reward_tiers')).r;
}

async function getSetting(q, key) {
  return (await q.get('SELECT value FROM settings WHERE key = ?', key)).value;
}

// Builds the { type, ... } reward summary for a participant row, or null
// if they haven't finished yet.
async function rewardView(q, p) {
  if (!p.finish_rank) return null;
  const rank = p.finish_rank;
  const tier = await getTierForRank(q, rank);
  if (!tier) return { type: 'thanks', rank, message: await getSetting(q, 'thanks_message') };
  if (tier.from_rank !== 1) {
    return { type: 'tier', rank, label: tier.label, description: tier.description };
  }
  const main = Boolean(p.prize_main);
  return {
    type: 'draw',
    rank,
    main,
    // the prize name recorded when they drew it
    label: p.prize_label || tier.label,
    description: main ? null : tier.description,
  };
}

async function participantView(q, p) {
  const [milestones, progress, reward] = await Promise.all([getMilestones(q), getProgressSet(q, p.id), rewardView(q, p)]);
  return {
    id: p.id,
    name: p.name,
    token: p.token,
    createdAt: p.created_at,
    finishedAt: p.finished_at,
    finishRank: p.finish_rank || null,
    reward,
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      titleAr: m.titleAr,
      description: m.description,
      icon: m.icon,
      orderIndex: m.order_index,
      completed: Boolean(progress[m.id]),
      completedAt: progress[m.id] || null,
    })),
  };
}

// Gives a finisher in the lucky-draw group a random prize from what is
// left of the group's pool: one main prize (raffle_prize_label, e.g. the
// money voucher) plus the tier's own prize for every other place. Drawing
// without replacement like this gives every place the same 1-in-N chance
// of the main prize, whatever order people finish in, and the main prize
// is always gone once the group is full. Runs once per person, at the
// moment they finish, inside a transaction, so two people finishing at the
// same instant can't both take the last main prize.
async function drawPoolPrize(tx, participantId) {
  const p = await tx.get('SELECT * FROM participants WHERE id = ?', participantId);
  const group = await getDrawGroup(tx);
  if (!p || p.prize_label || !p.finish_rank || !group || p.finish_rank > group.to_rank) return;
  const drawn = await tx.get(
    'SELECT COUNT(*) AS n, COALESCE(SUM(prize_main), 0) AS mains FROM participants WHERE prize_label IS NOT NULL AND finish_rank BETWEEN ? AND ?',
    group.from_rank, group.to_rank
  );
  const placesLeft = Math.max(1, group.to_rank - group.from_rank + 1 - drawn.n);
  const mainsLeft = Math.max(0, 1 - drawn.mains);
  const main = crypto.randomInt(placesLeft) < mainsLeft;
  await tx.run(
    'UPDATE participants SET prize_label = ?, prize_main = ? WHERE id = ?',
    main ? await getSetting(tx, 'raffle_prize_label') : group.label,
    main ? 1 : 0,
    participantId
  );
}

// Anyone in the group who finished before this rule existed (or if the
// server stopped between finishing and drawing) gets their draw now.
// Called once at startup.
async function drawMissingPrizes() {
  const group = await getDrawGroup(db);
  if (!group) return;
  const missing = await db.all(
    'SELECT id FROM participants WHERE prize_label IS NULL AND finish_rank BETWEEN ? AND ? ORDER BY finish_rank',
    group.from_rank, group.to_rank
  );
  for (const p of missing) await db.transaction((tx) => drawPoolPrize(tx, p.id));
}

// ---------- attendee API ----------

app.post('/api/register', route(async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !name.trim() || !email || !email.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!emailOk) return res.status(400).json({ error: 'Please enter a valid email.' });

  const id = uuidv4();
  const token = uuidv4();
  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO participants (id, name, email, token, created_at) VALUES (?, ?, ?, ?, ?)',
      id, name.trim(), email.trim().toLowerCase(), token, new Date().toISOString()
    );
    const start = (await getMilestones(tx))[0];
    if (start) await completeMilestone(tx, id, start.id);
  });

  res.json({ token, participant: await participantView(db, await getParticipantByToken(db, token)) });
}));

app.get('/api/me', route(async (req, res) => {
  const p = await getParticipantByToken(db, req.query.token);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ participant: await participantView(db, p) });
}));

app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text');
  try {
    const png = await QRCode.toBuffer(String(text), { width: 400, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(500).send('Failed to generate QR code');
  }
});

app.get('/api/config', (req, res) => {
  res.json({ baseUrl: BASE_URL });
});

// ---------- admin auth ----------

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const value = `admin|${expiresAt}`;
  res.cookie('admin_session', sign(value), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  const value = verify(req.cookies.admin_session);
  res.json({ authenticated: Boolean(value) && Date.now() <= Number(value.split('|')[1]) });
});

// ---------- admin API ----------

app.get('/api/admin/milestones', requireAdmin, route(async (req, res) => {
  res.json({ milestones: await getMilestones(db) });
}));

app.put('/api/admin/milestones/:id', requireAdmin, route(async (req, res) => {
  const { title, description } = req.body || {};
  const titleAr = req.body && (req.body.titleAr !== undefined ? req.body.titleAr : req.body.title_ar);
  const m = await db.get('SELECT * FROM milestones WHERE id = ?', req.params.id);
  if (!m) return res.status(404).json({ error: 'Milestone not found' });
  await db.run(
    'UPDATE milestones SET title = ?, title_ar = ?, description = ? WHERE id = ?',
    title || m.title,
    titleAr !== undefined ? titleAr : m.title_ar,
    description !== undefined ? description : m.description,
    req.params.id
  );
  res.json({ ok: true });
}));

app.get('/api/admin/participants', requireAdmin, route(async (req, res) => {
  const [participants, milestones, progressRows] = await Promise.all([
    db.all('SELECT * FROM participants ORDER BY created_at DESC'),
    getMilestones(db),
    db.all('SELECT participant_id, milestone_id FROM progress'),
  ]);
  const isStation = (m) => m.order_index > 0 && m.order_index < milestones.length - 1;
  const totalPhysical = milestones.filter(isStation).length;
  // everyone's progress in one query, not one query per person
  const done = new Set(progressRows.map((r) => `${r.participant_id}|${r.milestone_id}`));

  const result = participants.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    token: p.token,
    createdAt: p.created_at,
    finishedAt: p.finished_at,
    completed: milestones.filter((m) => isStation(m) && done.has(`${p.id}|${m.id}`)).length,
    total: totalPhysical,
    milestoneStatus: milestones.map((m) => ({ id: m.id, title: m.title, titleAr: m.titleAr, done: done.has(`${p.id}|${m.id}`) })),
  }));
  res.json({ participants: result, milestones });
}));

// ---------- admin: rewards ----------

app.get('/api/admin/rewards', requireAdmin, route(async (req, res) => {
  res.json({
    tiers: await getTiers(db),
    mainPrize: await getSetting(db, 'raffle_prize_label'),
    thanksMessage: await getSetting(db, 'thanks_message'),
  });
}));

// Saves one tier's label, description and size, then lays every tier
// back to back again from rank 1, so changing tier 1's size moves tier 2
// (and where the thank-you notes start) along with it.
function saveTier(tier, label, description, size) {
  return db.transaction(async (tx) => {
    await tx.run(
      'UPDATE reward_tiers SET label = ?, description = ?, to_rank = ? WHERE id = ?',
      label, description, tier.from_rank + size - 1, tier.id
    );
    let next = 1;
    for (const t of await getTiers(tx)) {
      const n = t.to_rank - t.from_rank + 1;
      await tx.run('UPDATE reward_tiers SET from_rank = ?, to_rank = ? WHERE id = ?', next, next + n - 1, t.id);
      next += n;
    }
  });
}

app.put('/api/admin/rewards/tiers/:id', requireAdmin, route(async (req, res) => {
  const tier = await db.get('SELECT * FROM reward_tiers WHERE id = ?', req.params.id);
  if (!tier) return res.status(404).json({ error: 'Not found' });
  const { label, description, count } = req.body || {};
  let size = tier.to_rank - tier.from_rank + 1;
  if (count !== undefined && count !== null && count !== '') {
    size = parseInt(count, 10);
    if (!(size >= 1)) return res.status(400).json({ error: 'How many people must be at least 1.' });
  }
  await saveTier(
    tier,
    label && label.trim() ? label.trim() : tier.label,
    description !== undefined ? description : tier.description,
    size
  );
  res.json({ ok: true, tiers: await getTiers(db) });
}));

app.put('/api/admin/rewards/settings', requireAdmin, route(async (req, res) => {
  const { mainPrize, thanksMessage } = req.body || {};
  if (mainPrize !== undefined && !String(mainPrize).trim()) return res.status(400).json({ error: 'A prize name is required.' });
  if (thanksMessage !== undefined && !String(thanksMessage).trim()) return res.status(400).json({ error: 'A thank-you message is required.' });
  const put = 'UPDATE settings SET value = ? WHERE key = ?';
  if (mainPrize !== undefined) await db.run(put, String(mainPrize).trim(), 'raffle_prize_label');
  if (thanksMessage !== undefined) await db.run(put, String(thanksMessage).trim(), 'thanks_message');
  res.json({ ok: true });
}));

app.get('/api/admin/winners', requireAdmin, route(async (req, res) => {
  const finisher = (p) => ({
    name: p.name,
    email: p.email,
    finishRank: p.finish_rank,
    finishedAt: p.finished_at,
    prizeLabel: p.prize_label,
    main: Boolean(p.prize_main),
  });
  const between = (from, to) =>
    db.all('SELECT * FROM participants WHERE finish_rank BETWEEN ? AND ? ORDER BY finish_rank ASC', from, to);

  const tiers = await getTiers(db);
  const thanksFrom = await thanksFromRank(db);
  res.json({
    tiers: await Promise.all(tiers.map(async (t) => ({
      id: t.id,
      label: t.label,
      fromRank: t.from_rank,
      toRank: t.to_rank,
      draw: t.from_rank === 1,
      people: (await between(t.from_rank, t.to_rank)).map(finisher),
    }))),
    mainPrize: await getSetting(db, 'raffle_prize_label'),
    thanksFromRank: thanksFrom,
    thanks: (await between(thanksFrom, Number.MAX_SAFE_INTEGER)).map(finisher),
  });
}));

// Wipes every registration, check-in and drawn prize - for clearing test
// data before the event. Stations and prize settings are kept. The body
// must say { confirm: 'RESET' }, so it can't happen by accident.
app.post('/api/admin/reset', requireAdmin, route(async (req, res) => {
  if ((req.body || {}).confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm.' });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM progress');
    await tx.run('DELETE FROM participants');
  });
  res.json({ ok: true });
}));

app.post('/api/admin/checkin', requireAdmin, route(async (req, res) => {
  const { token, milestoneId } = req.body || {};
  const p = await getParticipantByToken(db, token);
  if (!p) return res.status(404).json({ error: 'No attendee found for that QR code.' });
  const milestone = await db.get('SELECT * FROM milestones WHERE id = ?', String(milestoneId || ''));
  if (!milestone) return res.status(400).json({ error: 'Unknown milestone.' });
  if (milestone.order_index === 0) {
    return res.status(400).json({ error: 'The start point is marked automatically at registration.' });
  }

  // The whole check-in - the scan, and finishing with its rank and prize
  // draw if this was the last station - is one transaction.
  const alreadyDone = await db.transaction(async (tx) => {
    if ((await getProgressSet(tx, p.id))[milestoneId]) return true;
    await completeMilestone(tx, p.id, milestoneId);
    await maybeAutoFinish(tx, p.id);
    return false;
  });

  res.json({ ok: true, alreadyDone, participant: await participantView(db, await getParticipantByToken(db, token)) });
}));

// ---------- pages ----------

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/', (req, res) => res.redirect('/register'));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/user/register.html')));
app.get('/journey', (req, res) => res.sendFile(path.join(__dirname, 'public/user/journey.html')));
app.get('/admin', (req, res) => res.redirect('/admin/login'));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/login.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')));
app.get('/admin/scan', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/scan.html')));
app.get('/admin/poster', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/poster.html')));
app.get('/admin/rewards', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/rewards.html')));

// a database hiccup answers with an error instead of crashing the server
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

init()
  .then(drawMissingPrizes)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nEvent Journey server running:`);
      console.log(`  Local:    http://localhost:${PORT}`);
      console.log(`  Base URL for QR codes: ${BASE_URL}`);
      console.log(`  Database: ${where}`);
      console.log(`  Admin password loaded from ${process.env.ADMIN_PASSWORD ? 'settings' : '(default - set .env!)'}\n`);
    });
  })
  .catch((e) => {
    console.error('Could not open the database:', e);
    process.exit(1);
  });
