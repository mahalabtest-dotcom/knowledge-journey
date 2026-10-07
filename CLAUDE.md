# CLAUDE.md

Guidance for Claude Code (or any future Claude session) working in this repo.

## What this is

A two-way event platform used alongside a live, in-person event:

- **Attendees** register on their phone, then see their journey as a ribbon
  of books, one book per milestone, that open as they are visited. They physically walk to stations at the event;
  at each one, staff scan the attendee's personal QR code and that
  milestone lights up on the attendee's phone within a few seconds - no
  action needed from the attendee beyond showing their screen.
- **Admins/staff** log in on their own phone, pick which station they're
  running, and scan attendees' codes. They also have a live dashboard of
  everyone's progress, a poster page with the entrance QR that starts
  registration, and a rewards page (see below).
- **Stages** (set by the user 2026-10-07). Eight stages between an
  automatic start and finish, ten books in all, shown in this order: VR,
  Bookmark (optional), Letters, Get Abstract, DEWA Smart Library, Panel
  Discussion (optional), From DEWA Knowledge Centers (the book stand),
  Survey. Every stage has an English `title` and an Arabic `title_ar`.
  Stages can be visited in any order (the user chose this over a strict
  order). The journey finishes when the six required ones are done; each
  optional stage done earns one extra book token, used at the book stand.
- **Rewards.** By finish rank: each of the first 10 gets a prize drawn at
  random, the moment they finish, from a pool of 1 Money Voucher (grand
  prize), 3 Petrol vouchers and 6 Coffee vouchers (each draw leaves the
  pool); their phone shows "You have entered the raffle draw!" and a
  button that reveals it. 11-32 get a coffee voucher the instant they
  finish; 33 onward get a thank-you note.

**Everything runs on phones. There is no desktop/laptop layout to
maintain.** Every page in `public/` is designed mobile-first (narrow
single-column, `max-width` around 420-520px, large tap targets). When
adding or changing UI, design for a phone screen first and don't add
table-like or multi-column layouts that assume a wide viewport - the
dashboard was originally a `<table>` and had to be rebuilt as stacked
cards for exactly this reason (see `public/admin/dashboard.html`).

## Architecture

Plain Node/Express server + SQLite (via `@libsql/client`), vanilla
HTML/CSS/JS on the frontend. No build step, no frontend framework, no
bundler - fewer moving parts beats a "proper" framework setup.

**Hosting (chosen by the user, 2026-10-06): Render free tier + Turso free
tier.** A Cloudflare quick tunnel from a laptop was tried first and
rejected as unreliable (the link changed on every restart and dropped).
Vercel is blocked on the user's company network, and serverless hosts
can't keep the data anyway. Render's free disk is wiped whenever the
service sleeps or redeploys, so **nothing may be stored on the server's
disk** - all data lives in Turso (`TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`). Without those, `db.js` uses a local file
(`data/event.db`) through the same client, for laptop use and testing.
`render.yaml` is the Render Blueprint; README.md has the setup steps,
including an UptimeRobot ping to stop the free service napping. It must
stay a **single instance**: `db.transaction()` serialises transactions
in-process.

```
server.js      Express app: all routes (attendee API, admin API, page
                routes). Start here to see the whole request surface.
db.js          Database client (Turso or local file), async get/all/run,
                transaction(), and init(): tables, migrations, seeding.
render.yaml    Render Blueprint (free web service, Frankfurt).
data/event.db  Local SQLite file, laptop only (gitignored).

public/
  user/         Attendee-facing pages
    register.html   Name + email form -> POST /api/register
    journey.html     The journey page (shell + styles)
    journey.js       All the logic: fetch state, update the books,
                       poll every 4s, confetti, QR modal, rewards
  admin/        Staff-facing pages, all gated by requireAdminAuth()
    login.html        Password form -> POST /api/admin/login
    dashboard.html     Live participant list (card layout, not a table)
    scan.html           Checkpoint picker + camera scanner + manual entry
    poster.html         Displays/prints the entrance registration QR
    rewards.html         Edit the raffle draw (group size + prize
                           pool), prize group and messages, pool
                           status, live lists of who finished and what
                           they got, Clear all registrations
    admin-common.js    Shared nav bar + session check, loaded by every
                         admin page except login
  shared/theme.css   Shared theme (palette, fonts, buttons, cards)
  shared/bookpath.js The journey art: books, ribbon, scenery, backdrop
  vendor/fonts/      Vendored fonts + their open licences
  vendor/jsQR.js     Vendored QR-decoding library (not on npm client-side,
                       copied from the `jsqr` package's dist build so the
                       scanner works with no CDN/internet dependency)
```

