// The attendee journey, drawn as books on a bookmark ribbon.
//
// Each milestone is a book: closed until it is visited, open (and ticked)
// afterwards. A ribbon threads from book to book and turns mauve behind the
// attendee. Things from a reader's desk fill the gaps as scenery. A small
// robot sits in the book visited most recently and glides along the
// ribbon to each new one.
//
// Usage:
//   const path = BookPath.create(svgElement);
//   path.update(milestones);        // [{ id, title, titleAr, completed, completedAt }]
//   BookPath.backdrop(svgElement);  // faded floating books behind a page
//   BookPath.tornEdge(element);     // torn-paper bottom edge on a sheet
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const FONT = 'Cairo, sans-serif';
  const C = {
    maroon: '#7b1042', navy: '#221c52', indigo: '#5a5a96', mauve: '#bd7f9f',
    peach: '#f6d9b8', coral: '#ef8f80', pink: '#f3b9c2', lav: '#b9a8e6',
    lavSoft: '#e4dff3', sun: '#f6c54a', lockedText: '#a9a6bd',
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- books ----------

  const TONES = {
    coral:  { cover: '#ef8f80', coverLight: '#f6b1a4', pages: '#fbeee6', pagesDark: '#d9cdea', ribbon: '#b9a8e6' },
    lav:    { cover: '#b9a8e6', coverLight: '#d3c8f1', pages: '#fbf4ee', pagesDark: '#f3b9c2', ribbon: '#ef8f80' },
    pink:   { cover: '#f3b9c2', coverLight: '#f9d6db', pages: '#fdf6ee', pagesDark: '#cfc4ec', ribbon: '#7b1042' },
    mauve:  { cover: '#bd7f9f', coverLight: '#d6a9c0', pages: '#fbf1ea', pagesDark: '#d9cdea', ribbon: '#f6c54a' },
    sun:    { cover: '#f6c54a', coverLight: '#fbdd8c', pages: '#fdf6ee', pagesDark: '#d9cdea', ribbon: '#ef8f80' },
    locked: { cover: '#d7d5e3', coverLight: '#e6e4ee', pages: '#f6f5f9', pagesDark: '#e3e1ec', ribbon: '#cfcbe0' },
  };
  const TONE_ORDER = ['coral', 'lav', 'pink', 'mauve'];
  function toneFor(i, total) {
    return i === total - 1 ? 'sun' : TONE_ORDER[i % TONE_ORDER.length];
  }

  // A closed book seen from above at an angle. Drawn centred on 0,0.
  function closedBook(parent, tone, rot, scale) {
    const c = TONES[tone];
    const g = el('g', { transform: `rotate(${rot || 0}) scale(${scale || 1}) translate(-52 -34)` }, parent);
    el('ellipse', { cx: 54, cy: 70, rx: 46, ry: 7, fill: C.navy, opacity: 0.08 }, g);
    el('path', { d: 'M2 22 L34 56 L34 68 L2 34 Z', fill: c.pages }, g);
    el('path', { d: 'M34 56 L104 32 L104 44 L34 68 Z', fill: c.pagesDark }, g);
    el('path', { d: 'M34 59 L104 35 M34 62.5 L104 38.5', stroke: '#fff', 'stroke-width': 1, opacity: 0.6 }, g);
    el('path', { d: 'M2 22 L72 0 L104 32 L34 56 Z', fill: c.cover }, g);
    el('path', { d: 'M17 23 L69 7 L90 29 L38 46 Z', fill: c.coverLight }, g);
    el('path', { d: 'M2 22 L34 56 L34 68 L31 68 L0 35 L0 23 Z', fill: c.cover, opacity: 0.55 }, g);
    el('path', { d: 'M84 39 L84 62 L89.5 56 L95 60 L95 35 Z', fill: c.ribbon }, g);
    return g;
  }

  // An open book lying flat with two bookmark ribbons. Drawn centred on 0,0.
  function openBook(parent, tone, scale) {
    const c = TONES[tone];
    const g = el('g', { transform: `scale(${scale || 1}) translate(-58 -36)` }, parent);
    el('ellipse', { cx: 58, cy: 70, rx: 52, ry: 7, fill: C.navy, opacity: 0.08 }, g);
    el('path', { d: 'M58 20 Q30 6 0 14 L0 62 Q30 55 58 67 Q86 55 116 62 L116 14 Q86 6 58 20 Z', fill: c.cover }, g);
    el('path', { d: 'M58 16 Q32 4 5 11 L5 55 Q32 49 58 60 Z', fill: c.pages }, g);
    el('path', { d: 'M58 16 Q84 4 111 11 L111 55 Q84 49 58 60 Z', fill: '#fff' }, g);
    el('path', { d: 'M58 16 L58 60', stroke: c.pagesDark, 'stroke-width': 2 }, g);
    [[13, 22], [13, 30], [13, 38], [66, 24], [66, 32], [66, 40]].forEach(([x, y]) =>
      el('path', { d: `M${x} ${y} q 18 -6 37 0`, stroke: c.pagesDark, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }, g));
    el('path', { d: 'M48 60 L48 80 L52 76 L56 80 L56 62 Z', fill: c.ribbon }, g);
    el('path', { d: 'M62 62 L62 76 L65.5 73 L69 76 L69 60 Z', fill: c.cover }, g);
    return g;
  }

  function tick(parent, x, y) {
    const g = el('g', { transform: `translate(${x} ${y})` }, parent);
    el('circle', { r: 13, fill: C.maroon, stroke: '#fff', 'stroke-width': 3 }, g);
    el('path', { d: 'M-5 0.5 L-1.5 4 L5.5 -4', stroke: '#fff', 'stroke-width': 2.8, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  // The mascot: a little white service robot (big round head, dark eyes,
  // blue ear lights, a tablet on its chest, a flared base it rolls on),
  // looking slightly right, standing on 0,0. Its green and blue are not on
  // the poster; they are used only here. The tablet is deliberately plain:
  // no logo (see CLAUDE.md). The shadow stays on the ground; everything
  // else goes in `body`, which the CSS animates (.bp-mascot sways, blinks
  // and now and then waves while it sits; .bp-mascot.walking glides with a
  // lean and swinging arms).
  const ROBOT = { white: '#fdfdff', shade: '#e4e6ee', edge: '#b9bccb', green: '#3fae49', ear: '#8fd0f6' };
  function mascot(parent) {
    el('ellipse', { cx: 0, cy: 1, rx: 15, ry: 3.2, fill: C.navy, opacity: 0.12 }, parent);
    const body = el('g', { class: 'bp-mascot' }, parent);
    const line = { stroke: ROBOT.edge, 'stroke-width': 1.1, 'stroke-linejoin': 'round' };
    // an arm hangs from its shoulder; green ring at the wrist, round hand
    const arm = (side) => {
      const g = el('g', { class: `bp-arm bp-arm-${side < 0 ? 'l' : 'r'}` }, body);
      const x = 9 * side;
      el('path', { d: `M${x} -27 Q${x + 5 * side} -21 ${x + 4 * side} -15`, stroke: ROBOT.edge, 'stroke-width': 4.6, fill: 'none', 'stroke-linecap': 'round' }, g);
      el('path', { d: `M${x} -27 Q${x + 5 * side} -21 ${x + 4 * side} -15`, stroke: ROBOT.white, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, g);
      el('circle', { cx: x + 4.3 * side, cy: -16, r: 1.9, fill: ROBOT.green }, g);
      el('circle', { cx: x + 4 * side, cy: -13.4, r: 2.1, fill: ROBOT.white, ...line }, g);
    };
    arm(-1);
    // base, waist and torso
    el('path', { d: 'M-12.5 0 Q-14 -5 -7 -12 L7 -12 Q14 -5 12.5 0 Z', fill: ROBOT.white, ...line }, body);
    el('path', { d: 'M-5 -3 h3 M2 -3 h3', stroke: ROBOT.edge, 'stroke-width': 1, 'stroke-linecap': 'round' }, body);
    el('path', { d: 'M-7 -12 Q-8.5 -20 -10 -28 L10 -28 Q8.5 -20 7 -12 Z', fill: ROBOT.white, ...line }, body);
    // chest tablet: dark bezel, white top, green bottom
    el('rect', { x: -7.5, y: -26, width: 15, height: 9.5, rx: 1.6, fill: '#2d2c3d' }, body);
    el('rect', { x: -6.4, y: -25, width: 12.8, height: 3.6, fill: '#fff' }, body);
    el('rect', { x: -6.4, y: -21.4, width: 12.8, height: 3.9, fill: ROBOT.green }, body);
    el('circle', { cx: 0, cy: -23.2, r: 1.1, fill: 'none', stroke: ROBOT.green, 'stroke-width': 0.7 }, body);
    // neck and head
    el('rect', { x: -2.2, y: -31, width: 4.4, height: 3.5, fill: ROBOT.shade }, body);
    el('ellipse', { cx: 0, cy: -39, rx: 10, ry: 9.2, fill: ROBOT.white, ...line }, body);
    el('ellipse', { cx: 9.4, cy: -39, rx: 1.8, ry: 3, fill: ROBOT.ear }, body);
    el('circle', { cx: 1, cy: -46.6, r: 0.9, fill: ROBOT.edge }, body);
    const eyes = el('g', { class: 'bp-eyes' }, body);
    [-3, 4.6].forEach((cx) => {
      el('circle', { cx, cy: -39.5, r: 3.1, fill: ROBOT.shade }, eyes);
      el('circle', { cx: cx + 0.4, cy: -39.5, r: 2.3, fill: '#1d1b2c' }, eyes);
      el('circle', { cx: cx + 1.2, cy: -40.4, r: 0.75, fill: '#fff' }, eyes);
    });
    el('path', { d: 'M0.2 -34.4 Q1.2 -33.6 2.2 -34.4', stroke: '#1d1b2c', 'stroke-width': 0.9, fill: 'none', 'stroke-linecap': 'round' }, body);
    arm(1);   // the near arm, in front of the body: this one waves
    return body;
  }

  // A little burst of sparkles where the robot arrives (CSS .bp-pop), which
  // removes itself.
  function arrivalPop(parent, pos) {
    const g = el('g', { transform: `translate(${pos.x.toFixed(1)} ${(pos.y - 24).toFixed(1)})` }, parent);
    [[1, C.sun], [2, ROBOT.green], [3, C.coral]].forEach(([k, fill]) =>
      el('path', { class: `bp-pop bp-pop-${k}`, d: 'M0 -4 Q0 0 4 0 Q0 0 0 4 Q0 0 -4 0 Q0 0 0 -4 Z', fill }, g));
    setTimeout(() => g.remove(), 800);
  }

  // ---------- scenery: things from a reader's desk, each drawn around 0,0 ----------

  const SCENERY = {
    pencil(g) {
      const p = el('g', { transform: 'rotate(-35)' }, g);
      el('rect', { x: -26, y: -5, width: 40, height: 10, fill: C.sun }, p);
      el('rect', { x: -26, y: -1.5, width: 40, height: 3, fill: '#e9ae2a' }, p);
      el('rect', { x: -34, y: -5, width: 8, height: 10, rx: 2, fill: C.pink }, p);
      el('rect', { x: -27, y: -5, width: 3, height: 10, fill: C.indigo }, p);
      el('path', { d: 'M14 -5 L27 0 L14 5 Z', fill: C.peach }, p);
      el('path', { d: 'M22 -2 L27 0 L22 2 Z', fill: C.navy }, p);
    },
    cup(g) {
      el('ellipse', { cx: 0, cy: 18, rx: 24, ry: 5, fill: '#d9d2ee' }, g);
      el('path', { d: 'M-15 -6 L15 -6 L12 14 Q0 20 -12 14 Z', fill: C.coral }, g);
      el('ellipse', { cx: 0, cy: -6, rx: 15, ry: 4, fill: C.maroon, opacity: 0.75 }, g);
      el('path', { d: 'M14 -2 Q26 -2 24 6 Q22 12 12 10', stroke: C.coral, 'stroke-width': 4, fill: 'none' }, g);
      el('path', { d: 'M-6 -14 q-4 -6 0 -11 q4 -5 0 -10 M5 -14 q-4 -6 0 -11 q4 -5 0 -10', stroke: C.lav, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' }, g);
    },
    lamp(g) {
      el('path', { d: 'M-4 -14 L-30 26 L22 26 Z', fill: C.sun, opacity: 0.28 }, g);
      el('rect', { x: 8, y: 22, width: 24, height: 5, rx: 2.5, fill: C.indigo }, g);
      el('path', { d: 'M20 22 L26 -4 L6 -20', stroke: C.indigo, 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      el('path', { d: 'M-12 -8 L6 -26 L12 -16 L-2 -2 Z', fill: C.mauve }, g);
      el('circle', { cx: -6, cy: -6, r: 4, fill: C.sun }, g);
    },
    plane(g) {
      el('path', { d: 'M-40 20 q14 -16 30 -10', stroke: C.lav, 'stroke-width': 1.8, 'stroke-dasharray': '3 5', fill: 'none', 'stroke-linecap': 'round' }, g);
      el('path', { d: 'M-12 6 L26 -14 L8 18 L2 6 Z', fill: '#fff', stroke: '#d9d2ee', 'stroke-width': 1 }, g);
      el('path', { d: 'M2 6 L26 -14 L8 18 Z', fill: '#d9d2ee' }, g);
      el('path', { d: 'M2 6 L0 16 L6 11 Z', fill: C.lav }, g);
    },
    glasses(g) {
      const p = el('g', { transform: 'rotate(-8)' }, g);
      el('rect', { x: -27, y: -9, width: 22, height: 18, rx: 8, fill: '#fff', 'fill-opacity': 0.7, stroke: C.navy, 'stroke-width': 3 }, p);
      el('rect', { x: 5, y: -9, width: 22, height: 18, rx: 8, fill: '#fff', 'fill-opacity': 0.7, stroke: C.navy, 'stroke-width': 3 }, p);
      el('path', { d: 'M-5 -2 Q0 -6 5 -2', stroke: C.navy, 'stroke-width': 3, fill: 'none' }, p);
      el('path', { d: 'M-22 -3 l5 -3 M10 -3 l5 -3', stroke: C.lav, 'stroke-width': 2, 'stroke-linecap': 'round' }, p);
    },
    bulb(g) {
      [[-24, -8], [24, -8], [-17, -26], [17, -26], [0, -34]].forEach(([x, y]) =>
        el('path', { d: `M${x * 0.78} ${y * 0.78 - 4} L${x} ${y - 4}`, stroke: C.sun, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, g));
      el('path', { d: 'M0 -22 C12 -22 16 -12 14 -5 C12 2 8 4 8 10 L-8 10 C-8 4 -12 2 -14 -5 C-16 -12 -12 -22 0 -22 Z', fill: C.sun }, g);
      el('path', { d: 'M-6 -14 C-9 -10 -9 -6 -7 -3', stroke: '#fff', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8 }, g);
      el('rect', { x: -7, y: 10, width: 14, height: 9, rx: 3, fill: C.indigo }, g);
    },
    quill(g) {
      el('path', { d: 'M-6 6 C0 -14 12 -26 26 -28 C22 -12 14 0 -2 10 Z', fill: C.coral }, g);
      el('path', { d: 'M-6 8 C4 -8 14 -20 26 -28', stroke: '#fff', 'stroke-width': 1.6, fill: 'none', opacity: 0.8 }, g);
      el('path', { d: 'M-20 8 L2 8 L5 22 Q-9 28 -23 22 Z', fill: C.indigo }, g);
      el('rect', { x: -17, y: 4, width: 16, height: 6, rx: 3, fill: C.navy }, g);
    },
    plant(g) {
      el('path', { d: 'M0 2 C-18 -4 -22 -22 -12 -28 C-4 -20 0 -10 0 2 Z', fill: '#8fc1a9' }, g);
      el('path', { d: 'M0 2 C18 -6 20 -26 8 -32 C2 -22 0 -10 0 2 Z', fill: '#6fae93' }, g);
      el('path', { d: 'M0 4 C-4 -8 6 -16 14 -12 C12 -4 6 2 0 4 Z', fill: '#a9d3bf' }, g);
      el('path', { d: 'M-13 2 L13 2 L10 24 L-10 24 Z', fill: C.mauve }, g);
      el('rect', { x: -15, y: 0, width: 30, height: 6, rx: 3, fill: '#a8668a' }, g);
    },
  };
  const SCENERY_ORDER = ['pencil', 'cup', 'plane', 'lamp', 'glasses', 'bulb', 'quill', 'plant'];
  const LETTERS = ['A', 'b', 'c', 'Z', 'k', 'R', 'e', 's'];

  function sparkle(parent, x, y, r, fill) {
    el('path', { d: `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`, fill }, parent);
  }
  function letter(parent, x, y, ch, fill, rot) {
    const t = el('text', { x, y, 'font-size': 20, 'font-weight': 800, fill, 'font-family': FONT, transform: `rotate(${rot} ${x} ${y})`, opacity: 0.8 }, parent);
    t.textContent = ch;
  }

  // ---------- layout ----------

  // GAP is tall enough for the longest stop name: three lines of English,
  // two of Arabic and a chip beside a book, clear of the ribbon and the
  // scenery above and below it.
  const W = 362, TOP = 84, GAP = 250, BOTTOM = 96, SIDE = 86;
  const TEXT_W = 196;   // room for a stop's text beside its book

  function point(i) {
    return { x: i % 2 === 0 ? SIDE : W - SIDE, y: TOP + i * GAP };
  }
  function ribbonD(a, b) {
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y + 10} C ${a.x} ${my + 26}, ${b.x} ${my - 26}, ${b.x} ${b.y - 6}`;
  }

  // The mascot's route: the same curve as the ribbon, but running from
  // book centre to book centre so a walk through several books is smooth.
  const MASCOT_DY = 10;   // it sits on the lower pages of the open book
  function mascotPoint(a, b, t) {
    const my = (a.y + b.y) / 2, u = 1 - t;
    const p = [[a.x, a.y], [a.x, my + 26], [b.x, my - 26], [b.x, b.y]];
    const at = (k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k];
    return { x: at(0), y: at(1) + MASCOT_DY };
  }
  // Position along the ribbon from book `from` to book `to` (either
  // direction, through any books in between) at progress e, 0 to 1.
  function routePoint(from, to, e) {
    const k = Math.abs(to - from), dir = to > from ? 1 : -1;
    const u = e * k, seg = Math.min(Math.floor(u), k - 1), t = u - seg;
    const i0 = from + dir * seg, lo = Math.min(i0, i0 + dir);
    return mascotPoint(point(lo), point(lo + 1), dir > 0 ? t : 1 - t);
  }
  // Stations can be visited in any order, so "Go here next" is the first
  // required station not visited yet (optional ones are never pointed at).
  // The start is always done and the finish is never scanned, so neither
  // is ever "next".
  function statesOf(milestones) {
    const n = milestones.length;
    const next = milestones.findIndex((m, i) => i > 0 && i < n - 1 && !m.completed && !m.optional);
    return milestones.map((m, i) => (m.completed ? 'done' : i === next ? 'next' : 'locked'));
  }
  // the book visited most recently, which is not always the furthest one;
  // once finished that is the last book (it completes in the same instant
  // as the last station, so the timestamps can tie)
  function latestDone(milestones) {
    if (milestones.length && milestones[milestones.length - 1].completed) return milestones.length - 1;
    let latest = 0;
    milestones.forEach((m, i) => {
      if (m.completed && (m.completedAt || '') > (milestones[latest].completedAt || '')) latest = i;
    });
    return latest;
  }

  // Greedy word wrap into at most maxLines lines no wider than TEXT_W.
  // Returns the lines and a font size: the given size, unless a name is
  // too long even for maxLines (only possible after an admin edit), when
  // the overflow folds into the last line and everything shrinks to fit.
  function wrap(svg, str, maxLines, attrs) {
    const probe = el('text', attrs, svg);
    const width = (s) => { probe.textContent = s; return probe.getComputedTextLength(); };
    const lines = [];
    String(str || '').split(/\s+/).filter(Boolean).forEach((w) => {
      const k = lines.length - 1;
      if (k >= 0 && width(`${lines[k]} ${w}`) <= TEXT_W) lines[k] += ` ${w}`;
      else lines.push(w);
    });
    if (lines.length > maxLines) lines.splice(maxLines - 1, Infinity, lines.slice(maxLines - 1).join(' '));
    const size = Number(attrs['font-size']);
    const widest = Math.max(0, ...lines.map(width));
    probe.remove();
    return { lines, size: widest > TEXT_W ? Math.max(9, (size * TEXT_W) / widest) : size };
  }

  function create(svg) {
    let builtKey = null;
    let previousStates = null;

    // The mascot. `mascotAt` is the book it sits in (or is walking to);
    // `walk` is a hop in progress. Every build redraws the drawing from
    // scratch, so the mascot element is recreated and the hop carries on.
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mascotAt = null, walk = null, mascotEl = null, facing = 1, lastPos = null, raf = 0;

    function placeMascot(pos, walking) {
      mascotEl.outer.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
      mascotEl.flip.setAttribute('transform', `scale(${facing} 1)`);
      mascotEl.body.classList.toggle('walking', walking);
    }

    function step(now) {
      raf = 0;
      if (!walk) return;
      const books = Math.abs(walk.to - walk.from);
      const s = Math.min(1, (now - walk.start) / Math.min(900 + 700 * books, 4200));
      const e = s < 0.5 ? 2 * s * s : 1 - Math.pow(2 - 2 * s, 2) / 2;   // ease in and out
      const pos = routePoint(walk.from, walk.to, e);
      if (lastPos && Math.abs(pos.x - lastPos.x) > 0.2) facing = pos.x > lastPos.x ? 1 : -1;
      lastPos = pos;
      if (s >= 1) {
        walk = null;
        arrivalPop(svg, pos);
      }
      placeMascot(pos, Boolean(walk));
      if (walk) raf = requestAnimationFrame(step);
    }

    function build(milestones) {
      const n = milestones.length;
      const H = TOP + (n - 1) * GAP + BOTTOM;
      const states = statesOf(milestones);
      // only animate changes that happen while the page is open
      const justDone = (i) => previousStates && previousStates[i] && previousStates[i] !== 'done' && states[i] === 'done';
      // A stretch of ribbon is coloured in once the books at both of its
      // ends are visited, so stops visited out of order show as separate
      // coloured pieces that join up as the gaps get filled in.
      const linked = (i) => states[i - 1] === 'done' && states[i] === 'done';
      const justLinked = (i) => previousStates && linked(i) && !(previousStates[i - 1] === 'done' && previousStates[i] === 'done');

      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = '';

      // the bookmark ribbon threading from book to book
      for (let i = 1; i < n; i++) {
        const d = ribbonD(point(i - 1), point(i));
        el('path', { d, fill: 'none', stroke: C.lavSoft, 'stroke-width': 13, 'stroke-linecap': 'round' }, svg);
        if (linked(i)) {
          const solid = el('path', { d, fill: 'none', stroke: C.mauve, 'stroke-width': 13, 'stroke-linecap': 'round', pathLength: 1 }, svg);
          if (justLinked(i)) solid.setAttribute('class', 'bp-draw');
          el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-dasharray': '5 6', opacity: 0.85 }, svg);
        } else {
          el('path', { d, fill: 'none', stroke: C.lav, 'stroke-width': 1.6, 'stroke-dasharray': '5 6' }, svg);
        }
      }

      // scenery in the two free pockets of each stretch: under the book
      // just left, and above the book coming up
      for (let i = 0; i < n - 1; i++) {
        const a = point(i), b = point(i + 1), mid = (a.y + b.y) / 2;
        const ltr = a.x < b.x;
        const p1 = { x: ltr ? 52 : W - 52, y: mid + 6 };
        const p2 = { x: ltr ? W - 46 : 46, y: mid - 6 };
        SCENERY[SCENERY_ORDER[(i * 2) % SCENERY_ORDER.length]](el('g', { transform: `translate(${p1.x} ${p1.y})` }, svg));
        SCENERY[SCENERY_ORDER[(i * 2 + 1) % SCENERY_ORDER.length]](el('g', { transform: `translate(${p2.x} ${p2.y})` }, svg));
        const cx = W / 2;
        sparkle(svg, cx + (ltr ? 44 : -44), mid - 34, 6, C.sun);
        sparkle(svg, cx + (ltr ? -52 : 52), mid + 30, 4.5, C.pink);
        sparkle(svg, p2.x + (ltr ? -44 : 44), mid - 2, 3.5, C.lav);
        letter(svg, cx + (ltr ? -22 : 10), mid + 44, LETTERS[(i * 2) % LETTERS.length], '#d9d2ee', -14);
        letter(svg, cx + (ltr ? 12 : -30), mid - 30, LETTERS[(i * 2 + 1) % LETTERS.length], '#f3d3d9', 12);
      }

      // the books
      milestones.forEach((m, i) => {
        const p = point(i), left = i % 2 === 0, state = states[i];
        // Position is an attribute on this outer group. Animations are CSS
        // transforms on the inner group: a CSS transform on an SVG element
        // replaces its transform attribute, so the two must not share one.
        const outer = el('g', { transform: `translate(${p.x} ${p.y})` }, svg);

        if (state === 'next') {
          el('circle', { r: 60, fill: C.peach }, outer);
          const ring = el('circle', { r: 60, fill: 'none', stroke: C.maroon, 'stroke-width': 3 }, outer);
          el('animate', { attributeName: 'r', values: '56;74', dur: '1.8s', repeatCount: 'indefinite' }, ring);
          el('animate', { attributeName: 'opacity', values: '0.7;0', dur: '1.8s', repeatCount: 'indefinite' }, ring);
          el('circle', { r: 60, fill: 'none', stroke: C.mauve, 'stroke-width': 2.5 }, outer);
        }

        const inner = el('g', justDone(i) ? { class: 'bp-open' } : null, outer);
        if (state === 'done') {
          openBook(inner, toneFor(i, n), 1.1);
          tick(inner, 50, -34);
        } else {
          closedBook(inner, state === 'locked' ? 'locked' : toneFor(i, n), left ? -10 : 10, 1.05);
        }

        // text beside the book, on the side facing the middle of the sheet:
        // a small label, the English name (up to three lines), the Arabic
        // name right-to-left under it (up to two lines), then a chip
        const tx = left ? p.x + 74 : p.x - 74;
        const anchor = left ? 'start' : 'end';
        const locked = state === 'locked';
        const ink = locked ? C.lockedText : C.navy;

        const label = i === 0 ? 'Start' : i === n - 1 ? 'Finish' : `Stop ${i}${m.optional ? ' · Optional' : ''}`;
        const en = wrap(svg, m.title, 3, { 'font-size': 17, 'font-weight': 800, 'font-family': FONT });
        // direction="rtl" keeps trailing punctuation such as ")" on the
        // correct side; with rtl, "end" is the left edge and "start" the right
        const ar = wrap(svg, m.titleAr, 2, { 'font-size': 14.5, 'font-weight': 700, 'font-family': FONT, direction: 'rtl' });
        const enStep = en.size * 1.12, arStep = ar.size * 1.45;

        // lay the block out from y = 0, then centre it on the book
        const rows = [];
        let y = 0;
        if (label !== m.title) { y += 12; rows.push({ text: label, y, size: 12.5, weight: 700, fill: locked ? C.lockedText : C.mauve }); }
        en.lines.forEach((t, k) => { y += k === 0 ? (rows.length ? en.size + 3 : en.size) : enStep; rows.push({ text: t, y, size: en.size, weight: 800, fill: ink }); });
        ar.lines.forEach((t, k) => { y += k === 0 ? ar.size + 9 : arStep; rows.push({ text: t, y, size: ar.size, weight: 700, fill: ink, rtl: true }); });
        // unvisited optional stops still get a chip, saying what they earn
        const chipText = state === 'done' ? 'Visited' : state === 'next' ? 'Go here next' : m.optional ? '+1 extra book' : null;
        const chipY = y + 10;
        const top = p.y - (chipText ? chipY + 22 : y + 6) / 2;

        rows.forEach((r) => {
          const t = el('text', {
            x: tx, y: top + r.y, 'font-size': r.size.toFixed(1), 'font-weight': r.weight, fill: r.fill, 'font-family': FONT,
            'text-anchor': r.rtl ? (left ? 'end' : 'start') : anchor,
          }, svg);
          if (r.rtl) t.setAttribute('direction', 'rtl');
          t.textContent = r.text;
        });

        if (chipText) {
          const chip = el('g', null, svg);
          const soft = state !== 'next';
          const bg = el('rect', { height: 22, rx: 8, fill: !soft ? C.indigo : locked ? C.lavSoft : '#f1e3ea' }, chip);
          const ct = el('text', { y: 15.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: !soft ? '#fff' : locked ? C.indigo : C.maroon, 'font-family': FONT }, chip);
          ct.textContent = chipText;
          const w = Math.ceil(ct.getComputedTextLength()) + 22;
          bg.setAttribute('width', w);
          ct.setAttribute('x', w / 2);
          chip.setAttribute('transform', `translate(${left ? tx : tx - w} ${top + chipY})`);
        }
      });

      // the mascot, on top of everything
      const target = latestDone(milestones);
      if (mascotAt !== null && target !== mascotAt && !still) {
        walk = { from: mascotAt, to: target, start: performance.now() };
        lastPos = null;
      }
      mascotAt = target;
      const outer = el('g', null, svg);
      const flip = el('g', null, outer);
      mascotEl = { outer, flip, body: mascot(flip) };
      if (walk) {
        cancelAnimationFrame(raf);
        step(performance.now());   // places it where the hop has got to
      } else {
        placeMascot(mascotPoint(point(mascotAt), point(mascotAt), 0), false);
      }

      previousStates = states;
    }

    let lastMilestones = null;

    // Returns the index of the book visited most recently.
    function update(milestones) {
      lastMilestones = milestones;
      const key = milestones.map((m) => `${m.id}:${m.title}:${m.titleAr}:${m.completed ? 1 : 0}`).join('|');
      if (key !== builtKey) {
        builtKey = key;
        build(milestones);
      }
      return latestDone(milestones);
    }

    // Line breaks are measured with the font on screen, so measure again
    // once Cairo (Latin and Arabic) has actually loaded.
    if (document.fonts) {
      Promise.all(['700', '800'].map((w) => document.fonts.load(`${w} 16px Cairo`, 'A\u0628')))
        .then(() => { if (lastMilestones) build(lastMilestones); })
        .catch(() => {});
    }

    // vertical position of a stop as a fraction of the drawing's height
    function stopFraction(i, count) {
      return point(i).y / (TOP + (count - 1) * GAP + BOTTOM);
    }

    return { update, stopFraction };
  }

  // Faded books floating behind the page, like the poster's background.
  function backdrop(svg) {
    svg.setAttribute('viewBox', '0 0 390 844');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    [[18, 56, 'coral', -28, 1.2], [374, 150, 'lav', 24, 1.3], [8, 430, 'pink', 18, 1.25],
      [386, 560, 'coral', -22, 1.3], [10, 760, 'lav', -16, 1.2], [372, 810, 'sun', 20, 1.15]]
      .forEach(([x, y, tone, rot, s]) => closedBook(el('g', { transform: `translate(${x} ${y})` }, svg), tone, rot, s));
  }

  // Gives an element a torn-paper bottom edge.
  function tornEdge(element) {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = ['0% 0%', '100% 0%'];
    for (let x = 100; x >= 0; x -= 2.5) pts.push(`${x}% calc(100% - ${Math.round(4 + rnd() * 14)}px)`);
    element.style.clipPath = `polygon(${pts.join(',')})`;
  }

  // A standalone open book, for page headers.
  function openBookArt(svg, tone) {
    svg.setAttribute('viewBox', '-70 -46 140 100');
    openBook(svg, tone || 'coral', 1.1);
  }

  global.BookPath = { create, backdrop, tornEdge, openBookArt };
})(window);
