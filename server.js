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
// Clearing all registrations needs its own password, so staff who share
// the admin password can't do it. Falls back to the admin password.
const RESET_PASSWORD = (process.env.RESET_PASSWORD || '').trim() || ADMIN_PASSWORD;
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

// A station is any stage between the automatic start and finish.
function isStation(m, milestones) {
  return m.order_index > 0 && m.order_index < milestones.length - 1;
}

// Extra book tokens: one per optional stage done; some may already have
// been used at the book stand.
function tokenView(milestones, progress, p) {
  const earned = milestones.filter((m) => m.optional && progress[m.id]).length;
  const used = Math.min(earned, p.tokens_used || 0);
  return { earned, used, available: earned - used };
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
  const required = milestones.filter((m) => isStation(m, milestones) && !m.optional);
  const finish = milestones[milestones.length - 1];
  const progress = await getProgressSet(tx, participantId);
  const allDone = required.every((m) => progress[m.id]);
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
  const message = await getSetting(q, 'collect_message');
  if (tier.from_rank !== 1) {
    return { type: 'tier', rank, label: tier.label, description: tier.description, image: tier.image, message };
  }
  return {
    type: 'draw',
    rank,
    grand: Boolean(p.prize_main),
    // the prize name and picture recorded when they drew it
    label: p.prize_label || tier.label,
    image: p.prize_label ? p.prize_image : tier.image,
    message,
  };
}

// The survey question is answered on the phone once every other required
// stage is done; answering it completes the survey stage.
function surveyOpen(milestones, progress) {
  const survey = milestones.find((m) => m.survey);
  if (!survey || progress[survey.id]) return false;
  return milestones.every((m) => !isStation(m, milestones) || m.optional || m.survey || progress[m.id]);
}

async function participantView(q, p) {
  const [milestones, progress, reward, question] = await Promise.all([
    getMilestones(q), getProgressSet(q, p.id), rewardView(q, p), getSetting(q, 'survey_question'),
  ]);
  return {
    id: p.id,
    name: p.name,
    token: p.token,
    createdAt: p.created_at,
    finishedAt: p.finished_at,
    finishRank: p.finish_rank || null,
    reward,
    tokens: tokenView(milestones, progress, p),
    survey: { open: surveyOpen(milestones, progress), question },
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      titleAr: m.titleAr,
      description: m.description,
      icon: m.icon,
      orderIndex: m.order_index,
      optional: Boolean(m.optional),
      bookStand: Boolean(m.book_stand),
      survey: Boolean(m.survey),
      completed: Boolean(progress[m.id]),
      completedAt: progress[m.id] || null,
    })),
  };
}

// The raffle-draw pool, with how many of each prize are still undrawn.
function getPool(q) {
  return q.all(`SELECT pp.*, MAX(0, pp.qty - (SELECT COUNT(*) FROM participants p WHERE p.prize_id = pp.id)) AS remaining
    FROM pool_prizes pp ORDER BY order_index`);
}