## Data model

See `db.js` for the exact schema. Core tables:

- `participants` - id, name, email, a random `token` (this is what's
  encoded in the attendee's personal QR code and is their only
  credential), `created_at`, `finished_at`, plus the reward-tracking
  columns below.
- `milestones` - the stages, seeded from the `stages` list in `db.js`:
  `start` (order_index 0), eight stations (1-8), `finish` (9). Station
  ids are not in order (`m2, m3, m4, m8, m9, m10, m1, m11`) because stages
  that carried over from the first list kept their ids, so progress on
  them survived the switch-over. `optional` = 1 for Bookmark (`m3`) and
  Panel Discussion (`m10`); `book_stand` = 1 for From DEWA Knowledge
  Centers (`m1`). The list is versioned by the `stages` setting (now
  `'2'`): when it differs, `db.js` rewrites the table on startup and drops
  progress on stages that no longer exist. To change the stages, edit the
  list and bump that version. `title_ar` holds the Arabic name (added by the
  same "add column if missing" migration as the participant columns);
  `getMilestones()` also returns it as `titleAr`, which is what every API
  response uses. Only title/title_ar/description are editable after
  seeding (`PUT /api/admin/milestones/:id`, body `title`, `titleAr`,
  `description`); the current UI does not
  support adding/removing milestones without editing `db.js` and wiping
  the database.
- `progress` - (participant_id, milestone_id, completed_at). One row per
  completed milestone.

Key rule enforced in `server.js`: `start` is auto-completed at
registration and can never be scanned; `finish` is never scanned directly
either - it auto-completes the moment every required station (not
`optional`) is done. See `maybeAutoFinish()`. Optional stations can still
be scanned after finishing; they never change the finish rank.

