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
    submissions: [],
    positions: structuredClone(BASE_POS),
    currentId: 'f1',
    view: 'graph',
    linkedFilter: null
  };

  // ── Theme toggle ────────────────────────────────────────────────
  const ICONS = { dark: '&#9790;', light: '&#9728;' };
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    const btn = $('#themeBtn');
    if (btn) {
      btn.innerHTML = ICONS[t];
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  applyTheme(theme);
  // ────────────────────────────────────────────────────────────────

  async function init() {
    await requireAuth();
    await loadAll();
    bindUI();
    setView(state.view || 'graph');
  }

  async function requireAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../';
      return;
    }
    currentUser = session.user;
    $('#usernameLabel').textContent = currentUser.email || currentUser.user_metadata?.username || 'user';

    const { data: p } = await sb
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();

    profile = p || null;
  }

  async function loadAll() {
    const [
      nodesRes,
      linksRes,
      sourcesRes,
      nodeSourcesRes,
      votesRes,
      challengesRes,
      submissionsRes
    ] = await Promise.all([
      sb.from('nodes').select('*').order('created_at', { ascending: true }),
      sb.from('links').select('*'),
      sb.from('sources').select('*'),
      sb.from('node_sources').select('*'),
      sb.from('votes').select('*'),
      sb.from('challenges').select('*').order('created_at', { ascending: false }),
      sb.from('submissions').select('*').order('created_at', { ascending: false })
    ]);

    if (nodesRes.error) throw nodesRes.error;
    if (linksRes.error) throw linksRes.error;
    if (sourcesRes.error) throw sourcesRes.error;
    if (nodeSourcesRes.error) throw nodeSourcesRes.error;
    if (votesRes.error) throw votesRes.error;

    state.nodes = (nodesRes.data || []).map(n => ({
      ...n,
      votes: n.votes_count,
      sources: (nodeSourcesRes.data || []).filter(ns => ns.node_id === n.id).map(ns => ns.source_id),
      links: (linksRes.data || []).filter(l => l.from_id === n.id).map(l => ({ to: l.to_id, kind: l.kind }))
    }));
    state.links = linksRes.data || [];
    state.sources = Object.fromEntries((sourcesRes.data || []).map(s => [s.id, s]));
    state.nodeSources = nodeSourcesRes.data || [];
    state.votes = votesRes.data || [];
    state.challenges = challengesRes.data || [];
    state.submissions = submissionsRes.data || [];

    if (!byId(state.currentId) && state.nodes[0]) state.currentId = state.nodes[0].id;

    renderStats();
  }

  function byId(id) {
    return state.nodes.find(n => n.id === id);
  }

  function queueItems() {
    return [
      ...state.submissions,
      ...state.challenges.filter(c => c.status === 'pending')
    ];
  }

  function userVoteFor(nodeId) {
    return state.votes.find(v => v.node_id === nodeId && v.user_id === currentUser?.id);
  }

  function getNeighbours(id) {
    const seen = new Set();
    const result = [];
    const node = byId(id);

    if (node) {
      (node.links || []).forEach(l => {
        const nb = byId(l.to);
        if (nb && !seen.has(nb.id)) {
          seen.add(nb.id);
          result.push({ node: nb, kind: l.kind });
        }
      });
    }

    state.nodes.forEach(m => {
      (m.links || []).forEach(l => {
        if (l.to === id && !seen.has(m.id)) {
          seen.add(m.id);
          result.push({ node: m, kind: l.kind });
        }
      });
    });

    return result;
  }

  function renderStats() {
    $('#statFacts').textContent = state.nodes.filter(n => n.type === 'fact').length;
    $('#statQuestions').textContent = state.nodes.filter(n => n.type === 'question').length;
    $('#statQueue').textContent = queueItems().length;
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
        const mx = (x1 + x2) / 2;
        const cls = l.kind === 'support' ? 'support' : l.kind === 'conflict' ? 'conflict' : 'depend';
        const mk = l.kind === 'support' ? 'url(#aS)' : l.kind === 'conflict' ? 'url(#aC)' : 'url(#aD)';
        edges += `<path class="edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="${mk}"/>`;
      });
    });

    let nodes = '';
    state.nodes.forEach(n => {
      if (visibleIds && !visibleIds.has(n.id)) return;
      const [x, y] = posOf(n.id);
      const active = n.id === state.currentId;
      const r = active ? 34 : 26;
      const fillOuter = n.status === 'challenged'
        ? 'color-mix(in oklab,var(--error) 18%,var(--surface2))'
        : n.type === 'question'
          ? 'color-mix(in oklab,var(--warn) 15%,var(--surface2))'
          : n.status === 'pending'
            ? 'color-mix(in oklab,var(--warn) 15%,var(--surface2))'
            : 'color-mix(in oklab,var(--primary) 15%,var(--surface2))';
      const fillDot = n.status === 'challenged'
        ? 'var(--error)'
        : n.type === 'question'
          ? 'var(--warn)'
          : n.status === 'pending'
            ? 'var(--warn)'
            : 'var(--primary)';

      nodes += `<g class="node${active ? ' active-node' : ''}" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fillOuter}"/>
        <circle cx="${x}" cy="${y}" r="7" fill="${fillDot}"/>
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
    const svg = $('#graphSvg');
    let dragging = false, startX = 0, startY = 0, startVx = 0, startVy = 0, lastDist = null;

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
    canvas.onpointerup = canvas.onpointercancel = () => { dragging = false; lastDist = null; };

    canvas.onwheel = e => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (VW / rect.width);
      const my = (e.clientY - rect.top) * (VH / rect.height);
      const factor = e.deltaY < 0 ? 1.06 : 0.94;
      const ns = Math.min(4, Math.max(0.25, vscale * factor));
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
    $('#filterFacts').setAttribute('aria-pressed', f === 'facts' ? 'true' : 'false');
    $('#filterQuestions').setAttribute('aria-pressed', f === 'questions' ? 'true' : 'false');
    $('#filterHint').textContent = f ? `Showing only ${f} directly linked to selected node` : '';
  }

  function renderDetail() {
    const n = byId(state.currentId) || state.nodes[0];
    if (!n) return;
    state.currentId = n.id;

    $('#factTitle').textContent = n.title;
    $('#factSummary').textContent = n.summary;

    const existingVote = userVoteFor(n.id);
    const sliderVal = existingVote ? existingVote.value : Math.round(n.confidence);
    $('#confidenceValue').textContent = sliderVal;
    $('#voteRange').value = sliderVal;

    $('#voteBtn').disabled = false;
    if (existingVote) {
      $('#voteBtn').textContent = 'Update vote';
      $('#voteNotice').textContent = `Your current vote: ${existingVote.value}/5. Move the slider to change it.`;
      $('#voteNotice').classList.remove('hidden');
    } else {
      $('#voteBtn').textContent = 'Vote';
      $('#voteNotice').classList.add('hidden');
    }

    const cls = n.status === 'challenged' ? 'conflict' : n.type === 'question' ? 'question' : n.status === 'pending' ? 'pending' : 'support';
    $('#factMeta').innerHTML =
      `<span class="badge ${cls}">${esc(n.status)}</span>` +
      `<span class="badge">${esc(n.type)}</span>` +
      `<span class="badge">${n.votes} votes</span>` +
      `<span class="badge">confidence: ${Number(n.confidence).toFixed(1)}</span>`;

    renderLinkedPanel();
    renderSources(n);
    syncFilterButtons();
  }

  function renderLinkedPanel() {
    const n = byId(state.currentId);
    if (!n) {
      $('#linkedFacts').innerHTML = '<div class="item"><p>No node selected.</p></div>';
      return;
    }

    const f = state.linkedFilter;
    let neighbours = getNeighbours(n.id);

    if (f === 'facts') neighbours = neighbours.filter(({ node }) => node.type === 'fact' || node.type === 'claim');
    else if (f === 'questions') neighbours = neighbours.filter(({ node }) => node.type === 'question');

    neighbours.sort((a, b) => (a.node.type === 'question') - (b.node.type === 'question'));

    $('#lowerLeftTitle').textContent =
      f === 'facts' ? `Facts linked to: ${short(n.title, 40)}`
      : f === 'questions' ? `Questions linked to: ${short(n.title, 40)}`
      : 'Linked nodes';

    $('#linkedFacts').innerHTML = neighbours.length
      ? neighbours.map(({ node: ln, kind }) => {
          const lc = ln.status === 'challenged' ? 'conflict' : ln.type === 'question' ? 'question' : ln.status === 'pending' ? 'pending' : 'support';
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

  function renderQueue() {
    const items = queueItems();
    $('#lowerLeftTitle').textContent = 'Moderation queue';
    $('#linkedFacts').innerHTML = items.length
      ? items.map(item => {
          const ts = item.created_at ? new Date(item.created_at).toLocaleString() : '';
          return `<div class="item">
            <h4>${esc(item.title || item.reason || item.id)}</h4>
            <p>${esc(item.summary || item.reason || '')}</p>
            <small>${esc(item.target_type || 'submission')} \u00b7 ${esc(item.status || 'pending')} \u00b7 ${ts}</small>
          </div>`;
        }).join('')
      : '<div class="item"><p>Queue is empty.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Facts gain stable status automatically as community confidence votes accumulate.</p></div>';
  }

  function setView(view) {
    state.view = view;
    $$('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    const titles = { graph: 'Knowledge graph', queue: 'Moderation queue' };
    const subs = { graph: 'Atomic facts, linked evidence, crowd review', queue: 'Pending submissions and challenges for review' };
    $('#viewTitle').textContent = titles[view] || view;
    $('#viewSub').textContent = subs[view] || '';
    const isQueue = view === 'queue';
    $('#graphPanel').classList.toggle('hidden', isQueue);
    $('#detailPanel').classList.toggle('hidden', isQueue);
    $('#sourcesPanel').classList.toggle('hidden', isQueue);
    if (isQueue) renderQueue();
    else { renderGraph(); renderDetail(); }
    renderStats();
  }

  function openChallenge(targetId, mode) {
    const src = state.sources[targetId];
    const isSource = !!src;
    $('#challengeTypeWrap').classList.toggle('hidden', !isSource);
    if (isSource) {
      $('#modalTitle').textContent = mode === 'irrelevant' ? 'Challenge: source not relevant' : 'Challenge: source unreliable';
      $('#modalIntro').textContent = `Source: "${src.title}"`;
      $('#challengeType').value = mode;
    } else {
      const fact = byId(targetId);
      $('#modalTitle').textContent = 'Challenge fact';
      $('#modalIntro').textContent = fact ? `Fact: "${fact.title}"` : `ID: ${targetId}`;
    }
    $('#targetInfo').value = targetId;
    $('#challengeReason').value = '';
    $('#challengeNotice').classList.add('hidden');
    $('#challengeModal').classList.add('show');
  }

  async function handleVote() {
    const n = byId(state.currentId);
    if (!n) return;
    const value = parseInt($('#voteRange').value, 10);

    const { error } = await sb.rpc('upsert_vote', {
      p_node_id: n.id,
      p_value: value
    });
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
    const target = $('#targetInfo').value;
    const isSource = !!state.sources[target];

    const payload = {
      id: 'c' + Date.now(),
      target_id: target,
      target_type: isSource ? 'source' : 'fact',
      challenge_type: isSource ? $('#challengeType').value : 'fact',
      reason: $('#challengeReason').value.trim(),
      user_id: currentUser.id,
      status: 'pending'
    };

    const { error } = await sb.from('challenges').insert(payload);
    if (error) {
      $('#challengeNotice').textContent = error.message;
      $('#challengeNotice').classList.remove('hidden');
      return;
    }

    $('#challengeNotice').textContent = 'Challenge submitted. It is now in the queue.';
    $('#challengeNotice').classList.remove('hidden');
    await loadAll();
    renderStats();
    renderGraph();
    renderDetail();
  }

  async function handleFactSubmit(e) {
    e.preventDefault();
    const id = 'f' + Date.now();
    const title = $('#newFactTitle').value.trim();
    const summary = $('#newFactSummary').value.trim();
    const type = $('#newFactType').value;
    const linkedIds = $('#newFactLinks').value.split(',').map(s => s.trim()).filter(Boolean);

    const nodePayload = {
      id,
      title,
      summary,
      type,
      status: 'pending',
      confidence: 3.0,
      votes_count: 0,
      created_by: currentUser.id
    };

    const { error: nodeErr } = await sb.from('nodes').insert(nodePayload);
    if (nodeErr) {
      $('#factNotice').textContent = nodeErr.message;
      $('#factNotice').classList.remove('hidden');
      return;
    }

    if (linkedIds.length) {
      const linksPayload = linkedIds.map(to => ({
        from_id: id,
        to_id: to,
        kind: 'support',
        created_by: currentUser.id
      }));
      const { error: linkErr } = await sb.from('links').insert(linksPayload);
      if (linkErr) {
        $('#factNotice').textContent = linkErr.message;
        $('#factNotice').classList.remove('hidden');
        return;
      }
    }

    const { error: subErr } = await sb.from('submissions').insert({
      id,
      node_id: id,
      title,
      summary,
      type,
      links: linkedIds,
      user_id: currentUser.id,
      status: 'pending'
    });

    if (subErr) {
      $('#factNotice').textContent = subErr.message;
      $('#factNotice').classList.remove('hidden');
      return;
    }

    $('#factNotice').textContent = `"${title}" submitted.`;
    $('#factNotice').classList.remove('hidden');
    await loadAll();
    state.currentId = id;
    renderStats();
    renderGraph();
    renderDetail();
  }

  async function handleSourceSubmit(e) {
    e.preventDefault();
    const n = byId(state.currentId);
    if (!n) return;

    const sid = 's' + Date.now();
    const sourcePayload = {
      id: sid,
      title: $('#srcTitle').value.trim(),
      kind: $('#srcKind').value,
      quality: $('#srcQuality').value,
      note: $('#srcNote').value.trim() || '',
      created_by: currentUser.id
    };

    const { error: srcErr } = await sb.from('sources').insert(sourcePayload);
    if (srcErr) {
      $('#sourceNotice').textContent = srcErr.message;
      $('#sourceNotice').classList.remove('hidden');
      return;
    }

    const { error: joinErr } = await sb.from('node_sources').insert({
      node_id: n.id,
      source_id: sid
    });

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
    // Theme toggle
    $('#themeBtn').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
    });

    $('#logoutBtn').addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.href = '../';
    });

    $('#voteRange').addEventListener('input', e => {
      $('#confidenceValue').textContent = Number(e.target.value).toFixed(1);
    });
    $('#voteBtn').addEventListener('click', handleVote);

    $('#factChallengeBtn').addEventListener('click', () => openChallenge(state.currentId, null));
    $('#closeModal').addEventListener('click', () => $('#challengeModal').classList.remove('show'));
    $('#challengeModal').addEventListener('click', e => { if (e.target === $('#challengeModal')) $('#challengeModal').classList.remove('show'); });
    $('#challengeForm').addEventListener('submit', handleChallengeSubmit);

    $('#addFactBtn').addEventListener('click', () => {
      $('#newFactTitle').value = '';
      $('#newFactSummary').value = '';
      $('#newFactLinks').value = '';
      $('#factNotice').classList.add('hidden');
      $('#factModal').classList.add('show');
    });
    $('#closeFactModal').addEventListener('click', () => $('#factModal').classList.remove('show'));
    $('#factModal').addEventListener('click', e => { if (e.target === $('#factModal')) $('#factModal').classList.remove('show'); });
    $('#factForm').addEventListener('submit', handleFactSubmit);

    $('#cancelSource').addEventListener('click', () => $('#addSourceDetails').removeAttribute('open'));
    $('#sourceForm').addEventListener('submit', handleSourceSubmit);

    $('#navLinks').addEventListener('click', e => {
      const a = e.target.closest('[data-view]');
      if (a) { e.preventDefault(); setView(a.dataset.view); }
    });

    $('#filterFacts').addEventListener('click', () => {
      state.linkedFilter = state.linkedFilter === 'facts' ? null : 'facts';
      syncFilterButtons(); renderGraph(); renderLinkedPanel();
    });
    $('#filterQuestions').addEventListener('click', () => {
      state.linkedFilter = state.linkedFilter === 'questions' ? null : 'questions';
      syncFilterButtons(); renderGraph(); renderLinkedPanel();
    });

    $('#zoomIn').addEventListener('click', () => zoomBy(1.2));
    $('#zoomOut').addEventListener('click', () => zoomBy(0.83));
    $('#zoomReset').addEventListener('click', () => { vx = 0; vy = 0; vscale = 1; applyTransform(); });
  }

  init().catch(err => {
    console.error(err);
    const el = document.body;
    if (el) el.insertAdjacentHTML('afterbegin', `<div style="padding:1rem;color:#fff;background:#7d1e5e">Supabase init failed: ${esc(err.message || err)}</div>`);
  });
})();
