// The database. Hosted, it is a Turso database (TURSO_DATABASE_URL +
// TURSO_AUTH_TOKEN), which survives the host restarting or sleeping. Without
// those settings - e.g. on a laptop - it is a local SQLite file,
// data/event.db, through the same client library.
//
// Usage (everything is async):
//   await db.get(sql, ...args)   first row as an object, or undefined
//   await db.all(sql, ...args)   all rows as objects
//   await db.run(sql, ...args)
//   await db.transaction(async (tx) => { ... tx.get / tx.all / tx.run ... })
//   await init()                 create tables, migrate, seed - once at startup
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// Forgive the usual copy-paste slips in the hosting settings: spaces,
// quotes, and the address without "libsql://" in front.
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim();
let remote = clean(process.env.TURSO_DATABASE_URL);
if (/^eyJ/.test(remote)) {
  // Turso tokens start with "eyJ"; addresses never do
  throw new Error('TURSO_DATABASE_URL holds the Turso token, not the database address. Swap the two settings.');
}
if (remote && !/^[a-z]+:\/\//i.test(remote)) remote = 'libsql://' + remote;
let url = remote;
if (!remote) {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  url = 'file:' + path.join(dataDir, 'event.db');
}
let client;
try {
  client = createClient({ url, authToken: clean(process.env.TURSO_AUTH_TOKEN) || undefined });
} catch (e) {
  console.error(
    '\nTURSO_DATABASE_URL is not a database address. It should look like\n' +
    '  libsql://your-database-name-yourname.turso.io\n' +
    '(Turso dashboard -> your database -> URL). Check it is not the token.\n'
  );
  throw e;
}

// get/all/run against the client or an open transaction
function queries(ex) {
  const all = async (sql, ...args) => {
    const rs = await ex.execute({ sql, args });
    return rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));
  };
  return {
    all,
    get: async (sql, ...args) => (await all(sql, ...args))[0],
    run: (sql, ...args) => ex.execute({ sql, args }),
  };
}

const db = queries(client);