// Gives a finisher in the raffle-draw group (tier 1) a random prize from
// what is left in the pool. Every remaining place in the group holds one
// prize - the pool's leftovers first, then the tier's own prize for any
// places beyond the pool - and the finisher gets one of those places at
// random. Drawing without replacement like this gives everyone in the
// group the same chance of the grand prize whatever order they finish in,
// and every pool prize is given out by the time the group is full. Runs
// once per person, at the moment they finish, inside a transaction, so two
// people finishing at the same instant can't both take the last of a prize.
async function drawPoolPrize(tx, participantId) {
  const p = await tx.get('SELECT * FROM participants WHERE id = ?', participantId);
  const group = await getDrawGroup(tx);
  if (!p || p.prize_label || !p.finish_rank || !group || p.finish_rank > group.to_rank) return;
  const drawn = (await tx.get(
    'SELECT COUNT(*) AS n FROM participants WHERE prize_label IS NOT NULL AND finish_rank BETWEEN ? AND ?',
    group.from_rank, group.to_rank
  )).n;
  const pool = await getPool(tx);
  const prizesLeft = pool.reduce((sum, x) => sum + x.remaining, 0);
  const placesLeft = Math.max(1, group.to_rank - group.from_rank + 1 - drawn, prizesLeft);
  let r = crypto.randomInt(placesLeft);
  const won = pool.find((x) => (r -= x.remaining) < 0);
  await tx.run(
    'UPDATE participants SET prize_id = ?, prize_label = ?, prize_image = ?, prize_main = ? WHERE id = ?',
    won ? won.id : null,
    won ? won.label : group.label,
    won ? won.image : group.image,
    won && won.grand ? 1 : 0,
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

app.post('/api/survey', route(async (req, res) => {
  const { token, answer } = req.body || {};
  const text = String(answer || '').trim();
  if (!text) return res.status(400).json({ error: 'Please write a few words before submitting.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Please keep it under 2000 characters.' });
  const p = await getParticipantByToken(db, token);
  if (!p) return res.status(404).json({ error: 'Not found' });
  // answering completes the survey stage, and finishes the journey (rank,
  // prize draw) if it was the last required stage - one transaction
  const error = await db.transaction(async (tx) => {
    const milestones = await getMilestones(tx);
    const survey = milestones.find((m) => m.survey);
    const progress = await getProgressSet(tx, p.id);
    if (!survey) return 'There is no survey.';
    if (progress[survey.id]) return null;   // already answered: nothing to do
    if (!surveyOpen(milestones, progress)) return 'Please visit the other required stops first.';
    await tx.run('INSERT OR REPLACE INTO feedback (participant_id, answer, created_at) VALUES (?, ?, ?)', p.id, text, new Date().toISOString());
    await completeMilestone(tx, p.id, survey.id);
    await maybeAutoFinish(tx, p.id);
    return null;
  });
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, participant: await participantView(db, await getParticipantByToken(db, token)) });
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
  const required = milestones.filter((m) => isStation(m, milestones) && !m.optional);
  // everyone's progress in one query, not one query per person
  const done = new Set(progressRows.map((r) => `${r.participant_id}|${r.milestone_id}`));

  const result = participants.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    token: p.token,
    createdAt: p.created_at,
    finishedAt: p.finished_at,
    completed: required.filter((m) => done.has(`${p.id}|${m.id}`)).length,
    total: required.length,
    milestoneStatus: milestones.map((m) => ({ id: m.id, title: m.title, titleAr: m.titleAr, optional: Boolean(m.optional), done: done.has(`${p.id}|${m.id}`) })),
  }));
  res.json({ participants: result, milestones });
}));

// ---------- admin: rewards ----------

app.get('/api/admin/rewards', requireAdmin, route(async (req, res) => {
  res.json({
    tiers: await getTiers(db),
    pool: await getPool(db),
    collectMessage: await getSetting(db, 'collect_message'),
    thanksMessage: await getSetting(db, 'thanks_message'),
    surveyQuestion: await getSetting(db, 'survey_question'),
  });
}));

// Renames a raffle-draw prize or changes how many are in the pool. The
// quantity can't go below how many have already been drawn.
app.put('/api/admin/rewards/pool/:id', requireAdmin, route(async (req, res) => {
  const prize = (await getPool(db)).find((x) => String(x.id) === req.params.id);
  if (!prize) return res.status(404).json({ error: 'Not found' });
  const { label, qty } = req.body || {};
  const drawn = prize.qty - prize.remaining;
  let n = prize.qty;
  if (qty !== undefined && qty !== null && qty !== '') {
    n = parseInt(qty, 10);
    if (!(n >= 0)) return res.status(400).json({ error: 'The quantity must be 0 or more.' });
    if (n < drawn) return res.status(400).json({ error: `${drawn} have already been won, so the quantity can't be lower than that.` });
  }
  await db.run(
    'UPDATE pool_prizes SET label = ?, qty = ? WHERE id = ?',
    label && label.trim() ? label.trim() : prize.label, n, prize.id
  );
  res.json({ ok: true, pool: await getPool(db) });
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
  const { collectMessage, thanksMessage, surveyQuestion } = req.body || {};
  if (surveyQuestion !== undefined && !String(surveyQuestion).trim()) return res.status(400).json({ error: 'A survey question is required.' });
  if (collectMessage !== undefined && !String(collectMessage).trim()) return res.status(400).json({ error: 'A collection message is required.' });
  if (thanksMessage !== undefined && !String(thanksMessage).trim()) return res.status(400).json({ error: 'A thank-you message is required.' });
  const put = 'UPDATE settings SET value = ? WHERE key = ?';
  if (collectMessage !== undefined) await db.run(put, String(collectMessage).trim(), 'collect_message');
  if (thanksMessage !== undefined) await db.run(put, String(thanksMessage).trim(), 'thanks_message');
  if (surveyQuestion !== undefined) await db.run(put, String(surveyQuestion).trim(), 'survey_question');
  res.json({ ok: true });
}));

