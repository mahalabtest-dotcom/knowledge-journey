(function () {
  const STORAGE_KEY = 'event_journey_token';
  const token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    window.location.href = '/register';
    return;
  }

  const journeySvg = document.getElementById('journeySvg');
  const path = BookPath.create(journeySvg);
  BookPath.backdrop(document.getElementById('backdrop'));
  BookPath.tornEdge(document.getElementById('sheet'));

  const milestoneList = document.getElementById('milestoneList');
  const progressBadge = document.getElementById('progressBadge');
  const greeting = document.getElementById('greeting');
  const rewardSection = document.getElementById('rewardSection');
  const qrFab = document.getElementById('qrFab');
  const qrModal = document.getElementById('qrModal');
  const qrImg = document.getElementById('qrImg');
  const closeQr = document.getElementById('closeQr');
  const toast = document.getElementById('toast');

  qrImg.src = `/api/qrcode?text=${encodeURIComponent(token)}`;
  qrFab.addEventListener('click', () => qrModal.classList.add('open'));
  closeQr.addEventListener('click', () => qrModal.classList.remove('open'));
  qrModal.addEventListener('click', (e) => { if (e.target === qrModal) qrModal.classList.remove('open'); });

  // ---------- "مفتاح المعرفة" treasure-box poster ----------

  // A side tab that opens the poster; it can be opened and closed any time.
  // Until the first opening it shows a dot and nudges (remembered on this
  // phone; if forgotten it just nudges again).
  const keyTab = document.getElementById('keyTab');
  const keyModal = document.getElementById('keyModal');
  const KEY_SEEN = 'event_journey_key_seen';
  try { if (localStorage.getItem(KEY_SEEN)) keyTab.classList.remove('unseen'); } catch (e) { /* nudge stays */ }
  function openKey() {
    keyModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    keyModal.scrollTop = 0;
    keyTab.classList.remove('unseen');
    try { localStorage.setItem(KEY_SEEN, '1'); } catch (e) { /* fine */ }
    document.getElementById('keyClose').focus();
  }
  function closeKey() {
    keyModal.classList.remove('open');
    document.body.style.overflow = '';
    keyTab.focus();
  }
  keyTab.addEventListener('click', openKey);
  document.getElementById('keyClose').addEventListener('click', closeKey);
  keyModal.addEventListener('click', (e) => { if (e.target === keyModal || e.target.classList.contains('km-sheet')) closeKey(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && keyModal.classList.contains('open')) closeKey(); });

  let lastCompletedCount = -1;
  let lastFinished = false;
  let lastRewardKey = null;
  let lastListKey = null;

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- stops list ----------

  function buildList(list) {
    const key = list.map((m) => `${m.id}:${m.title}:${m.titleAr}:${m.description}:${m.optional}:${m.completed}`).join('|');
    if (key === lastListKey) return;
    lastListKey = key;
    milestoneList.innerHTML = '';
    list.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'm-row' + (m.completed ? ' done' : '');
      row.innerHTML = `
        <div class="m-dot"><svg viewBox="0 0 14 14"><path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div>
          <div class="m-title">${escapeHtml(m.title)}${m.optional ? ' <span class="m-opt">Optional · +1 book</span>' : ''}</div>
          ${m.titleAr ? `<div class="m-title-ar" dir="rtl" lang="ar">${escapeHtml(m.titleAr)}</div>` : ''}
          <div class="m-desc">${escapeHtml(m.description || '')}</div>
        </div>
      `;
      milestoneList.appendChild(row);
    });
  }

  // ---------- confetti ----------

  function launchConfetti() {
    const colors = ['#7b1042', '#bd7f9f', '#f6c54a', '#b9a8e6', '#ef8f80', '#5a5a96'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const size = 6 + Math.random() * 6;
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.width = size + 'px';
      piece.style.height = size * 0.6 + 'px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = 2.4 + Math.random() * 2 + 's';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 5000);
    }
  }

  // ---------- rewards ----------

  function rewardCard({ kicker, title, label, image, lines, button, foot }) {
    rewardSection.innerHTML = `
      <div class="reward">
        <div class="reward-inner">
          <div class="reward-kicker">${escapeHtml(kicker)}</div>
          <h2 class="reward-title">${escapeHtml(title)}</h2>
          ${label ? `<div class="reward-label">${escapeHtml(label)}</div>` : ''}
          ${image ? `<img class="reward-img" src="${escapeHtml(image)}" alt="${escapeHtml(label || 'Your voucher')}" />` : ''}
          ${(lines || []).filter(Boolean).map((l) => `<p class="reward-desc">${escapeHtml(l)}</p>`).join('')}
          ${button ? `<button id="revealBtn">${escapeHtml(button)}</button>` : ''}
        </div>
        <div class="reward-foot">${escapeHtml(foot || 'Thank you for taking part')}</div>
      </div>
    `;
    const btn = document.getElementById('revealBtn');
    if (btn) btn.addEventListener('click', reveal);
  }

  // The raffle-draw prize is drawn on the server the moment someone
  // finishes; the "Reveal my prize" button only uncovers it. This phone
  // remembers that it has been revealed, so a reload shows the prize
  // straight away (if it forgets, the button simply shows again).
  const REVEALED_KEY = 'event_journey_revealed';
  function isRevealed() {
    try { return localStorage.getItem(REVEALED_KEY) === token; } catch (e) { return false; }
  }
  function reveal() {
    const btn = document.getElementById('revealBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Drawing…';
    // a short pause, just for suspense
    setTimeout(() => {
      try { localStorage.setItem(REVEALED_KEY, token); } catch (e) { /* the button will just show again */ }
      launchConfetti();
      lastRewardKey = null;   // let the next render repaint the card
      poll();
    }, 1200);
  }

  function renderRewardSection(participant) {
    const reward = participant.reward;
    // Only rebuild when something actually changed, so the 4-second poll
    // doesn't reset the button every tick.
    const key = JSON.stringify(reward) + (isRevealed() ? ':revealed' : '');
    if (key === lastRewardKey) return;
    lastRewardKey = key;

    if (!reward) {
      rewardSection.style.display = 'none';
      rewardSection.innerHTML = '';
      return;
    }
    rewardSection.style.display = 'block';

    const finished = reward.rank === 1 ? 'You are the first to finish' : `You finished ${ordinal(reward.rank)}`;

    if (reward.type === 'thanks') {
      rewardCard({
        kicker: finished,
        title: 'Thank you!',
        lines: [reward.message],
      });
    } else if (reward.type === 'tier') {
      rewardCard({
        kicker: finished,
        title: 'You read the whole story!',
        label: reward.label,
        image: reward.image,
        lines: [reward.description, reward.message],
      });
    } else if (!isRevealed()) {
      // the raffle draw, before the prize is uncovered
      rewardCard({
        kicker: finished,
        title: 'You have entered the raffle draw!',
        lines: ['As one of the first finishers, a prize has been drawn for you at random. Tap below to see what you won.'],
        button: 'Reveal my prize',
        foot: 'Good luck',
      });
    } else {
      rewardCard({
        kicker: 'Raffle draw',
        title: reward.grand ? 'You won the grand prize!' : 'You won!',
        label: reward.label,
        image: reward.image,
        lines: [reward.message],
      });
    }
  }

  // ---------- milestone message ----------

  // Shown at the top of the screen, with the confetti, whenever a stop is
  // scanned while the page is open; it hides itself after a few seconds.
  let toastTimer = 0;
  function showToast(m) {
    toast.innerHTML = `
      <div class="toast-title">You have completed this milestone!</div>
      ${m ? `<div class="toast-stop">${escapeHtml(m.title)}</div>` : ''}
      ${m && m.titleAr ? `<div class="toast-stop" dir="rtl" lang="ar">${escapeHtml(m.titleAr)}</div>` : ''}
    `;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }
  toast.addEventListener('click', () => toast.classList.remove('show'));

  // ---------- extra book tokens ----------

  // One token per optional stop done; each is one more book to pick at the
  // book stand. Shown only while there are unused tokens.
  function renderTokens(tokens, list) {
    const box = document.getElementById('tokens');
    if (!tokens || !tokens.available) { box.style.display = 'none'; return; }
    const stand = list.find((m) => m.bookStand);
    const n = tokens.available;
    box.innerHTML = `
      <div class="tokens-count">${'🎟️'.repeat(Math.min(n, 3))}</div>
      <div>
        <div class="tokens-title">You have ${n} extra book token${n === 1 ? '' : 's'}</div>
        <div class="tokens-sub">Pick ${n} more book${n === 1 ? '' : 's'} at <strong>${escapeHtml(stand ? stand.title : 'the book stand')}</strong> - show your code there${stand && stand.completed ? ' again' : ''}.</div>
      </div>`;
    box.style.display = 'flex';
  }

  // ---------- survey question ----------

  // Once every other required stop is done, the survey stop is a question
  // answered right here; submitting it completes the stop. The card is
  // built once and left alone, so the 4-second poll never wipes a half-
  // written answer.
  let surveyShown = false;
  function renderSurvey(survey) {
    const box = document.getElementById('survey');
    if (!survey || !survey.open) {
      box.style.display = 'none';
      box.innerHTML = '';
      surveyShown = false;
      return false;
    }
    if (surveyShown) return false;
    surveyShown = true;
    box.innerHTML = `
      <div class="survey-kicker">Last step · Survey</div>
      <label class="survey-q" for="surveyAnswer">${escapeHtml(survey.question)}</label>
      <textarea id="surveyAnswer" rows="4" maxlength="2000" dir="auto" placeholder="Write your thoughts here"></textarea>
      <div class="survey-err" id="surveyErr"></div>
      <button id="surveySubmit">Submit</button>`;
    box.style.display = 'block';
    document.getElementById('surveySubmit').addEventListener('click', submitSurvey);
    return true;
  }

  async function submitSurvey() {
    const btn = document.getElementById('surveySubmit');
    const err = document.getElementById('surveyErr');
    const answer = document.getElementById('surveyAnswer').value.trim();
    err.textContent = '';
    if (!answer) { err.textContent = 'Please write a few words before submitting.'; return; }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send your answer.');
      render(data.participant);   // the stop completes: confetti and the message
    } catch (e) {
      err.textContent = e.message || 'Could not send your answer. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  // ---------- render / poll ----------

  function render(participant) {
    const list = participant.milestones;
    const isStop = (m) => m.orderIndex > 0 && m.orderIndex < list.length - 1;
    // progress counts the required stops; optional ones are extra
    const required = list.filter((m) => isStop(m) && !m.optional);
    const total = required.length;
    const requiredDone = required.filter((m) => m.completed).length;
    // any stop visited, required or optional, gets confetti and a message
    const done = list.filter((m) => isStop(m) && m.completed).length;

    greeting.textContent = `Hi, ${participant.name.split(' ')[0]}`;
    progressBadge.textContent = `${requiredDone}/${total}`;
    document.getElementById('stopsCount').textContent = `${requiredDone} of ${total} required visited`;
    renderTokens(participant.tokens, list);
    const surveyAppeared = renderSurvey(participant.survey);

    const firstRender = lastCompletedCount === -1;
    const current = path.update(list);
    buildList(list);
    renderRewardSection(participant);

    // after finishing, the code is still needed for an optional stop or to
    // collect an extra book; hide it only when there is nothing left
    const optionalLeft = list.some((m) => m.optional && !m.completed);
    const tokensLeft = participant.tokens && participant.tokens.available > 0;
    qrFab.style.display = participant.finishedAt && !optionalLeft && !tokensLeft ? 'none' : '';

    const scrollToStop = (index, smooth) => {
      const rect = journeySvg.getBoundingClientRect();
      const y = rect.top + window.scrollY + path.stopFraction(index, list.length) * rect.height;
      window.scrollTo({ top: Math.max(0, y - window.innerHeight * 0.45), behavior: smooth ? 'smooth' : 'auto' });
    };

    if (firstRender && !participant.finishedAt && current > 0) {
      // open the page looking at the book the attendee has reached
      scrollToStop(current, false);
    }
    if (!firstRender && done > lastCompletedCount) {
      launchConfetti();
      // name the station just scanned: the one completed most recently
      // (not `current`, which is the finish book once the journey is done)
      const latest = list.filter((m) => isStop(m) && m.completed)
        .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || '')).pop();
      showToast(latest);
      // bring the book that just opened into view
      if (!participant.finishedAt) scrollToStop(current, true);
    }
    if (participant.finishedAt && !lastFinished && !firstRender) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // bring the question into view when it first appears
    if (surveyAppeared) {
      setTimeout(() => document.getElementById('survey').scrollIntoView({ behavior: firstRender ? 'auto' : 'smooth', block: 'center' }), firstRender ? 0 : 1600);
    }
    lastCompletedCount = done;
    lastFinished = Boolean(participant.finishedAt);
  }

  async function poll() {
    try {
      const res = await fetch(`/api/me?token=${encodeURIComponent(token)}`);
      if (res.status === 404) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = '/register';
        return;
      }
      const data = await res.json();
      render(data.participant);
    } catch (e) {
      // silent retry on next tick - keep the last rendered state on screen
    }
  }

  poll();
  setInterval(poll, 4000);
})();
