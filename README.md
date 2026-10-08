# Event Journey

A two-way web platform for a live event: attendees follow a ribbon of books,
styled after the event poster, where each book opens when they visit that
physical station;
staff check them in by scanning each attendee's personal QR code.

## How it works

1. **Registration.** A generic QR code (printed or displayed at the entrance)
   points every attendee to `/register`. They enter their name and email and
   land on `/journey`, their personal journey page.
2. **The journey.** The page shows nine books on a winding bookmark ribbon
   (Start → the seven stages → The End), each named in English and
   Arabic. Stages can be visited in any order; the first required one not
   yet visited is marked "Go here next". Two stages are optional. The
   attendee's books open live as staff check them in, and a little robot
   (modelled on DEWA's service robot) glides along the ribbon to the book
   just opened.
   A **مفتاح المعرفة** tab on the right edge opens the treasure-box poster
   (`public/shared/knowledge-key.jpg`, Arabic, shown exactly as supplied,
   with its chest animated) - a side activity attendees can open and close
   any time.
3. **Check-in.** At each physical station, staff open `/admin/scan`, select
   which checkpoint they're staffing, and scan the QR code shown on the
   attendee's phone (`Show My Checkpoint Code` button on their journey page).
   A match checks that milestone off immediately - the attendee's own screen
   updates within a few seconds without them doing anything.
4. **Finish.** Once every required stage is checked off, the finish line
   completes automatically and the attendee's screen celebrates with confetti
   - and shows them their reward (see below). Optional stages can still be
   done after finishing; they don't change the finishing place.
5. **Dashboard.** `/admin/dashboard` gives staff a live list of every
   attendee and their progress.

## Rewards

Prizes go by finishing order:

| Finished | Prize |
|---|---|
| 1st-10th (the raffle draw) | A random prize from a pool of 1 Money Voucher (grand prize), 3 Petrol vouchers and 6 Coffee vouchers |
| 11th-32nd (the next 22) | Coffee voucher (shown with the voucher picture) |
| 33rd or later | A thank-you note |

**The raffle draw.** The moment someone in the first 10 finishes, a prize
is drawn for them at random from whatever is left in the pool, and it
leaves the pool. Their phone says "You have entered the raffle draw!" with
a **Reveal my prize** button; tapping it throws confetti and shows the
prize (with the voucher picture for coffee) and "Please visit the
reception area to collect your reward." Drawing this way gives each of
the first 10 the same chance of the grand prize whatever order they finish
in, and every prize in the pool is given out by the time the 10th person
finishes. Nobody presses a button to draw - not attendees, not staff.

People who finish 11th-32nd see their Coffee voucher (with its picture and
the same reception message) the moment they finish, and everyone after
that sees the thank-you note. 1st place is told "You are the first to
finish"; everyone else "You finished Nth".

Set this up from `/admin/rewards` before the event:
- **Raffle draw:** how many people are in the draw, and the **prize pool** -
  each prize's name and how many (a quantity can't go below how many have
  already been won). The page shows what is left in the pool and who won
  the grand prize.
- **Prize group:** the prize, an optional description, and how many
  people.
- **Messages:** how to collect a prize, and the thank-you note.
- The groups stay back to back, so making the raffle draw bigger pushes
  the prize group and the thank-you notes back too. Settle the sizes
  before people start finishing, because prizes are worked out from the
  current sizes.
- **Who finished** fills in live: the raffle draw (with the prize each
  person drew), the prize group, and the thank-you group. Staff use these
  to hand out the physical prizes.

The coffee voucher picture is `public/shared/coffee-voucher.jpg`; to use a
different picture, replace that file (same name) and redeploy.

Everything runs from one small Node/Express server. For the event it is
hosted for free on **Render**, with its data in a free **Turso** database
(see "Hosting for the event" below). On a laptop, with no Turso settings,
it keeps its data in a local SQLite file instead.

## Hosting for the event (Render + Turso, both free)