app.get('/api/admin/winners', requireAdmin, route(async (req, res) => {
  const finisher = (p) => ({
    name: p.name,
    email: p.email,
    finishRank: p.finish_rank,
    finishedAt: p.finished_at,
    prizeLabel: p.prize_label,
    grand: Boolean(p.prize_main),
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
    pool: await getPool(db),
    thanksFromRank: thanksFrom,
    thanks: (await between(thanksFrom, Number.MAX_SAFE_INTEGER)).map(finisher),
  });
}));

// ---------- admin: survey feedback ----------

function getFeedback() {
  return db.all(`SELECT p.name, p.email, f.answer, f.created_at AS answeredAt
    FROM feedback f JOIN participants p ON p.id = f.participant_id ORDER BY f.created_at DESC`);
}

app.get('/api/admin/feedback', requireAdmin, route(async (req, res) => {
  res.json({ question: await getSetting(db, 'survey_question'), feedback: await getFeedback() });
}));

// The same answers as a spreadsheet (opens in Excel; the BOM keeps Arabic intact).
app.get('/api/admin/feedback.csv', requireAdmin, route(async (req, res) => {
  const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = (await getFeedback()).map((f) => [f.answeredAt, f.name, f.email, f.answer].map(cell).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="event-feedback.csv"');
  res.send('\uFEFF' + ['Answered at,Name,Email,Answer', ...rows].join('\r\n'));
}));

// Wipes every registration, check-in and drawn prize - for clearing test
// data before the event. Stations and prize settings are kept. Needs the
// reset password as well as an admin login.
function samePassword(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}
app.post('/api/admin/reset', requireAdmin, route(async (req, res) => {
  if (!samePassword((req.body || {}).password, RESET_PASSWORD)) {
    return res.status(403).json({ error: 'Wrong reset password.' });
  }
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM progress');
    await tx.run('DELETE FROM feedback');
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
  if (milestone.survey) {
    return res.status(400).json({ error: "The survey is answered on the attendee's own phone, not scanned." });
  }

  // The whole check-in - the scan, finishing with its rank and prize draw
  // if this was the last required station, and using up extra book tokens
  // at the book stand - is one transaction.
  const { alreadyDone, books } = await db.transaction(async (tx) => {
    const alreadyDone = Boolean((await getProgressSet(tx, p.id))[milestoneId]);
    if (!alreadyDone) {
      await completeMilestone(tx, p.id, milestoneId);
      await maybeAutoFinish(tx, p.id);
    }
    if (!milestone.book_stand) return { alreadyDone, books: null };
    // At the book stand: 1 book on the first visit, plus 1 per unused
    // token. Someone who earns a token later can come back for that book.
    const fresh = await tx.get('SELECT * FROM participants WHERE id = ?', p.id);
    const tokens = tokenView(await getMilestones(tx), await getProgressSet(tx, p.id), fresh);
    await tx.run('UPDATE participants SET tokens_used = ? WHERE id = ?', tokens.earned, p.id);
    return { alreadyDone, books: { total: (alreadyDone ? 0 : 1) + tokens.available, extra: tokens.available } };
  });

  res.json({ ok: true, alreadyDone, books, participant: await participantView(db, await getParticipantByToken(db, token)) });
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
app.get('/admin/feedback', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/feedback.html')));

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
