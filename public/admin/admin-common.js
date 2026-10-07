async function requireAdminAuth() {
  try {
    const res = await fetch('/api/admin/session');
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/admin/login';
      return false;
    }
    return true;
  } catch (e) {
    window.location.href = '/admin/login';
    return false;
  }
}

function renderAdminNav(active) {
  const nav = document.createElement('div');
  nav.innerHTML = `
    <style>
      .admin-nav {
        display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px;
        max-width: 480px; margin: 0.9em auto 0.3em; padding: 4px;
        width: calc(100% - 2em);
        background: #fff; border-radius: 999px; box-shadow: 0 0 0 2px var(--line);
      }
      .admin-nav a, .admin-nav #logoutBtn {
        display: block; text-align: center; text-decoration: none;
        font-family: var(--font-body); font-size: 0.82rem; font-weight: 700;
        padding: 0.65em 0.2em; border-radius: 999px; border: none; box-shadow: none;
        color: var(--muted); background: transparent; cursor: pointer;
      }
      .admin-nav a.active { background: var(--ink); color: #fff; }
      .admin-nav #logoutBtn { color: var(--berry-deep); transform: none; line-height: 1.45; margin: 0; }
    </style>
    <div class="admin-nav">
      <a href="/admin/dashboard" data-key="dashboard">Players</a>
      <a href="/admin/scan" data-key="scan">Scan</a>
      <a href="/admin/poster" data-key="poster">QR</a>
      <a href="/admin/rewards" data-key="rewards">Prizes</a>
      <a href="/admin/feedback" data-key="feedback">Survey</a>
      <button id="logoutBtn">Exit</button>
    </div>
  `;
  document.body.prepend(nav);
  const activeLink = nav.querySelector(`a[data-key="${active}"]`);
  if (activeLink) activeLink.classList.add('active');
  nav.querySelector('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });
}