// Runs fn(tx) as one write transaction. Transactions also run one at a time
// in this process (the app is a single server), so a "read, decide, write"
// step such as claiming the next finish rank can never interleave with
// another request's.
let queue = Promise.resolve();
db.transaction = (fn) => {
  const run = queue.then(async () => {
    const tx = await client.transaction('write');
    try {
      const result = await fn(queries(tx));
      await tx.commit();
      return result;
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  });
  queue = run.catch(() => {});
  return run;
};

async function init() {
  // lets reads carry on while a write is in progress (a local file only;
  // Turso handles this itself)
  if (!remote) await client.execute('PRAGMA journal_mode = WAL');

  await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS progress (
  participant_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, milestone_id)
);

-- Prize tiers by finish rank. Tiers sit back to back starting at rank 1.
-- The first tier is also the lucky-draw group; everyone after the last
-- tier gets a thank-you note. Seeded once below and editable by the admin.
CREATE TABLE IF NOT EXISTS reward_tiers (
  id INTEGER PRIMARY KEY,
  from_rank INTEGER NOT NULL,
  to_rank INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT
);

-- The raffle-draw pool for the first tier: each finisher in that tier
-- draws one prize at random from what is left. grand = 1 marks the grand
-- prize; image is an optional picture of the voucher (a path under public/).
CREATE TABLE IF NOT EXISTS pool_prizes (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  qty INTEGER NOT NULL,
  grand INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  order_index INTEGER NOT NULL
);

-- Small key/value settings: collect_message (how to collect a prize),
-- thanks_message, and prize_rules (which version of the prize rules the
-- tiers and pool were seeded for).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

  // --- migration: add columns that later features need to an existing
  // database, so an older event.db keeps working. ---
  const addColumn = async (table, name, type) => {
    const cols = (await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
    if (!cols.includes(name)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  };
  await addColumn('participants', 'finish_rank', 'INTEGER');
  // the prize a raffle-draw finisher drew: which pool prize, a snapshot of
  // its name and picture, and 1 if it was the grand prize
  await addColumn('participants', 'prize_id', 'INTEGER');
  await addColumn('participants', 'prize_label', 'TEXT');
  await addColumn('participants', 'prize_image', 'TEXT');
  await addColumn('participants', 'prize_main', 'INTEGER');
  await addColumn('milestones', 'title_ar', 'TEXT');
  await addColumn('reward_tiers', 'image', 'TEXT');

  // Seed default milestones only if the table is empty, so an admin's
  // edits are never overwritten on restart.
  if ((await db.get('SELECT COUNT(*) AS c FROM milestones')).c === 0) {
    const defaults = [
      ['start', 0, 'Start', 'البداية', 'Every story starts on the first page.'],
      ['m1', 1, 'From DEWA Knowledge Centers to Your Bookshelf', 'من مراكز المعرفة في ديوا إلى مكتبتك', null],
      ['m2', 2, 'Letter in 360: VR Experience', 'الرسائل بتقنية 360° – تجربة الواقع الافتراضي', null],
      ['m3', 3, 'A Mark to Remember: Design Your Own Bookmark', 'علامة للذكرى: صمّم فاصل كتابك الخاص', null],
      ['m4', 4, 'Letters (From To)', 'الرسائل (من – إلى)', null],
      ['m5', 5, 'Guess the Book Activity', 'فعالية خَمّن الكتاب', null],
      ['m6', 6, 'Fill in the Blanks Activity', 'فعالية أكمل الفراغات', null],
      ['m7', 7, 'Alphabets Challenge Activity', 'فعالية تحدي الحروف', null],
      ['finish', 8, 'The End', 'النهاية', 'You read the whole story - well done!'],
    ];
    await db.transaction(async (tx) => {
      for (const r of defaults) {
        await tx.run('INSERT INTO milestones (id, order_index, title, title_ar, description, icon) VALUES (?, ?, ?, ?, ?, NULL)', ...r);
      }
    });
  }

  // Prize rules (version 3):
  //   tier 1, ranks 1-10:  the raffle draw. Each finisher draws at random
  //                        from the pool: 1 Money Voucher (grand prize),
  //                        3 Petrol vouchers, 6 Coffee vouchers; see
  //                        drawPoolPrize() in server.js. Any places beyond
  //                        the pool get the tier's own prize.
  //   tier 2, ranks 11-32: a coffee voucher each (with the voucher image).
  //   rank 33 onward:      a thank-you note.
  // Seeded once. A database seeded for an earlier version of the rules is
  // switched over once, clearing any prizes drawn under those rules; the
  // server then draws again for anyone already finished in tier 1.
  const COFFEE_IMAGE = '/shared/coffee-voucher.jpg';
  const rules = await db.get("SELECT value FROM settings WHERE key = 'prize_rules'");
  if (!rules || rules.value !== '3') {
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM reward_tiers');
      const tier = 'INSERT INTO reward_tiers (id, from_rank, to_rank, label, description, image) VALUES (?, ?, ?, ?, ?, ?)';
      await tx.run(tier, 1, 1, 10, 'Coffee voucher', null, COFFEE_IMAGE);
      await tx.run(tier, 2, 11, 32, 'Coffee voucher', null, COFFEE_IMAGE);
      await tx.run('DELETE FROM pool_prizes');
      const prize = 'INSERT INTO pool_prizes (id, label, qty, grand, image, order_index) VALUES (?, ?, ?, ?, ?, ?)';
      await tx.run(prize, 1, 'Money Voucher', 1, 1, null, 0);
      await tx.run(prize, 2, 'Petrol voucher', 3, 0, null, 1);
      await tx.run(prize, 3, 'Coffee voucher', 6, 0, COFFEE_IMAGE, 2);
      await tx.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('collect_message', 'Please visit the reception area to collect your reward.')");
      // keep a thank-you note the admin already wrote
      await tx.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('thanks_message', 'Thank you for reading the whole story with us. We hope you enjoyed the festival!')");
      await tx.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('prize_rules', '3')");
      await tx.run('UPDATE participants SET prize_id = NULL, prize_label = NULL, prize_image = NULL, prize_main = NULL');
    });
  }
}

module.exports = { db, init, where: remote ? 'Turso' : url };