Extra book tokens: `tokenView()` = optional stations done (`earned`) and
`participants.tokens_used`. A scan at the `book_stand` station returns
`books: { total, extra }` - 1 book on the first visit plus the unused
tokens - and sets `tokens_used = earned`, inside the check-in
transaction. A later re-scan there hands out only tokens earned since.
The attendee's page shows unused tokens, and keeps "Show my code"
visible after finishing while an optional stage or a token is left.
Progress counts (`3/6`, the dashboard's "x / 6 required") count required
stations only.

Rewards tables:

The prize rules (version 3, set by the user 2026-10-06):

| Rank | Prize |
|---|---|
| 1-10, the raffle-draw group (tier 1) | a random draw, at the moment they finish, from `pool_prizes`: 1 Money Voucher (grand), 3 Petrol vouchers, 6 Coffee vouchers |
| 11-32 (tier 2) | tier 2's `label` ("Coffee voucher"), with `image` |
| 33+ | a thank-you note (`thanks_message`) |

Every prize (draw or tier) is shown with `collect_message` ("Please visit
the reception area to collect your reward."). Coffee vouchers show the
user's voucher artwork, `public/shared/coffee-voucher.jpg` (re-encoded
from the PNG they supplied to keep it ~95 KB).

- `reward_tiers` - `id`, `from_rank`, `to_rank`, `label`,
  `description`, `image`. The tier starting at rank 1 is always the
  raffle-draw group (`getDrawGroup()`); its own `label` only goes to
  places beyond the pool. Admin edits label, description and size
  (`PUT /api/admin/rewards/tiers/:id`, body `label`, `description`,
  `count`); `saveTier()` then lays all tiers back to back from rank 1, so
  they never overlap or leave a gap.
- `pool_prizes` - `id`, `label`, `qty`, `grand`, `image`,
  `order_index`. `getPool()` adds `remaining` (qty minus how many
  participants hold that `prize_id`). Admin edits label and qty
  (`PUT /api/admin/rewards/pool/:id`); qty can't go below what's been won.
  No add/remove from the UI.
- `settings` - key/value: `collect_message`, `thanks_message` (both
  edited via `PUT /api/admin/rewards/settings`, body `collectMessage`,
  `thanksMessage`) and `prize_rules`. On startup `db.js` reseeds the
  tiers, the pool and `collect_message`, and clears drawn prizes, whenever
  `prize_rules` isn't `'3'` (an existing `thanks_message` is kept). That
  is how earlier versions of the rules were switched over without a reset.
  If the rules change again, bump the version the same way.
- `participants.finish_rank` - set once, the moment a participant
  auto-finishes, via `claimFinishRank()`, which runs inside the check-in's
  transaction so reading "how many have finished so far" and claiming
  `that + 1` is one atomic unit. It's assigned in finish order regardless
  of which admin device scanned the final milestone.
- `participants.prize_id` / `prize_label` / `prize_image` /
  `prize_main` (1 = grand) - set once, by `drawPoolPrize()`, which
  `maybeAutoFinish()` calls right after `claimFinishRank()` (same
  transaction) for anyone in the raffle-draw group. It draws without
  replacement: the remaining places each hold one prize (the pool's
  leftovers, then the tier label for places beyond the pool) and the
  finisher gets a random place. That gives everyone in the group the same
  chance at each prize whatever the finishing order, and the whole pool
  is given out once the group is full. Label and image are snapshots. At
  startup, `server.js` also draws for any group finisher with no prize
  yet (after a rules switch-over, or a crash between finishing and
  drawing).
- Old databases may still contain `fixed_rewards`, `reward_pool`,
  `participants.drawn_*`, `participants.raffle_won_at` /
  `raffle_prize_label` and a `raffle_prize_label` setting from older
  prize schemes. Nothing reads them.

`rewardView()` in `server.js` turns a participant row into the `reward`
object the frontend consumes - `{ type: 'draw', rank, grand, label, image,
message }`, `{ type: 'tier', rank, label, description, image, message }`
or `{ type: 'thanks', rank, message }` - and is attached to every
`participantView()` response (`/api/register`, `/api/me`). Tiers are read
at request time, so resizing a tier mid-event changes what
already-finished people see (a drawn prize itself never changes).
`GET /api/admin/winners` returns `{ tiers: [{..., draw, people}], pool,
thanksFromRank, thanks }`.

On the attendee's phone (`renderRewardSection()` in `journey.js`), a
raffle-draw finisher first sees "You have entered the raffle draw!" and a
**Reveal my prize** button. The prize is already decided on the server;
the button only uncovers it (a short "Drawing…" pause, confetti, then the
prize card). The phone remembers the reveal in localStorage
(`event_journey_revealed` = the token), so a reload shows the prize
directly; if that is lost, the button simply shows again.

## Request flow worth knowing

- Attendee identity = the `token` in `localStorage` (key
  `event_journey_token`), set once at registration. There's no login for
  attendees - losing that browser's localStorage means losing access to
  that registration (there's no recovery flow by design, to keep
  registration frictionless during a live event).
- Admin identity = a signed cookie (`admin_session`), set by
  `POST /api/admin/login`. Signing is a plain HMAC in `server.js`
  (`sign`/`verify`), not a library - fine for a single shared admin
  password and a short-lived event, not meant to scale to multiple staff
  accounts or roles.
- The attendee's journey page polls `GET /api/me?token=...` every 4
  seconds - that's what makes a scan at a station show up on the
  attendee's phone without them refreshing. If you change how state
  updates propagate, keep in mind there's no websocket/SSE here, it's
  deliberately simple polling.
- The scanner (`scan.html`) reads QR codes from the camera via
  `getUserMedia` + `public/vendor/jsQR.js`, decoding frames on a
  `<canvas>`. There's also a manual text-entry fallback for when camera
  access fails (common on non-HTTPS origins other than `localhost`).

## Look and feel: books on a bookmark ribbon (approved by the user)

The design follows the event's poster (Reading & Knowledge Festival):
pastel open and closed books on a light grey page, a white sheet with a
torn bottom edge, a maroon title, navy text, and indigo, mauve and peach
panels. The user saw this as a mockup and approved it before it was
built, after rejecting three earlier directions (a plain winding trail, a
pixel-art platformer, an island map). Do not drift back to any of those,
and do not add the organisation's logo yourself - the user adds official
artwork.

The idea: every milestone is a book. A book is **closed until its stop is
visited, then opens and stays open** (the user confirmed this direction
explicitly). Stations can be visited in any order, so the **first station
not yet visited** is the closed book in a peach circle with a pulsing ring
and "Go here next"; other unvisited stops are grey (`statesOf()`). A
bookmark ribbon threads from book to book. A stretch of ribbon is mauve
only when the books at **both** ends are visited, otherwise pale lavender,
so out-of-order visits show as separate mauve pieces that join up as the
gaps are filled. When a stop is scanned, the stretches it joins animate.
Desk items (pencil, cup, paper plane, lamp, glasses, lightbulb, quill,
plant), sparkles and faint letters fill the gaps. A small robot mascot,
modelled on the DEWA service robot the user showed (a Pepper-style robot:
white, big round head, dark eyes, blue ear lights, chest tablet, green
wrist rings, flared base), sits in the most recently visited book and
glides along the ribbon to each newly visited one. The user turned down a
bookworm and then a water drop before choosing this. Its tablet stays
plain white and green, with no logo.

How it is built (vector SVG generated in code, no image files):

- `public/shared/bookpath.js` exposes `BookPath.create(svg)`;
  `path.update(milestones)` rebuilds only when a title or completed flag
  changed, so the 4-second poll does not restart animations. It returns
  the index of the most recently visited book (by `completedAt`, or the
  last book once finished), which
  `journey.js` scrolls to. It also has
  `BookPath.backdrop(svg)` (faded floating books behind a page),
  `BookPath.tornEdge(element)` and `BookPath.openBookArt(svg)`.
- Changes that happen while the page is open are animated: the book that
  was just visited gets `.bp-open` (it pops open) and its ribbon stretch
  gets `.bp-draw` (it colours in). Nothing animates on first load.
  Alongside the confetti, `journey.js` (`showToast()`) slides down a
  "You have completed this milestone!" message (the user's wording) naming
  the station just scanned in English and Arabic; it hides after 4s or
  on tap. It picks the station by latest `completedAt` among stations, so
  on the final scan it names that station, not "The End".
- Each book sits in an outer `<g transform="translate(...)">` for position
  and an inner `<g>` that receives the CSS animation. Keep these separate:
  a CSS transform on an SVG element replaces its `transform` attribute, so
  putting both on one element sends the book to the top-left corner.
- The mascot (`mascot()` draws it, `arrivalPop()` the sparkle burst on
  arrival, state in `create()`): `build()` wipes the SVG, so the mascot is
  redrawn last on every build and a move in progress (`walk`) carries on
  with the new element. Its route (`routePoint()`) follows the ribbon's
  curves book centre to book centre, through any books in between, in
  either direction (out-of-order visits go backwards). The move is driven
  by `requestAnimationFrame`, and lasts about 1.6s for one stop and at most
  4.2s. The CSS lives in `journey.html`: `.bp-mascot` sway,
  `.bp-eyes` blink, `.bp-arm-r` occasional wave (arms pivot at the
  shoulder via `transform-origin` on `fill-box`), `.bp-mascot.walking`
  lean and arm swing, and `.bp-pop-*`. The motion and sparkles are skipped
  under `prefers-reduced-motion`. `journey.js` scrolls to the destination
  book, so on a long jump the robot arrives from off-screen. Its colours
  (`ROBOT`: green, ear blue) are not on the poster and are used only here.
  To swap the character, replace `mascot()` and its CSS; nothing else
  depends on its shape.
- Scenery goes in the two free pockets of each stretch (under the book
  just left, above the book coming up). Put new decorations there so they
  do not sit under a title or the ribbon.
- Beside each book: a small "Stop N" label, the English title word-wrapped
  to up to 3 lines (17px), the Arabic title under it to up to 2 lines
  (14.5px, `direction="rtl"` so brackets land on the right side), then the
  chip. The block is centred on its book. `wrap()` measures with
  `getComputedTextLength`, and the path rebuilds once the Cairo Latin and
  Arabic fonts have loaded so line breaks match the real font. Only a name
  too long even for those lines (possible after an admin edit) shrinks.
- `GAP` (250) is sized for the longest current names (3 + 2 lines + chip)
  to clear the ribbon, the scenery and the next book. If names get longer,
  raise `GAP` and check at 390px.
- Book colours cycle coral, lavender, pink, mauve; the last stop is always
  yellow. They come from the stop's position, not the `icon` column.
- Palette and type live in `public/shared/theme.css`. The font is Cairo
  (close to the poster's lettering), vendored in `public/vendor/fonts` in
  Latin and Arabic subsets so Arabic stop names or prize names render
  properly. Stop names are bilingual (journey, "All stops" list, scanner
  dropdown - the dropdown wraps the Arabic in U+2067/U+2069 isolates).
  The rest of the interface text is English only; a fully bilingual
  interface was raised with the user and is still undecided.
- The plant uses a soft green that is not on the poster; the user was
  told and has not objected.

## Rewards gotchas

- A raffle-draw prize is drawn **once**, by the server, the moment the
  person finishes, and is **permanent**: no redraw, no undo. The
  attendee's **Reveal my prize** button only uncovers it - don't turn it
  into a real draw, and don't add a staff "draw" button; the user wants
  the draw on finish so nobody waits for the group to fill.
- If fewer than 10 people ever finish, the grand prize may never be drawn
  (it is only certain to go once the 10th place is filled). Shrinking the
  group's size on `/admin/rewards` before people finish is the way to
  plan for a smaller crowd.
- Group sizes should be settled before people finish: changing them later
  moves already-finished people between groups.

## Running / testing locally

```
npm install
cp .env.example .env         # set ADMIN_PASSWORD, SESSION_SECRET, BASE_URL
npm start                    # http://localhost:3000
```

Since this is phone-first, when testing changes:
- Use a real phone on the same wifi as your dev machine (set `BASE_URL` to
  your machine's LAN IP, e.g. `http://192.168.1.42:3000`), or
- Emulate a phone viewport in a browser (~390x844, e.g. iPhone-sized) -
  don't just resize a desktop browser window and call it done, several
  bugs here (the dashboard table, cramped navigation) only showed up at
  actual phone widths or with real state transitions.

Reset registrations between test runs and the real event with **Clear all
registrations** on `/admin/rewards` (`POST /api/admin/reset`, body
`{ confirm: 'RESET' }`; keeps stations and prize settings). That is the
only way when hosted. On a laptop, deleting the local file also resets
stations and prizes to the defaults:
```
rm -f data/event.db data/event.db-shm data/event.db-wal     # Mac/Linux, Git Bash
del data\event.db data\event.db-shm data\event.db-wal   # Windows Command Prompt
```
Stop the server first (Ctrl+C) - Windows won't delete the file while it is open.

All database access is async. Helpers in `server.js` take `q` - `db`, or
the `tx` of a transaction they belong to - and anything that reads then
writes (a check-in with its finish rank and prize draw, a tier resize)
runs inside one `db.transaction()`. Don't call `db.transaction()` from
inside another one: transactions queue one at a time, so it would wait
forever. Route handlers are wrapped in `route()` so a database error
answers 500 instead of crashing the server.

## Things intentionally left simple (mention before "fixing")

- No undo for a wrong scan - would need a small admin API + button.
- No multi-admin accounts/roles - one shared password.
- No way to add/remove milestones from the UI - edit `db.js` and reset
  the DB before the event, or extend the admin API.
- No offline/service-worker support - phones must reach the server the
  whole time; there's no fallback if the connection briefly drops.
- No way to undo or redo a raffle-draw prize from the UI - it's permanent
  by design (see "Rewards gotchas"). To correct a mistake, edit
  `participants.prize_id` / `prize_label` / `prize_image` / `prize_main`
  directly in the database (keeping the pool's quantities consistent) until someone builds an
  admin override.

If the user asks for any of these, treat it as a real feature request,
not a bug - the simplicity was a deliberate scope choice for a first
build, not an oversight.
