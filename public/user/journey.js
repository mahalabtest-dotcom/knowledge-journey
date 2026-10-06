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
    const key = list.map((m) => `${m.id}:${m.title}:${m.titleAr}:${m.description}:${m.completed}`).join('|');
    if (key === lastListKey) return;
    lastListKey = key;
    milestoneList.innerHTML = '';
    list.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'm-row' + (m.completed ? ' done' : '');
      row.innerHTML = `
        <div class="m-dot"><svg viewBox="0 0 14 14"><path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div>
          <div class="m-title">${escapeHtml(m.title)}</div>
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

  function rewardCard({ kicker, title, label, lines, foot }) {
    rewardSection.innerHTML = `
      <div class="reward">
        <div class="reward-inner">
          <div class="reward-kicker">${escapeHtml(kicker)}</div>
          <h2 class="reward-title">${escapeHtml(title)}</h2>
          ${label ? `<div class="reward-label">${escapeHtml(label)}</div>` : ''}
          ${(lines || []).filter(Boolean).map((l) => `<p class="reward-desc">${escapeHtml(l)}</p>`).join('')}
        </div>
        <div class="reward-foot">${escapeHtml(foot || 'Thank you for taking part')}</div>
      </div>
    `;
  }

  function renderRewardSection(participant) {
    const reward = participant.reward;
    // Only rebuild when something actually changed, so the 4-second poll
    // doesn't reset the button every tick.
    const key = JSON.stringify(reward);
    if (key === lastRewardKey) return;
    lastRewardKey = key;

    if (!reward) {
      rewardSection.style.display = 'none';
      rewardSection.innerHTML = '';
      return;
    }
    rewardSection.style.display = 'block';

    const collect = 'Show this screen at the prize desk to collect it.';
    const finished = reward.rank === 1 ? 'You are the first to finish' : `You finished ${ordinal(reward.rank)}`;

    if (reward.type === 'tier') {
      rewardCard({
        kicker: finished,
        title: 'You read the whole story!',
        label: reward.label,
        lines: [reward.description, collect],
      });
    } else if (reward.type === 'thanks') {
      rewardCard({
        kicker: finished,
        title: 'Thank you!',
        lines: [reward.message],
      });
    } else {
      // the lucky draw: a prize drawn at random the moment they finished
      rewardCard({
        kicker: finished,
        title: reward.main ? 'Lucky draw: you won the main prize!' : 'You read the whole story!',
        label: reward.label,
        lines: ['Your prize was drawn at random from the prize pool for the first finishers.', reward.description, collect],
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

  // ---------- render / poll ----------

  function render(participant) {
    const list = participant.milestones;
    const isStop = (m) => m.orderIndex > 0 && m.orderIndex < list.length - 1;
    const total = list.filter(isStop).length;
    const done = list.filter((m) => isStop(m) && m.completed).length;

    greeting.textContent = `Hi, ${participant.name.split(' ')[0]}`;
    progressBadge.textContent = `${done}/${total}`;
    document.getElementById('stopsCount').textContent = `${done} of ${total} visited`;

    const firstRender = lastCompletedCount === -1;
    const current = path.update(list);
    buildList(list);
    renderRewardSection(participant);

    // nothing left to scan once the journey is finished
    qrFab.style.display = participant.finishedAt ? 'none' : '';

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