Why this setup: Render gives a fixed `https://….onrender.com` link that
restarts itself if anything goes wrong, but its free tier wipes its own
disk whenever it sleeps - so the data lives in Turso, a hosted
SQLite-compatible database that keeps it safe.

One-time setup:

1. **GitHub** - put this folder in a (private) GitHub repository.
2. **Turso** (turso.tech) - sign up, create a database (pick a European
   location, close to Render's Frankfurt), then copy its **URL**
   (`libsql://….turso.io`) and create a **token** for it.
3. **Render** (render.com) - sign up with GitHub, choose **New →
   Blueprint**, pick the repository. Render reads `render.yaml` and asks
   for `ADMIN_PASSWORD`, `RESET_PASSWORD`, `TURSO_DATABASE_URL` and
   `TURSO_AUTH_TOKEN`. `RESET_PASSWORD` is only for **Clear all
   registrations** - keep it to yourself; staff only need the admin
   password. (If it is left empty, the admin password works there too.)
   `SESSION_SECRET` is generated for you. After a few minutes the app is
   live at `https://knowledge-journey-….onrender.com`.
4. **UptimeRobot** (uptimerobot.com, free) - add an HTTP monitor for
   `https://<your link>/api/config` every 5 minutes. Render's free tier
   naps after 15 minutes without visitors and takes about a minute to wake;
   the monitor keeps it awake. (The free tier allows 750 hours a month -
   enough for this one service running all month.)

To change the app later, push to GitHub; Render redeploys by itself and the
data in Turso is untouched.

Attendee and staff links are then `https://<your link>/register` and
`https://<your link>/admin/login`. Before the event, clear the test data
with **Clear all registrations** at the bottom of `/admin/rewards`.

## Project layout

```
event-journey/
  server.js           Express server + all API routes
  db.js                Database setup (Turso, or a local file) and default data
  render.yaml          Render hosting settings
  data/event.db         Local database file (laptop only, gitignored)
  public/
    user/                Registration + journey (attendee-facing)
    admin/               Login, dashboard, scanner, poster, rewards (staff-facing)
    shared/theme.css      Shared theme
    shared/bookpath.js    The journey art (drawn in code, no image files)
    vendor/jsQR.js        Vendored QR-decoding library (no CDN needed)
    vendor/fonts/         Vendored fonts (open licence)
```

## Running it in VS Code

1. Install [Node.js](https://nodejs.org) 20 or newer if you don't have it.
2. Open this folder in VS Code.
3. Open a terminal (`` Ctrl+` ``) and install dependencies:
   ```
   npm install
   ```
4. Copy the environment template and edit it:
   ```
   cp .env.example .env
   ```
   Open `.env` and set:
   - `ADMIN_PASSWORD` - whatever password staff will use to log into `/admin`
   - `SESSION_SECRET` - any long random string
   - `BASE_URL` - see "Getting the registration QR right" below
5. Start the server:
   ```
   npm start
   ```
6. Visit `http://localhost:3000/register` (attendee side) and
   `http://localhost:3000/admin/login` (staff side).

Claude Code can also just run these same commands for you inside VS Code's
integrated terminal if you'd rather ask it to "install dependencies and
start the server."

## Getting the registration QR right

The QR code on `/admin/poster` encodes the address you opened the poster
on + `/register` - so open the poster through the public link (e.g. the
tunnel link) and the QR follows it, even if that link has changed. Only
when the poster is opened on the server laptop itself (`localhost`) does
it use `BASE_URL` instead. Attendees' phones need to be able to reach that
address, so:

- **Testing on your own laptop:** leave `BASE_URL=http://localhost:3000`.
- **Real event, phones on the same venue wifi as your laptop:** find your
  laptop's local IP (e.g. `192.168.1.42`) and set
  `BASE_URL=http://192.168.1.42:3000`. Make sure your laptop's firewall
  allows inbound connections on port 3000.
- **Deployed to a real server/host with HTTPS:** set `BASE_URL` to that
  public URL, e.g. `https://yourevent.example.com`.

Whenever you change `BASE_URL`, restart the server and reload `/admin/poster`
before printing or displaying the QR code.

## Customizing milestones

The stages are seeded into the database by `db.js`, in this order, between
the automatic Start (البداية) and The End (النهاية):

| # | Stage | Arabic | Scan |
|---|---|---|---|
| 1 | Letter in 360: VR Experience | الرسائل بتقنية 360° – تجربة الواقع الافتراضي | required |
| 2 | A Mark to Remember: Design Your Own Bookmark | علامة للذكرى: صمّم فاصل كتابك الخاص | optional, +1 book |
| 3 | Letters (From To) | الرسائل (من – إلى) | required |
| 4 | Get Abstract & DEWA Smart Library | جِت أبستراكت ومكتبة ديوا الذكية | required |
| 5 | The Panel Discussion | الجلسة الحوارية | optional, +1 book |
| 6 | From DEWA Knowledge Centers to Your Bookshelf | من مراكز المعرفة في ديوا إلى مكتبتك | required - the book stand |
| 7 | Survey | الاستبيان | required - answered on the phone, not scanned |

**The survey.** Once an attendee's other required stages are done, their
journey page shows the survey question ("What did you think of the event?
Share your thoughts.") with a text box and **Submit**. Submitting completes
the Survey stage - and the journey, if it was the last required stage. The
answers are on the admin **Survey** page, newest first, with a **Download
(CSV)** button for Excel. The question can be changed on `/admin/rewards`
under Messages.

**Optional stages and extra books.** Each optional stage an attendee does
earns them one extra book token. At the book stand (stage 6), the scan
result tells staff how many books to hand over - 1 plus any unused tokens -
and marks those tokens used. Someone who does an optional stage after
visiting the stand gets a token on their phone and comes back: a second
scan at the stand shows just the extra books still owed.

Each has an English `title` and an Arabic `title_ar`. Both appear on the
journey, in the "All stops" list and in the scanner's checkpoint dropdown.
On the journey, the English name wraps onto up to three lines and the
Arabic name onto up to two.

To rename them, either:
- Edit the `stages` list in `db.js` and raise its version number (the
  `'stages'` setting) so the server switches over on its next start, or
- Use the admin API while logged in as admin:
  `PUT /api/admin/milestones/m1` with
  `{ "title": "...", "titleAr": "...", "description": "..." }`.

Adding, removing or reordering stages is done the same way, in `db.js`;
the journey, dashboard and scanner all follow the `milestones` table.

## Security notes for the event

- The admin password is shared by all staff - anyone with it can see every
  attendee's name and email and mark check-ins. Treat it like a door code.
- An attendee's personal QR code is their unique identifier. If someone
  photographs another attendee's code, they could check that person in
  remotely - fine for a casual event, but avoid displaying anyone's QR code
  on a big screen.
- There's no way to "undo" a check-in from the UI today; if staff scan the
  wrong milestone, you'd need to clear it directly in the database (table
  `progress`) or ask Claude Code to add an "undo" button before the event.
- Hosted, attendee names and emails are stored in Turso (and pass through
  Render). Check that your organisation allows that for its events.

## Resetting between a test run and the real event

On `/admin/rewards`, at the bottom: enter the **reset password** (the
`RESET_PASSWORD` setting in Render, or the admin password if that isn't
set) and press **Clear all registrations**. This removes every registration, check-in and prize drawn,
so the real event starts from 1st place; stations and prize settings stay.
It works the same hosted or on a laptop.

To also go back to the default stations and prize settings on a laptop,
delete the local database file instead:

```
rm -f data/event.db data/event.db-shm data/event.db-wal     # Mac/Linux, Git Bash
del data\event.db data\event.db-shm data\event.db-wal   # Windows Command Prompt
```
Stop the server first (Ctrl+C) - Windows won't delete the file while it is open.

That starts fresh with the default stations and prize tiers next time the
server starts (they are only seeded into an empty database).
