// profile.js — User profile & contribution history panel
// Exposed as window.ProfilePanel; called from app.js after auth.

(function () {
  'use strict';

  const esc  = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const short = (s, n) => String(s || '').length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s || '');
  const fmt  = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  window.ProfilePanel = {

    /** Open the panel. Pass the supabase client, current user, and
     *  the full in-memory state object from app.js.               */
    async open(sb, currentUser, state) {
      const panel = document.getElementById('profilePanel');
      if (!panel) return;
      panel.classList.add('open');
      document.getElementById('profilePanelOverlay')?.classList.add('open');
      // Lock background scroll while panel is open
      document.body.classList.add('profile-open');
      await _render(sb, currentUser, state, panel);
    },

    close() {
      document.getElementById('profilePanel')?.classList.remove('open');
      document.getElementById('profilePanelOverlay')?.classList.remove('open');
      // Restore background scroll
      document.body.classList.remove('profile-open');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Internal rendering                                                  */
  /* ------------------------------------------------------------------ */

  async function _render(sb, user, state, panel) {
    const body = panel.querySelector('#profileBody');
    body.innerHTML = _skeleton();

    try {
      const data = await _load(sb, user, state);
      body.innerHTML = _buildHTML(user, data);
      _bindClose(panel);
    } catch (err) {
      body.innerHTML = `<p class="profile-error">Failed to load profile: ${esc(err.message)}</p>`;
    }
  }

  async function _load(sb, user, state) {
    // nodes the user created
    const myNodes = state.nodes.filter(n => n.created_by === user.id);

    // node votes by this user
    const myNodeVotes = state.votes.filter(v => v.user_id === user.id);

    // edge votes by this user
    const myEdgeVotes = state.linkVotes.filter(v => v.user_id === user.id);

    // challenges submitted by this user
    const myChallenges = state.challenges.filter(c => c.user_id === user.id);

    // challenge votes cast by this user
    const myChallengeVotes = state.challengeVotes.filter(cv => cv.user_id === user.id);

    // karma: sum of up-votes on nodes the user created
    let karma = 0;
    myNodes.forEach(n => {
      const s = state.nodeVoteSummary.find(s => s.id === n.id);
      if (s) karma += Number(s.up_votes || 0);
    });
    // bonus karma: resolved challenges the user filed
    myChallenges.forEach(ch => {
      if (ch.status === 'resolved') karma += 5;
    });

    return { myNodes, myNodeVotes, myEdgeVotes, myChallenges, myChallengeVotes, karma, state };
  }

  function _buildHTML(user, { myNodes, myNodeVotes, myEdgeVotes, myChallenges, myChallengeVotes, karma, state }) {
    const displayName = user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.user_metadata?.user_name
      || user.email?.split('@')[0]
      || 'You';
    const joinDate = fmt(user.created_at);

    // Stats row
    const statsHtml = `
      <div class="profile-stats">
        <div class="profile-stat">
          <span class="profile-stat-val">${myNodes.length}</span>
          <span class="profile-stat-label">Nodes created</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-val">${myNodeVotes.length}</span>
          <span class="profile-stat-label">Node votes cast</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-val">${myEdgeVotes.length}</span>
          <span class="profile-stat-label">Edge votes cast</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-val">${myChallenges.length}</span>
          <span class="profile-stat-label">Challenges filed</span>
        </div>
        <div class="profile-stat accent">
          <span class="profile-stat-val">${karma}</span>
          <span class="profile-stat-label">Karma</span>
        </div>
      </div>`;

    // Created nodes list
    const nodesHtml = myNodes.length
      ? myNodes.slice().reverse().map(n => {
          const s = state.nodeVoteSummary.find(s => s.id === n.id);
          const total = s ? Number(s.total_votes) : 0;
          const avg   = s ? Number(s.avg_confidence).toFixed(1) : '—';
          const stCls = n.status === 'challenged' ? 'conflict' : n.status === 'new' ? 'pending' : 'support';
          return `<div class="profile-item">
            <div class="profile-item-meta">
              <span class="badge ${stCls}">${esc(n.type)}</span>
              <span class="badge">${esc(n.status)}</span>
              <span class="badge">${total}v · avg ${avg}</span>
              <span class="profile-item-date">${fmt(n.created_at)}</span>
            </div>
            <p class="profile-item-title">${esc(n.title)}</p>
          </div>`;
        }).join('')
      : '<p class="profile-empty">No nodes created yet.</p>';

    // Node vote history
    const nodeVoteHtml = myNodeVotes.length
      ? myNodeVotes.slice().reverse().map(v => {
          const node = state.nodes.find(n => n.id === v.node_id);
          return `<div class="profile-item">
            <div class="profile-item-meta">
              <span class="badge">${v.value} / 5</span>
              <span class="profile-item-date">${fmt(v.created_at)}</span>
            </div>
            <p class="profile-item-title">${esc(node?.title || v.node_id)}</p>
          </div>`;
        }).join('')
      : '<p class="profile-empty">No node votes cast yet.</p>';

    // Edge vote history
    const edgeVoteHtml = myEdgeVotes.length
      ? myEdgeVotes.slice().reverse().map(v => {
          const link = state.links.find(l => l.id === v.link_id);
          const from = link ? state.nodes.find(n => n.id === link.from_id) : null;
          const to   = link ? state.nodes.find(n => n.id === link.to_id)   : null;
          const edgeLabel = from && to
            ? `${short(from.title, 28)} \u2192 ${short(to.title, 28)}`
            : `edge #${v.link_id}`;
          return `<div class="profile-item">
            <div class="profile-item-meta">
              <span class="badge">${v.value} / 5</span>
              <span class="profile-item-date">${fmt(v.created_at)}</span>
            </div>
            <p class="profile-item-title">${esc(edgeLabel)}</p>
          </div>`;
        }).join('')
      : '<p class="profile-empty">No edge votes cast yet.</p>';

    // Challenges filed
    const challengeHtml = myChallenges.length
      ? myChallenges.slice().reverse().map(ch => {
          const node = state.nodes.find(n => n.id === ch.target_id);
          const stCls = ch.status === 'resolved' ? 'support' : ch.status === 'rejected' ? 'conflict' : 'pending';
          return `<div class="profile-item">
            <div class="profile-item-meta">
              <span class="badge ${stCls}">${esc(ch.status)}</span>
              <span class="badge">${esc(ch.challenge_type)}</span>
              <span class="profile-item-date">${fmt(ch.created_at)}</span>
            </div>
            <p class="profile-item-title">${esc(node?.title || ch.target_id)}</p>
            <p class="profile-item-reason">${esc(short(ch.reason, 120))}</p>
          </div>`;
        }).join('')
      : '<p class="profile-empty">No challenges filed yet.</p>';

    return `
      <div class="profile-header">
        <div class="profile-avatar" aria-hidden="true">${esc(displayName[0].toUpperCase())}</div>
        <div class="profile-identity">
          <h2 class="profile-name">${esc(displayName)}</h2>
          <p class="profile-email">${esc(user.email || '')}</p>
          <p class="profile-joined">Member since ${joinDate}</p>
        </div>
      </div>

      ${statsHtml}

      <details class="profile-section" open>
        <summary class="profile-section-title">Nodes created (${myNodes.length})</summary>
        <div class="profile-list">${nodesHtml}</div>
      </details>

      <details class="profile-section" open>
        <summary class="profile-section-title">Node vote history (${myNodeVotes.length})</summary>
        <div class="profile-list">${nodeVoteHtml}</div>
      </details>

      <details class="profile-section">
        <summary class="profile-section-title">Edge vote history (${myEdgeVotes.length})</summary>
        <div class="profile-list">${edgeVoteHtml}</div>
      </details>

      <details class="profile-section">
        <summary class="profile-section-title">Challenges filed (${myChallenges.length})</summary>
        <div class="profile-list">${challengeHtml}</div>
      </details>
    `;
  }

  function _skeleton() {
    return Array.from({ length: 4 }, () =>
      `<div class="skeleton" style="height:1.1rem;margin-bottom:.6rem;border-radius:4px"></div>`
    ).join('') + `<div class="skeleton" style="height:1.1rem;width:60%;border-radius:4px"></div>`;
  }

  function _bindClose(panel) {
    panel.querySelectorAll('[data-profile-close]').forEach(el => {
      el.addEventListener('click', () => window.ProfilePanel.close());
    });
  }

})();
