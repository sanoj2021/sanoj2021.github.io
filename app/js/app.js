(function () {
  'use strict';

  const { createClient } = supabase;
  const SUPABASE_URL = window.APP_CONFIG?.supabaseUrl || 'http://10.8.0.1:8002';
  const SUPABASE_ANON_KEY = window.APP_CONFIG?.supabaseAnonKey || 'PASTE_YOUR_ANON_KEY_HERE';
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const short = (s, n) => String(s || '').length > n ? String(s).slice(0, n - 1) + '\u2026' : String(s || '');

  const VW = 900, VH = 480;
  const BASE_POS = {f1:[280,175],f2:[490,95],f3:[510,275],f4:[740,120],f5:[755,305],f6:[235,340]};

  let currentUser = null;
  let profile = null;
  let vx = 0, vy = 0, vscale = 1;

  const state = {
    nodes: [],
    links: [],
    sources: {},
    nodeSources: [],
    votes: [],
    challenges: [],
    challengeVotes: [],
    nodeVoteSummary: [],
    challengeVoteSummary: [],
    positions: structuredClone(BASE_POS),
    currentId: 'f1',
    view: 'graph',
    linkedFilter: null
  };

  // ── Theme ────────────────────────────────────────────────────────
  const ICONS = { dark: '\u263e', light: '\u2600' };
  let theme = document.documentElement.getAttribute('data-theme') || 'light';

  function applyTheme(t) {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
    const btn = $('#themeBtn');
    if (btn) {
      btn.textContent = ICONS[t];
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  // ── Vote-ratio color logic ───────────────────────────────────────
  function nodeColors(nodeId) {
    const summary = state.nodeVoteSummary.find(s => s.id === nodeId);
    const node = byId(nodeId);
    const total = summary ? Number(summary.total_votes) : 0;
    const up    = summary ? Number(summary.up_votes)    : 0;
    const down  = summary ? Number(summary.down_votes)  : 0;

    const challenged = node?.status === 'challenged';

    let fill, dot, opacity = 1;

    if (total < 10) {
      fill    = 'color-mix(in oklab, #888 18%, var(--surface2))';
      dot     = '#888';
      opacity = total < 1 ? 0.45 : 0.6;
    } else if (total < 100) {
      fill    = 'color-mix(in oklab, #888 22%, var(--surface2))';
      dot     = '#999';
      opacity = 0.75;
    } else {
      const upPct   = up   / total;
      const downPct = down / total;
      if (upPct > 0.65) {
        fill = 'color-mix(in oklab,var(--success,#437a22) 18%,var(--surface2))';
        dot  = 'var(--success,#437a22)';
      } else if (downPct > 0.65) {
        fill = 'color-mix(in oklab,var(--error) 18%,var(--surface2))';
        dot  = 'var(--error)';
      } else {
        fill = 'color-mix(in oklab,var(--warn) 18%,var(--surface2))';
        dot  = 'var(--warn)';
      }
    }

    if (challenged) {
      fill = 'color-mix(in oklab,var(--error) 25%,var(--surface2))';
      dot  = 'var(--error)';
    }

    return { fill, dot, opacity };
  }

  function challengeOverlayDarkness(nodeId) {
    const node = byId(nodeId);
    if (!node || node.status !== 'challenged') return null;
    const ch = state.challenges.find(c => c.target_id === nodeId && c.target_type === 'node');
    if (!ch) return null;
    const cvs = state.challengeVoteSummary.find(s => s.challenge_id === ch.id);
    if (!cvs || Number(cvs.total_votes) === 0) return 0.5;
    return Number(cvs.valid_votes) / Number(cvs.total_votes);
  }

  async function init() {
    await requireAuth();
    await loadAll();
    bindUI();
    applyTheme(theme);
    setView(state.view || 'graph');
  }

  async function requireAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = '../'; return; }
    currentUser = session.user;
    $('#usernameLabel').textContent = currentUser.email || currentUser.user_metadata?.username || 'user';
    const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    profile = p || null;
  }

  async function loadAll() {
    const [
      nodesRes, linksRes, sourcesRes, nodeSourcesRes,
      votesRes, challengesRes, challengeVotesRes,
      nodeVoteSummaryRes, challengeVoteSummaryRes
    ] = await Promise.all([
      sb.from('nodes').select('*').order('created_at', { ascending: true }),
      sb.from('links').select('*'),
      sb.from('sources').select('*'),
      sb.from('node_sources').select('*'),
      sb.from('votes').select('*'),
      sb.from('challenges').select('*').order('created_at', { ascending: false }),
      sb.from('challenge_votes').select('*'),
      sb.from('node_vote_summary').select('*'),
      sb.from('challenge_vote_summary').select('*')
    ]);

    if (nodesRes.error)   throw nodesRes.error;
    if (linksRes.error)   throw linksRes.error;
    if (sourcesRes.error) throw sourcesRes.error;

    state.nodes = (nodesRes.data || []).map(n => ({
      ...n,
      votes: n.votes_count,
      sources: (nodeSourcesRes.data || []).filter(ns => ns.node_id === n.id).map(ns => ns.source_id),
      links:   (linksRes.data   || []).filter(l => l.from_id === n.id).map(l => ({ to: l.to_id, kind: l.kind }))
    }));
    state.links                = linksRes.data || [];
    state.sources              = Object.fromEntries((sourcesRes.data || []).map(s => [s.id, s]));
    state.nodeSources          = nodeSourcesRes.data || [];
    state.votes                = votesRes.data || [];
    state.challenges           = challengesRes.data || [];
    state.challengeVotes       = challengeVotesRes.data || [];
    state.nodeVoteSummary      = nodeVoteSummaryRes.data || [];
    state.challengeVoteSummary = challengeVoteSummaryRes.data || [];

    if (!byId(state.currentId) && state.nodes[0]) state.currentId = state.nodes[0].id;
    renderStats();
  }

  function byId(id) { return state.nodes.find(n => n.id === id); }

  function userVoteFor(nodeId) {
    return state.votes.find(v => v.node_id === nodeId && v.user_id === currentUser?.id);
  }

  function getNeighbours(id) {
    const seen = new Set(), result = [];
    const node = byId(id);
    if (node) {
      (node.links || []).forEach(l => {
        const nb = byId(l.to);
        if (nb && !seen.has(nb.id)) { seen.add(nb.id); result.push({ node: nb, kind: l.kind }); }
      });
    }
    state.nodes.forEach(m => {
      (m.links || []).forEach(l => {
        if (l.to === id && !seen.has(m.id)) { seen.add(m.id); result.push({ node: m, kind: l.kind }); }
      });
    });
    return result;
  }

  // Stats elements are optional — they were removed from the UI but
  // other code still calls renderStats(). Guard each write so absent
  // elements are silently skipped instead of throwing.
  function renderStats() {
    const facts     = $('#statFacts');
    const questions = $('#statQuestions');
    const queue     = $('#statQueue');
    if (facts)     facts.textContent     = state.nodes.filter(n => n.type === 'fact' || n.type === 'claim').length;
    if (questions) questions.textContent = state.nodes.filter(n => n.type === 'question').length;
    if (queue)     queue.textContent     = state.nodes.filter(n => n.status === 'challenged').length;
  }

  function posOf(id) {
    if (state.positions[id]) return [...state.positions[id]];
    const idx = state.nodes.findIndex(n => n.id === id);
    const angle = idx * 2.399963;
    const r = 100 + idx * 18;
    return [VW / 2 + r * Math.cos(angle), VH / 2 + r * Math.sin(angle)];
  }

  function applyTransform() {
    const g = $('#graphRoot');
    if (g) g.setAttribute('transform', `translate(${vx},${vy}) scale(${vscale})`);
  }

  function clampTransform() {
    const margin = 200, w = VW * vscale, h = VH * vscale;
    vx = Math.min(margin, Math.max(VW - w - margin, vx));
    vy = Math.min(margin, Math.max(VH - h - margin, vy));
  }

  function renderGraph() {
    const svg = $('#graphSvg');
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);

    const defs = `<defs>
      <marker id="aS" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--primary)"/></marker>
      <marker id="aD" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--muted)"/></marker>
      <marker id="aC" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--error)"/></marker>
    </defs>`;

    const f = state.linkedFilter;
    let visibleIds = null;
    if (f && state.currentId) {
      const neighbours = getNeighbours(state.currentId)
        .filter(({ node }) => f === 'facts' ? (node.type === 'fact' || node.type === 'claim') : node.type === 'question')
        .map(({ node }) => node.id);
      visibleIds = new Set([state.currentId, ...neighbours]);
    }

    let edges = '';
    state.nodes.forEach(n => {
      if (visibleIds && !visibleIds.has(n.id)) return;
      (n.links || []).forEach(l => {
        if (visibleIds && !visibleIds.has(l.to)) return;
        const [x1, y1] = posOf(n.id), [x2, y2] = posOf(l.to);
        const mx  = (x1 + x2) / 2;
        const cls = l.kind === 'support' ? 'support' : l.kind === 'conflict' ? 'conflict' : 'depend';
        const mk  = l.kind === 'support' ? 'url(#aS)' : l.kind === 'conflict' ? 'url(#aC)' : 'url(#aD)';
        edges += `<path class="edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="${mk}"/>`;
      });
    });

    let nodes = '';
    state.nodes.forEach(n => {
      if (visibleIds && !visibleIds.has(n.id)) return;
      const [x, y]  = posOf(n.id);
      const active  = n.id === state.currentId;
      const r       = active ? 34 : 26;
      const { fill, dot, opacity } = nodeColors(n.id);

      let badge = '';
      const darkness = challengeOverlayDarkness(n.id);
      if (darkness !== null) {
        const gray  = Math.round((1 - darkness) * 255);
        const bfill = `rgb(${gray},${gray},${gray})`;
        const bx    = x + r * 0.65;
        const by    = y - r * 0.65;
        badge = `<circle cx="${bx}" cy="${by}" r="9" fill="${bfill}" stroke="var(--surface2)" stroke-width="1.5"/>`
              + `<text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="9" fill="${darkness > 0.5 ? '#fff' : '#222'}" font-weight="bold">&#9398;</text>`;
      }

      nodes += `<g class="node${active ? ' active-node' : ''}" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}" style="opacity:${opacity}">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
        <circle cx="${x}" cy="${y}" r="7" fill="${dot}"/>
        ${badge}
        <text x="${x}" y="${y + r + 16}" text-anchor="middle">${esc(short(n.title,38))}</text>
      </g>`;
    });

    svg.innerHTML = defs + `<g id="graphRoot" transform="translate(${vx},${vy}) scale(${vscale})">${edges}${nodes}</g>`;
    $$('.node').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      state.currentId = el.dataset.id;
      renderGraph();
      renderDetail();
    }));
    initPanZoom();
  }

  function initPanZoom() {
    const canvas = $('#graphCanvas');
    const svg    = $('#graphSvg');
    let dragging = false, startX = 0, startY = 0, startVx = 0, startVy = 0;

    canvas.onpointerdown = e => {
      if (e.target.closest('.node')) return;
      canvas.setPointerCapture(e.pointerId);
      dragging = true; startX = e.clientX; startY = e.clientY; startVx = vx; startVy = vy;
    };
    canvas.onpointermove = e => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      vx = startVx + (e.clientX - startX) * (VW / rect.width);
      vy = startVy + (e.clientY - startY) * (VH / rect.height);
      clampTransform(); applyTransform();
    };
    canvas.onpointerup = canvas.onpointercancel = () => { dragging = false; };
    canvas.onwheel = e => {
      e.preventDefault();
      const rect   = svg.getBoundingClientRect();
      const mx     = (e.clientX - rect.left) * (VW / rect.width);
      const my     = (e.clientY - rect.top)  * (VH / rect.height);
      const factor = e.deltaY < 0 ? 1.06 : 0.94;
      const ns     = Math.min(4, Math.max(0.25, vscale * factor));
      vx = mx - (mx - vx) * (ns / vscale);
      vy = my - (my - vy) * (ns / vscale);
      vscale = ns;
      clampTransform(); applyTransform();
    };
  }

  function zoomBy(f, cx = VW / 2, cy = VH / 2) {
    const ns = Math.min(4, Math.max(0.25, vscale * f));
    vx = cx - (cx - vx) * (ns / vscale);
    vy = cy - (cy - vy) * (ns / vscale);
    vscale = ns;
    clampTransform(); applyTransform();
  }

  function syncFilterButtons() {
    const f = state.linkedFilter;
    $('#filterFacts').setAttribute('aria-pressed',     f === 'facts'     ? 'true' : 'false');
    $('#filterQuestions').setAttribute('aria-pressed', f === 'questions' ? 'true' : 'false');
    $('#filterHint').textContent = f ? `Showing only ${f} directly linked to selected node` : '';
  }

  function renderDetail() {
    const n = byId(state.currentId) || state.nodes[0];
    if (!n) return;
    state.currentId = n.id;

    $('#factTitle').textContent   = n.title;
    $('#factSummary').textContent = n.summary;

    const existingVote = userVoteFor(n.id);
    const sliderVal    = existingVote ? existingVote.value : Math.round(n.confidence);
    $('#confidenceValue').textContent = sliderVal;
    $('#voteRange').value              = sliderVal;

    $('#voteBtn').disabled = false;
    if (existingVote) {
      $('#voteBtn').textContent           = 'Update vote';
      $('#voteNotice').textContent        = `Your current vote: ${existingVote.value}/5. Move the slider to change it.`;
      $('#voteNotice').classList.remove('hidden');
    } else {
      $('#voteBtn').textContent = 'Vote';
      $('#voteNotice').classList.add('hidden');
    }

    const summary  = state.nodeVoteSummary.find(s => s.id === n.id);
    const total    = summary ? Number(summary.total_votes) : 0;
    const up       = summary ? Number(summary.up_votes)    : 0;
    const down     = summary ? Number(summary.down_votes)  : 0;
    const statusCls = n.status === 'challenged' ? 'conflict'
                    : n.type === 'question'     ? 'question'
                    : n.status === 'new'        ? 'pending'
                    : 'support';
    const voteLabel = total === 0 ? 'no votes yet'
                    : total < 10 ? `${total} votes (new)`
                    : total < 100 ? `${total} votes (growing)`
                    : up / total > 0.65 ? `${total} votes \u2714 accepted`
                    : down / total > 0.65 ? `${total} votes \u2716 rejected`
                    : `${total} votes \u007e contested`;

    $('#factMeta').innerHTML =
      `<span class="badge ${statusCls}">${esc(n.status)}</span>` +
      `<span class="badge">${esc(n.type)}</span>` +
      `<span class="badge">${voteLabel}</span>` +
      `<span class="badge">avg: ${Number(summary?.avg_confidence ?? n.confidence).toFixed(1)}</span>`;

    renderChallengeVoteSection(n);
    renderLinkedPanel();
    renderSources(n);
    syncFilterButtons();
  }

  function renderChallengeVoteSection(n) {
    const section = $('#challengeVoteSection');
    if (n.status !== 'challenged') {
      section.classList.add('hidden');
      return;
    }
    const ch = state.challenges.find(c => c.target_id === n.id && c.target_type === 'node');
    if (!ch) { section.classList.add('hidden'); return; }

    const cvs       = state.challengeVoteSummary.find(s => s.challenge_id === ch.id);
    const total     = cvs ? Number(cvs.total_votes)   : 0;
    const valid     = cvs ? Number(cvs.valid_votes)   : 0;
    const invalid   = cvs ? Number(cvs.invalid_votes) : 0;
    const userCv    = state.challengeVotes.find(cv => cv.challenge_id === ch.id && cv.user_id === currentUser?.id);

    $('#challengeReason').textContent = ch.reason || '(no reason given)';

    const barHtml = total === 0
      ? '<span style="opacity:.5">No votes yet on this challenge.</span>'
      : `<div class="cv-bar-wrap">
           <div class="cv-bar-valid"   style="width:${Math.round(valid/total*100)}%">${valid} valid</div>
           <div class="cv-bar-invalid" style="width:${Math.round(invalid/total*100)}%">${invalid} no problem</div>
         </div>
         <small style="opacity:.6">${total} total votes</small>`;
    $('#challengeVoteBar').innerHTML = barHtml;

    const validBtn    = $('#cvValid');
    const invalidBtn  = $('#cvInvalid');
    const withdrawBtn = $('#cvWithdraw');

    if (userCv) {
      validBtn.textContent    = userCv.is_valid ? '\u2714 You said: valid concern' : '\u2714 Valid concern';
      invalidBtn.textContent  = !userCv.is_valid ? '\u2714 You said: no problem' : '\u2717 No problem';
      if (withdrawBtn) {
        withdrawBtn.textContent = '\u2715 Withdraw my vote';
        withdrawBtn.classList.remove('hidden');
      }
    } else {
      validBtn.textContent   = '\u2714 Valid concern';
      invalidBtn.textContent = '\u2717 No problem';
      if (withdrawBtn) withdrawBtn.classList.add('hidden');
    }

    section.classList.remove('hidden');

    // Replace buttons to remove stale listeners
    const newValid    = validBtn.cloneNode(true);
    const newInvalid  = invalidBtn.cloneNode(true);
    validBtn.parentNode.replaceChild(newValid, validBtn);
    invalidBtn.parentNode.replaceChild(newInvalid, invalidBtn);
    newValid.addEventListener('click',   () => submitChallengeVote(ch.id, true));
    newInvalid.addEventListener('click', () => submitChallengeVote(ch.id, false));

    if (withdrawBtn) {
      const newWithdraw = withdrawBtn.cloneNode(true);
      withdrawBtn.parentNode.replaceChild(newWithdraw, withdrawBtn);
      if (userCv) {
        newWithdraw.classList.remove('hidden');
        newWithdraw.addEventListener('click', () => withdrawChallengeVote(ch.id));
      } else {
        newWithdraw.classList.add('hidden');
      }
    }
  }

  async function submitChallengeVote(challengeId, isValid) {
    const notice = $('#challengeVoteNotice');
    const existing = state.challengeVotes.find(
      cv => cv.challenge_id === challengeId && cv.user_id === currentUser?.id
    );

    let error;
    if (existing) {
      // Update existing vote — user changed their mind
      ({ error } = await sb.from('challenge_votes')
        .update({ is_valid: isValid })
        .eq('id', existing.id));
    } else {
      // New vote — only send the columns that actually exist on the table
      ({ error } = await sb.from('challenge_votes').insert({
        challenge_id: challengeId,
        user_id:      currentUser.id,
        is_valid:     isValid
      }));
    }

    if (error) {
      notice.textContent = error.message;
      notice.classList.remove('hidden');
      return;
    }
    notice.classList.add('hidden');
    await loadAll();
    renderGraph();
    renderDetail();
  }

  async function withdrawChallengeVote(challengeId) {
    const notice = $('#challengeVoteNotice');
    const existing = state.challengeVotes.find(
      cv => cv.challenge_id === challengeId && cv.user_id === currentUser?.id
    );
    if (!existing) return;

    const { error } = await sb.from('challenge_votes')
      .delete()
      .eq('id', existing.id);

    if (error) {
      notice.textContent = error.message;
      notice.classList.remove('hidden');
      return;
    }
    notice.classList.add('hidden');
    await loadAll();
    renderGraph();
    renderDetail();
  }

  function renderLinkedPanel() {
    const n = byId(state.currentId);
    if (!n) { $('#linkedFacts').innerHTML = '<div class="item"><p>No node selected.</p></div>'; return; }

    const f = state.linkedFilter;
    let neighbours = getNeighbours(n.id);
    if (f === 'facts')     neighbours = neighbours.filter(({ node }) => node.type === 'fact' || node.type === 'claim');
    else if (f === 'questions') neighbours = neighbours.filter(({ node }) => node.type === 'question');
    neighbours.sort((a, b) => (a.node.type === 'question') - (b.node.type === 'question'));

    $('#lowerLeftTitle').textContent =
      f === 'facts'     ? `Facts linked to: ${short(n.title, 40)}`
      : f === 'questions' ? `Questions linked to: ${short(n.title, 40)}`
      : 'Linked nodes';

    $('#linkedFacts').innerHTML = neighbours.length
      ? neighbours.map(({ node: ln, kind }) => {
          const lc        = ln.status === 'challenged' ? 'conflict' : ln.type === 'question' ? 'question' : ln.status === 'new' ? 'pending' : 'support';
          const kindLabel = kind === 'support' ? 'supports' : kind === 'conflict' ? 'conflicts' : 'depends';
          return `<div class="item clickable" data-navigate="${ln.id}">
            <div class="badges" style="margin-bottom:.25rem">
              <span class="badge ${lc}">${esc(ln.type)}</span>
              <span class="badge">${esc(ln.status)}</span>
              <span class="badge">${esc(kindLabel)}</span>
            </div>
            <h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p>
            <small>Click to select \u2192 ${ln.id}</small>
          </div>`;
        }).join('')
      : `<div class="item"><p>${f ? 'No ' + f + ' linked to this node.' : 'No linked nodes.'}</p></div>`;

    $$('[data-navigate]').forEach(el => el.addEventListener('click', () => {
      state.currentId = el.dataset.navigate;
      renderGraph();
      renderDetail();
    }));
  }

  function renderSources(n) {
    const srcs = (n.sources || []).map(id => state.sources[id]).filter(Boolean);
    $('#sources').innerHTML = srcs.length
      ? srcs.map(s => `<div class="item">
          <h4>${esc(s.title)}</h4>
          <p>${esc(s.note)}</p>
          <small>${esc(s.kind)} \u00b7 quality: ${esc(s.quality)}</small>
          <div class="source-actions">
            <button class="btn" data-sid="${s.id}" data-action="irrelevant">Challenge: irrelevant</button>
            <button class="btn error" data-sid="${s.id}" data-action="false">Challenge: false</button>
          </div>
        </div>`).join('')
      : '<div class="item"><p>No sources attached yet.</p></div>';
    $$('[data-sid]').forEach(btn => btn.addEventListener('click', () => openChallenge(btn.dataset.sid, btn.dataset.action)));
  }

  function setView(view) {
    state.view = view;
    $$('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    const titles = { graph: 'Knowledge graph' };
    const subs   = { graph: 'Atomic facts, linked evidence, crowd review' };
    $('#viewTitle').textContent = titles[view] || view;
    $('#viewSub').textContent   = subs[view]   || '';
    renderGraph();
    renderDetail();
    renderStats();
  }

  function openChallenge(targetId, mode) {
    const src      = state.sources[targetId];
    const isSource = !!src;
    $('#challengeTypeWrap').classList.toggle('hidden', !isSource);
    if (isSource) {
      $('#modalTitle').textContent  = mode === 'irrelevant' ? 'Challenge: source not relevant' : 'Challenge: source unreliable';
      $('#modalIntro').textContent  = `Source: "${src.title}"`;
      $('#challengeType').value     = mode;
    } else {
      const fact = byId(targetId);
      $('#modalTitle').textContent = 'Challenge fact';
      $('#modalIntro').textContent = fact ? `Fact: "${fact.title}"` : `ID: ${targetId}`;
    }
    $('#targetInfo').value               = targetId;
    $('#challengeReason').value          = '';
    $('#challengeNotice').classList.add('hidden');
    $('#challengeModal').classList.add('show');
  }

  // ── Connect-nodes modal ─────────────────────────────────────────
  let _connectSelectedId = null;

  function openConnectModal() {
    const fromNode = byId(state.currentId);
    if (!fromNode) return;

    _connectSelectedId = null;
    $('#connectFrom').value = `${fromNode.title} (${fromNode.id})`;
    $('#connectSearch').value = '';
    $('#connectTargetId').value = '';
    $('#connectNodeList').innerHTML = '';
    $('#connectNodeList').classList.remove('open');
    $('#connectSelectedPreview').classList.add('hidden');
    $('#connectSubmitBtn').disabled = true;
    $('#connectKind').value = 'support';
    $('#connectNotice').classList.add('hidden');
    $('#connectModal').classList.add('show');
    setTimeout(() => $('#connectSearch').focus(), 80);
  }

  function populateConnectList(query) {
    const fromId = state.currentId;
    const q = (query || '').trim().toLowerCase();
    const list = $('#connectNodeList');

    const alreadyLinked = new Set(
      (byId(fromId)?.links || []).map(l => l.to)
    );

    const matches = state.nodes.filter(n =>
      n.id !== fromId &&
      !alreadyLinked.has(n.id) &&
      (q === '' || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
    ).slice(0, 30);

    if (matches.length === 0) {
      list.innerHTML = '<div class="connect-node-option" style="color:var(--faint);cursor:default">No matching nodes</div>';
      list.classList.add('open');
      return;
    }

    list.innerHTML = matches.map(n =>
      `<div class="connect-node-option" data-node-id="${n.id}" role="option" tabindex="0">
        ${esc(short(n.title, 60))}<span class="opt-type">${esc(n.type)} · ${esc(n.status)}</span>
      </div>`
    ).join('');
    list.classList.add('open');

    list.querySelectorAll('[data-node-id]').forEach(el => {
      el.addEventListener('click', () => selectConnectTarget(el.dataset.nodeId));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectConnectTarget(el.dataset.nodeId); });
    });
  }

  function selectConnectTarget(nodeId) {
    const node = byId(nodeId);
    if (!node) return;
    _connectSelectedId = nodeId;
    $('#connectTargetId').value = nodeId;
    $('#connectSearch').value = node.title;
    $('#connectNodeList').classList.remove('open');
    $('#connectPreviewTitle').textContent = `${node.title} (${node.id})`;
    $('#connectSelectedPreview').classList.remove('hidden');
    $('#connectSubmitBtn').disabled = false;
  }

  function clearConnectTarget() {
    _connectSelectedId = null;
    $('#connectTargetId').value = '';
    $('#connectSearch').value = '';
    $('#connectSelectedPreview').classList.add('hidden');
    $('#connectSubmitBtn').disabled = true;
    $('#connectNodeList').classList.remove('open');
    $('#connectSearch').focus();
  }

  async function handleConnectSubmit(e) {
    e.preventDefault();
    const fromId  = state.currentId;
    const toId    = _connectSelectedId;
    const kind    = $('#connectKind').value;
    const notice  = $('#connectNotice');

    if (!fromId || !toId) {
      notice.textContent = 'Please select a target node.';
      notice.classList.remove('hidden');
      return;
    }

    const alreadyLinked = (byId(fromId)?.links || []).some(l => l.to === toId);
    if (alreadyLinked) {
      notice.textContent = 'A connection from this node to the target already exists.';
      notice.classList.remove('hidden');
      return;
    }

    const { error } = await sb.from('links').insert({
      from_id:    fromId,
      to_id:      toId,
      kind:       kind,
      created_by: currentUser.id
    });

    if (error) {
      notice.textContent = error.message;
      notice.classList.remove('hidden');
      return;
    }

    notice.textContent = `Connection created: ${short(byId(fromId)?.title, 30)} \u2192 ${short(byId(toId)?.title, 30)}.`;
    notice.classList.remove('hidden');

    await loadAll();
    renderGraph();
    renderDetail();

    setTimeout(() => {
      $('#connectModal').classList.remove('show');
      notice.classList.add('hidden');
    }, 1200);
  }
  // ────────────────────────────────────────────────────────────────

  async function handleVote() {
    const n = byId(state.currentId);
    if (!n) return;
    const value = parseInt($('#voteRange').value, 10);
    const { error } = await sb.rpc('upsert_vote', { p_node_id: n.id, p_value: value });
    if (error) {
      $('#voteNotice').textContent = error.message;
      $('#voteNotice').classList.remove('hidden');
      return;
    }
    await loadAll();
    $('#voteNotice').textContent = `Vote saved (${value}/5).`;
    $('#voteNotice').classList.remove('hidden');
    renderDetail();
    renderGraph();
  }

  async function handleChallengeSubmit(e) {
    e.preventDefault();
    const target    = $('#targetInfo').value;
    const isSource  = !!state.sources[target];
    const targetType = isSource ? 'source' : 'node';

    const payload = {
      id:             'c' + Date.now(),
      target_id:      target,
      target_type:    targetType,
      challenge_type: isSource ? $('#challengeType').value : 'dispute',
      reason:         $('#challengeReason').value.trim(),
      user_id:        currentUser.id,
      status:         'pending'
    };

    const { error } = await sb.from('challenges').insert(payload);
    if (error) {
      $('#challengeNotice').textContent = error.message;
      $('#challengeNotice').classList.remove('hidden');
      return;
    }

    if (targetType === 'node') {
      await sb.from('nodes').update({ status: 'challenged' }).eq('id', target);
    }

    $('#challengeNotice').textContent = 'Challenge submitted.';
    $('#challengeNotice').classList.remove('hidden');
    await loadAll();
    renderStats();
    renderGraph();
    renderDetail();
  }

  async function handleFactSubmit(e) {
    e.preventDefault();
    const id        = 'f' + Date.now();
    const title     = $('#newFactTitle').value.trim();
    const summary   = $('#newFactSummary').value.trim();
    const type      = $('#newFactType').value;
    const linkedIds = $('#newFactLinks').value.split(',').map(s => s.trim()).filter(Boolean);

    const { error: nodeErr } = await sb.from('nodes').insert({
      id, title, summary, type,
      status:      'new',
      confidence:  3.0,
      votes_count: 0,
      created_by:  currentUser.id
    });
    if (nodeErr) {
      $('#factNotice').textContent = nodeErr.message;
      $('#factNotice').classList.remove('hidden');
      return;
    }

    if (linkedIds.length) {
      const { error: linkErr } = await sb.from('links').insert(
        linkedIds.map(to => ({ from_id: id, to_id: to, kind: 'support', created_by: currentUser.id }))
      );
      if (linkErr) {
        $('#factNotice').textContent = linkErr.message;
        $('#factNotice').classList.remove('hidden');
        return;
      }
    }

    $('#factNotice').textContent = `"${title}" published to the graph.`;
    $('#factNotice').classList.remove('hidden');
    await loadAll();
    state.currentId = id;
    renderStats();
    renderGraph();
    renderDetail();
  }

  async function handleSourceSubmit(e) {
    e.preventDefault();
    const n   = byId(state.currentId);
    if (!n) return;
    const sid = 's' + Date.now();
    const { error: srcErr } = await sb.from('sources').insert({
      id:         sid,
      title:      $('#srcTitle').value.trim(),
      kind:       $('#srcKind').value,
      quality:    $('#srcQuality').value,
      note:       $('#srcNote').value.trim() || '',
      created_by: currentUser.id
    });
    if (srcErr) {
      $('#sourceNotice').textContent = srcErr.message;
      $('#sourceNotice').classList.remove('hidden');
      return;
    }
    const { error: joinErr } = await sb.from('node_sources').insert({ node_id: n.id, source_id: sid });
    if (joinErr) {
      $('#sourceNotice').textContent = joinErr.message;
      $('#sourceNotice').classList.remove('hidden');
      return;
    }
    $('#sourceNotice').textContent = `Source attached to "${short(n.title, 50)}".`;
    $('#sourceNotice').classList.remove('hidden');
    await loadAll();
    renderDetail();
  }

  function bindUI() {
    $('#themeBtn').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
    $('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); window.location.href = '../'; });

    $('#voteRange').addEventListener('input', e => {
      $('#confidenceValue').textContent = Number(e.target.value).toFixed(1);
    });
    $('#voteBtn').addEventListener('click', handleVote);

    $('#factChallengeBtn').addEventListener('click', () => openChallenge(state.currentId, null));
    $('#closeModal').addEventListener('click',       () => $('#challengeModal').classList.remove('show'));
    $('#challengeModal').addEventListener('click', e => { if (e.target === $('#challengeModal')) $('#challengeModal').classList.remove('show'); });
    $('#challengeForm').addEventListener('submit', handleChallengeSubmit);

    $('#addFactBtn').addEventListener('click', () => {
      $('#newFactTitle').value = ''; $('#newFactSummary').value = ''; $('#newFactLinks').value = '';
      $('#factNotice').classList.add('hidden');
      $('#factModal').classList.add('show');
    });
    $('#closeFactModal').addEventListener('click',   () => $('#factModal').classList.remove('show'));
    $('#factModal').addEventListener('click', e => { if (e.target === $('#factModal')) $('#factModal').classList.remove('show'); });
    $('#factForm').addEventListener('submit', handleFactSubmit);

    // Connect modal
    $('#connectBtn').addEventListener('click', openConnectModal);
    $('#closeConnectModal').addEventListener('click', () => $('#connectModal').classList.remove('show'));
    $('#connectModal').addEventListener('click', e => { if (e.target === $('#connectModal')) $('#connectModal').classList.remove('show'); });
    $('#connectSearch').addEventListener('input', e => populateConnectList(e.target.value));
    $('#connectSearch').addEventListener('focus', e => populateConnectList(e.target.value));
    $('#connectSearch').addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('#connectNodeList').classList.remove('open'); }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#connectModal')) return;
      if (!e.target.closest('#connectSearch') && !e.target.closest('#connectNodeList')) {
        $('#connectNodeList').classList.remove('open');
      }
    });
    $('#connectClearTarget').addEventListener('click', clearConnectTarget);
    $('#connectForm').addEventListener('submit', handleConnectSubmit);

    $('#cancelSource').addEventListener('click', () => $('#addSourceDetails').removeAttribute('open'));
    $('#sourceForm').addEventListener('submit', handleSourceSubmit);

    // #navLinks may not exist now that the sidebar is removed — guard it
    const navLinks = $('#navLinks');
    if (navLinks) {
      navLinks.addEventListener('click', e => {
        const a = e.target.closest('[data-view]');
        if (a) { e.preventDefault(); setView(a.dataset.view); }
      });
    }

    $('#filterFacts').addEventListener('click', () => {
      state.linkedFilter = state.linkedFilter === 'facts' ? null : 'facts';
      syncFilterButtons(); renderGraph(); renderLinkedPanel();
    });
    $('#filterQuestions').addEventListener('click', () => {
      state.linkedFilter = state.linkedFilter === 'questions' ? null : 'questions';
      syncFilterButtons(); renderGraph(); renderLinkedPanel();
    });

    $('#zoomIn').addEventListener('click',    () => zoomBy(1.2));
    $('#zoomOut').addEventListener('click',   () => zoomBy(0.83));
    $('#zoomReset').addEventListener('click', () => { vx = 0; vy = 0; vscale = 1; applyTransform(); });
  }

  init().catch(err => {
    console.error(err);
    document.body?.insertAdjacentHTML('afterbegin',
      `<div style="padding:1rem;color:#fff;background:#7d1e5e">Supabase init failed: ${esc(err.message || err)}</div>`);
  });
})();
