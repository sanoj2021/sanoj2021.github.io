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
    linkVotes: [],
    linkVoteSummary: [],
    positions: structuredClone(BASE_POS),
    currentId: 'f1',
    selectedEdge: null,   // { fromId, toId, linkId, kind }
    view: 'graph',
    linkedFilter: null,
    search: { query: '', type: null, status: null }
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

  // ── Search / filter helpers ──────────────────────────────────────
  function searchActive() {
    const s = state.search;
    return s.query.trim() !== '' || s.type !== null || s.status !== null;
  }

  function matchesSearch(node) {
    const s = state.search;
    if (s.type && node.type !== s.type) return false;
    if (s.status && node.status !== s.status) return false;
    if (s.query.trim()) {
      const q = s.query.trim().toLowerCase();
      if (!(node.title || '').toLowerCase().includes(q) &&
          !(node.summary || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function updateSearchResultCount() {
    const badge = document.querySelector('#searchResultCount');
    if (!badge) return;
    if (!searchActive()) { badge.classList.add('hidden'); return; }
    const matched = state.nodes.filter(matchesSearch).length;
    badge.textContent = matched + ' / ' + state.nodes.length + ' nodes';
    badge.classList.remove('hidden');
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

  // ── Edge visual properties from link vote summary ────────────────
  function edgeVisuals(linkId) {
    const s = state.linkVoteSummary.find(s => s.id === linkId);
    if (!s || Number(s.total_votes) === 0) {
      return { strokeWidth: 2, opacity: 0.55, label: null };
    }
    const avg   = Number(s.avg_confidence);
    const total = Number(s.total_votes);
    const strokeWidth = 1.5 + ((avg - 1) / 4) * 3.5;
    const basOp  = 0.45 + ((avg - 1) / 4) * 0.55;
    const countBoost = Math.min(0.15, total * 0.01);
    const opacity = Math.min(1, basOp + countBoost);
    const label   = total >= 3 ? avg.toFixed(1) : null;
    return { strokeWidth, opacity, label };
  }

  // ── Find a link object by from/to pair ───────────────────────────
  function findLink(fromId, toId) {
    return state.links.find(l => l.from_id === fromId && l.to_id === toId);
  }

  function linkVoteByUser(linkId) {
    return state.linkVotes.find(v => v.link_id === linkId && v.user_id === currentUser?.id);
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
      nodeVoteSummaryRes, challengeVoteSummaryRes,
      linkVotesRes, linkVoteSummaryRes
    ] = await Promise.all([
      sb.from('nodes').select('*').order('created_at', { ascending: true }),
      sb.from('links').select('*'),
      sb.from('sources').select('*'),
      sb.from('node_sources').select('*'),
      sb.from('votes').select('*'),
      sb.from('challenges').select('*').order('created_at', { ascending: false }),
      sb.from('challenge_votes').select('*'),
      sb.from('node_vote_summary').select('*'),
      sb.from('challenge_vote_summary').select('*'),
      sb.from('link_votes').select('*'),
      sb.from('link_vote_summary').select('*')
    ]);

    if (nodesRes.error)   throw nodesRes.error;
    if (linksRes.error)   throw linksRes.error;
    if (sourcesRes.error) throw sourcesRes.error;

    state.nodes = (nodesRes.data || []).map(n => ({
      ...n,
      votes: n.votes_count,
      sources: (nodeSourcesRes.data || []).filter(ns => ns.node_id === n.id).map(ns => ns.source_id),
      links:   (linksRes.data   || []).filter(l => l.from_id === n.id).map(l => ({ to: l.to_id, kind: l.kind, id: l.id }))
    }));
    state.links                = linksRes.data || [];
    state.sources              = Object.fromEntries((sourcesRes.data || []).map(s => [s.id, s]));
    state.nodeSources          = nodeSourcesRes.data || [];
    state.votes                = votesRes.data || [];
    state.challenges           = challengesRes.data || [];
    state.challengeVotes       = challengeVotesRes.data || [];
    state.nodeVoteSummary      = nodeVoteSummaryRes.data || [];
    state.challengeVoteSummary = challengeVoteSummaryRes.data || [];
    state.linkVotes            = linkVotesRes.data || [];
    state.linkVoteSummary      = linkVoteSummaryRes.data || [];

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
        if (nb && !seen.has(nb.id)) { seen.add(nb.id); result.push({ node: nb, kind: l.kind, linkId: l.id }); }
      });
    }
    state.nodes.forEach(m => {
      (m.links || []).forEach(l => {
        if (l.to === id && !seen.has(m.id)) { seen.add(m.id); result.push({ node: m, kind: l.kind, linkId: l.id }); }
      });
    });
    return result;
  }

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

        const vis = l.id ? edgeVisuals(l.id) : { strokeWidth: 2, opacity: 0.55, label: null };
        const isSelected = state.selectedEdge?.linkId === l.id;
        const sw  = isSelected ? Math.max(vis.strokeWidth, 3) : vis.strokeWidth;
        const op  = isSelected ? 1 : vis.opacity;
        const selAttr = isSelected ? ' edge-selected' : '';

        edges += `<path class="edge-hit" data-link-id="${l.id ?? ''}" data-from="${n.id}" data-to="${l.to}"
          d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;

        edges += `<path class="edge ${cls}${selAttr}" data-link-id="${l.id ?? ''}" data-from="${n.id}" data-to="${l.to}"
          d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"
          marker-end="${mk}" style="stroke-width:${sw};opacity:${op}"/>`;

        if (vis.label) {
          const lx = (x1 + x2) / 2;
          const ly = (y1 + y2) / 2 - 7;
          edges += `<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">${vis.label}</text>`;
        }
      });
    });

    // Build search match set (null = no search active)
    const _sa = searchActive();
    const matchIds = _sa ? new Set(state.nodes.filter(matchesSearch).map(n => n.id)) : null;

    // Wizard connecting phase: build connectable set
    const wizConnecting = wizardState.phase === 'connecting';
    const ghostId = wizardState.newNodeId;

    let nodes = '';
    state.nodes.forEach(n => {
      if (visibleIds && !visibleIds.has(n.id)) return;
      const [x, y]  = posOf(n.id);
      const active  = n.id === state.currentId;
      const r       = active ? 34 : 26;
      const { fill, dot, opacity } = nodeColors(n.id);

      // Search dim / highlight
      const isMatch   = !matchIds || matchIds.has(n.id);
      const dimCls    = matchIds ? (isMatch ? ' search-match' : ' search-dim') : '';
      const nodeOpacity = (!matchIds || isMatch) ? opacity : Math.min(opacity, 0.12);

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

      // Animated highlight ring for search matches
      const ring = (matchIds && isMatch)
        ? `<circle class="search-ring" cx="${x}" cy="${y}" r="${r + 6}" fill="none" stroke="var(--primary)" stroke-width="2" opacity="0.55" stroke-dasharray="4 3"/>`
        : '';

      // Wizard connectable ring
      const isConnectable = wizConnecting && n.id !== ghostId;
      const isSelectedConn = isConnectable && wizardState.selectedConnections.has(n.id);
      const connectableClass = isConnectable ? (isSelectedConn ? ' connectable selected-conn' : ' connectable') : '';

      nodes += `<g class="node${active ? ' active-node' : ''}${dimCls}${connectableClass}" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}" style="opacity:${nodeOpacity}">
        ${ring}
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
        <circle cx="${x}" cy="${y}" r="7" fill="${dot}"/>
        ${badge}
        <text x="${x}" y="${y + r + 16}" text-anchor="middle">${esc(short(n.title,38))}</text>
      </g>`;
    });

    // Ghost node marker (wizard place phase)
    let ghostHtml = '';
    if (wizardState.phase === 'place' && wizardState.ghostPos) {
      const [gx, gy] = wizardState.ghostPos;
      ghostHtml = `<g class="wizard-ghost" transform="translate(${gx},${gy})">
        <circle r="26" fill="none" stroke="var(--primary)" stroke-width="2" stroke-dasharray="6 4" opacity="0.7"/>
        <text y="5" text-anchor="middle" font-size="20" fill="var(--primary)" opacity="0.8">+</text>
      </g>`;
    }

    svg.innerHTML = defs + `<g id="graphRoot" transform="translate(${vx},${vy}) scale(${vscale})">${edges}${nodes}${ghostHtml}</g>`;

    // Node click
    $$('.node').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();

      // Wizard connecting phase: toggle connection target
      if (wizardState.phase === 'connecting' && el.dataset.id !== wizardState.newNodeId) {
        const nid = el.dataset.id;
        if (wizardState.selectedConnections.has(nid)) {
          wizardState.selectedConnections.delete(nid);
        } else {
          wizardState.selectedConnections.add(nid);
        }
        const count = wizardState.selectedConnections.size;
        _setWizardInfo(`Step 2 of 2 — click existing nodes to connect (${count} selected). Click "Done" when finished.`);
        renderGraph();
        return;
      }

      state.selectedEdge = null;
      state.currentId = el.dataset.id;
      renderGraph();
      renderDetail();
    }));

    // Edge click (hit-area + visible path both carry data attributes)
    $$('.edge-hit, .edge').forEach(el => {
      if (!el.dataset.linkId) return;
      el.addEventListener('click', e => {
        e.stopPropagation();
        const linkId = Number(el.dataset.linkId);
        const fromId = el.dataset.from;
        const toId   = el.dataset.to;
        if (!linkId) return;
        const linkObj = state.links.find(l => l.id === linkId);
        state.selectedEdge = { fromId, toId, linkId, kind: linkObj?.kind };
        state.currentId = fromId;
        renderGraph();
        renderEdgeDetail();
      });
    });

    initPanZoom();
  }

  // ── Edge detail panel ────────────────────────────────────────────
  function renderEdgeDetail() {
    const e = state.selectedEdge;
    if (!e) return;
    const fromNode = byId(e.fromId);
    const toNode   = byId(e.toId);
    const linkId   = Number(e.linkId);
    const summary  = state.linkVoteSummary.find(s => Number(s.id) === linkId);
    const myVote   = linkVoteByUser(linkId);
    const total    = summary ? Number(summary.total_votes)    : 0;
    const avg      = summary ? Number(summary.avg_confidence) : null;
    const up       = summary ? Number(summary.up_votes)       : 0;
    const down     = summary ? Number(summary.down_votes)     : 0;

    const kindLabel  = e.kind === 'support' ? 'supports' : e.kind === 'conflict' ? 'conflicts with' : 'depends on';
    const kindCls    = e.kind === 'support' ? 'support' : e.kind === 'conflict' ? 'conflict' : '';
    const voteLabel  = total === 0 ? 'No votes yet'
                     : total < 3  ? `${total} vote${total > 1 ? 's' : ''} (new)`
                     : avg >= 4   ? `${total} votes \u2714 strong`
                     : avg <= 2   ? `${total} votes \u2716 weak`
                     : `${total} votes \u007e moderate`;

    $('#edgePanelTitle').textContent  = 'Selected connection';
    $('#edgeFrom').textContent        = short(fromNode?.title || e.fromId, 40);
    $('#edgeTo').textContent          = short(toNode?.title   || e.toId,   40);
    $('#edgeKindBadge').textContent   = kindLabel;
    $('#edgeKindBadge').className     = `badge ${kindCls}`;
    $('#edgeVoteLabel').textContent   = voteLabel;
    if (avg !== null && total > 0) {
      $('#edgeAvgWrap').classList.remove('hidden');
      $('#edgeAvgValue').textContent = avg.toFixed(2);
      const pct = Math.round(((avg - 1) / 4) * 100);
      $('#edgeAvgBar').style.width   = pct + '%';
      $('#edgeAvgBar').className     = `edge-bar-fill ${avg >= 4 ? 'high' : avg <= 2 ? 'low' : 'mid'}`;
    } else {
      $('#edgeAvgWrap').classList.add('hidden');
    }

    const sliderVal = myVote ? myVote.value : 3;
    $('#edgeVoteRange').value             = sliderVal;
    $('#edgeConfidenceValue').textContent = sliderVal;
    if (myVote) {
      $('#edgeVoteBtn').textContent = 'Update vote';
      $('#edgeVoteNotice').textContent = `Your current vote: ${myVote.value}/5`;
      $('#edgeVoteNotice').classList.remove('hidden');
    } else {
      $('#edgeVoteBtn').textContent = 'Vote on connection';
      $('#edgeVoteNotice').classList.add('hidden');
    }

    $('#nodeDetailContent').classList.add('hidden');
    $('#edgeDetailContent').classList.remove('hidden');
  }

  function renderDetail() {
    const n = byId(state.currentId) || state.nodes[0];
    if (!n) return;
    state.currentId = n.id;

    $('#nodeDetailContent').classList.remove('hidden');
    $('#edgeDetailContent').classList.add('hidden');

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
      ({ error } = await sb.from('challenge_votes')
        .update({ is_valid: isValid })
        .eq('id', existing.id));
    } else {
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
      ? neighbours.map(({ node: ln, kind, linkId }) => {
          const lc        = ln.status === 'challenged' ? 'conflict' : ln.type === 'question' ? 'question' : ln.status === 'new' ? 'pending' : 'support';
          const kindLabel = kind === 'support' ? 'supports' : kind === 'conflict' ? 'conflicts' : 'depends';
          const lvs       = linkId ? state.linkVoteSummary.find(s => s.id === linkId) : null;
          const lvTotal   = lvs ? Number(lvs.total_votes) : 0;
          const lvAvg     = lvs ? Number(lvs.avg_confidence) : null;
          const lvBadge   = lvTotal === 0
            ? `<span class="badge edge-vote-badge" data-link-id="${linkId}" style="cursor:pointer" title="No votes on this connection yet. Click to vote.">&#9899; vote edge</span>`
            : `<span class="badge edge-vote-badge ${lvAvg >= 4 ? 'support' : lvAvg <= 2 ? 'conflict' : ''}" data-link-id="${linkId}" style="cursor:pointer" title="Connection confidence: ${lvAvg?.toFixed(2)}. Click to vote.">edge ${lvAvg?.toFixed(1)} (${lvTotal}v)</span>`;
          return `<div class="item clickable" data-navigate="${ln.id}">
            <div class="badges" style="margin-bottom:.25rem">
              <span class="badge ${lc}">${esc(ln.type)}</span>
              <span class="badge">${esc(ln.status)}</span>
              <span class="badge">${esc(kindLabel)}</span>
              ${linkId ? lvBadge : ''}
            </div>
            <h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p>
            <small>Click to select \u2192 ${ln.id}</small>
          </div>`;
        }).join('')
      : `<div class="item"><p>${f ? 'No ' + f + ' linked to this node.' : 'No linked nodes.'}</p></div>`;

    $$('[data-navigate]').forEach(el => el.addEventListener('click', () => {
      state.selectedEdge = null;
      state.currentId = el.dataset.navigate;
      renderGraph();
      renderDetail();
    }));

    $$('.edge-vote-badge[data-link-id]').forEach(badge => {
      badge.addEventListener('click', e => {
        e.stopPropagation();
        const linkId  = Number(badge.dataset.linkId);
        const linkObj = state.links.find(l => l.id === linkId);
        if (!linkObj) return;
        state.selectedEdge = { fromId: linkObj.from_id, toId: linkObj.to_id, linkId, kind: linkObj.kind };
        renderGraph();
        renderEdgeDetail();
      });
    });
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

  // ── Edge vote handler ────────────────────────────────────────────
  async function handleEdgeVote() {
    const e = state.selectedEdge;
    if (!e?.linkId) return;
    const value  = parseInt($('#edgeVoteRange').value, 10);
    const notice = $('#edgeVoteNotice');
    const { error } = await sb.rpc('upsert_link_vote', { p_link_id: e.linkId, p_value: value });
    if (error) {
      notice.textContent = error.message;
      notice.classList.remove('hidden');
      return;
    }
    await loadAll();
    notice.textContent = `Edge vote saved (${value}/5).`;
    notice.classList.remove('hidden');
    renderGraph();
    renderEdgeDetail();
    renderLinkedPanel();
  }

  // ── Connect-nodes modal ──────────────────────────────────────────
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

  function bindSearchUI() {
    const input = document.querySelector('#searchInput');
    const clear = document.querySelector('#searchClear');
    if (!input) return;
    let debounceTimer = null;
    function applySearch() {
      updateSearchResultCount();
      renderGraph();
    }
    input.addEventListener('input', e => {
      state.search.query = e.target.value;
      clear.classList.toggle('hidden', !e.target.value);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applySearch, 180);
    });
    clear.addEventListener('click', () => {
      input.value = '';
      state.search.query = '';
      clear.classList.add('hidden');
      applySearch();
      input.focus();
    });
    document.querySelectorAll('[data-search-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.searchType;
        state.search.type = state.search.type === val ? null : val;
        document.querySelectorAll('[data-search-type]').forEach(b =>
          b.setAttribute('aria-pressed', b.dataset.searchType === state.search.type ? 'true' : 'false'));
        applySearch();
      });
    });
    document.querySelectorAll('[data-search-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.searchStatus;
        state.search.status = state.search.status === val ? null : val;
        document.querySelectorAll('[data-search-status]').forEach(b =>
          b.setAttribute('aria-pressed', b.dataset.searchStatus === state.search.status ? 'true' : 'false'));
        applySearch();
      });
    });
  }

  function bindUI() {
    $('#themeBtn').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
    $('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); window.location.href = '../'; });

    // ── Profile panel ────────────────────────────────────────────
    const profileBtn = $('#profileBtn');
    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        if (window.ProfilePanel) window.ProfilePanel.open(sb, currentUser, state);
      });
    }
    const profileOverlay = $('#profilePanelOverlay');
    if (profileOverlay) {
      profileOverlay.addEventListener('click', () => {
        if (window.ProfilePanel) window.ProfilePanel.close();
      });
    }
    // Keyboard: Escape closes profile panel
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (window.ProfilePanel) window.ProfilePanel.close();
      }
    });

    $('#voteRange').addEventListener('input', e => {
      $('#confidenceValue').textContent = Number(e.target.value).toFixed(1);
    });
    $('#voteBtn').addEventListener('click', handleVote);

    // Edge vote controls
    $('#edgeVoteRange').addEventListener('input', e => {
      $('#edgeConfidenceValue').textContent = Number(e.target.value).toFixed(0);
    });
    $('#edgeVoteBtn').addEventListener('click', handleEdgeVote);
    $('#edgeBackBtn').addEventListener('click', () => {
      state.selectedEdge = null;
      renderGraph();
      renderDetail();
    });

    $('#factChallengeBtn').addEventListener('click', () => openChallenge(state.currentId, null));
    $('#closeModal').addEventListener('click',       () => $('#challengeModal').classList.remove('show'));
    $('#challengeModal').addEventListener('click', e => { if (e.target === $('#challengeModal')) $('#challengeModal').classList.remove('show'); });
    $('#challengeForm').addEventListener('submit', handleChallengeSubmit);

    $('#addFactBtn').addEventListener('click', () => {
      // Use wizard instead of the plain modal
      startWizard();
    });
    $('#closeFactModal').addEventListener('click',   () => $('#factModal').classList.remove('show'));
    $('#factModal').addEventListener('click', e => { if (e.target === $('#factModal')) $('#factModal').classList.remove('show'); });
    // NOTE: factForm submit is NOT bound here — the wizard attaches/detaches it dynamically.
    // The fallback handleFactSubmit is only wired when the wizard is NOT active (see startWizard).

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

    // ── Wizard UI bindings ───────────────────────────────────────
    const wizardCancelBtn = $('#wizardCancelBtn');
    if (wizardCancelBtn) wizardCancelBtn.addEventListener('click', cancelWizard);

    const wizardDoneBtn = $('#wizardDoneBtn');
    if (wizardDoneBtn) wizardDoneBtn.addEventListener('click', finishWizardConnections);

    bindSearchUI();
  }

  function syncFilterButtons() {
    const f = state.linkedFilter;
    $('#filterFacts').setAttribute('aria-pressed',     f === 'facts'     ? 'true' : 'false');
    $('#filterQuestions').setAttribute('aria-pressed', f === 'questions' ? 'true' : 'false');
    $('#filterHint').textContent = f ? `Showing only ${f} directly linked to selected node` : '';
  }

  function initPanZoom() {
    const canvas = $('#graphCanvas');
    const svg    = $('#graphSvg');
    let dragging = false, startX = 0, startY = 0, startVx = 0, startVy = 0;

    canvas.onpointerdown = e => {
      if (e.target.closest('.node') || e.target.closest('.edge') || e.target.closest('.edge-hit')) return;

      // Wizard place phase: clicking the canvas sets ghost / places node
      if (wizardState.phase === 'place') {
        const rect = svg.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (VW / rect.width) - vx;
        const cy = (e.clientY - rect.top)  * (VH / rect.height) - vy;
        const svgX = cx / vscale;
        const svgY = cy / vscale;
        wizardPlaceNode(svgX, svgY);
        return;
      }

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

  // ── Wizard state machine ─────────────────────────────────────────
  // Phases: idle → fill → place → connecting → done
  const wizardState = {
    phase: 'idle',          // 'idle' | 'fill' | 'place' | 'connecting'
    newNodeId: null,        // generated ID for the new node
    ghostPos: null,         // [svgX, svgY] while hovering in place phase
    selectedConnections: new Set()  // node IDs to connect to
  };

  function _setWizardInfo(msg) {
    const info = $('#wizardInfo');
    const text = $('#wizardInfoText');
    if (!info || !text) return;
    text.textContent = msg;
    info.classList.add('visible');
  }

  function _hideWizardInfo() {
    const info = $('#wizardInfo');
    if (info) info.classList.remove('visible');
  }

  function _showDoneBtn(show) {
    const btn = $('#wizardDoneBtn');
    if (btn) btn.classList.toggle('visible', !!show);
  }

  // ── Wizard form listener management ─────────────────────────────
  // Keep a single named reference so we can reliably add/remove it.
  // Using addEventListener + removeEventListener with the same function
  // reference is the only safe way to avoid duplicate listeners.
  function _wizardSubmitHandler(e) {
    e.preventDefault();
    const title   = $('#newFactTitle').value.trim();
    const summary = $('#newFactSummary').value.trim();
    const type    = $('#newFactType').value;
    if (!title) {
      $('#factNotice').textContent = 'Title is required.';
      $('#factNotice').classList.remove('hidden');
      return;
    }
    wizardState.pendingNode = { title, summary, type };
    wizardState.newNodeId   = 'f' + Date.now();
    $('#factModal').classList.remove('show');
    _enterPlacePhase();
  }

  function _attachWizardSubmit() {
    const form = $('#factForm');
    // Always detach first to ensure no duplicates, then re-attach once.
    form.removeEventListener('submit', _wizardSubmitHandler);
    form.removeEventListener('submit', handleFactSubmit);
    form.addEventListener('submit', _wizardSubmitHandler);
  }

  function _detachWizardSubmit() {
    const form = $('#factForm');
    form.removeEventListener('submit', _wizardSubmitHandler);
    // Restore normal submit handler for direct (non-wizard) use.
    form.removeEventListener('submit', handleFactSubmit);
    form.addEventListener('submit', handleFactSubmit);
  }

  function startWizard() {
    wizardState.phase = 'fill';
    wizardState.newNodeId = null;
    wizardState.ghostPos  = null;
    wizardState.selectedConnections = new Set();

    $('#newFactTitle').value   = '';
    $('#newFactSummary').value = '';
    $('#newFactLinks').value   = '';
    $('#factNotice').classList.add('hidden');

    _attachWizardSubmit();

    $('#factModal').classList.add('show');
    setTimeout(() => $('#newFactTitle').focus(), 80);
  }

  function _enterPlacePhase() {
    wizardState.phase = 'place';
    _setWizardInfo('Step 1 of 2 — click anywhere on the canvas to place the new node.');
    _showDoneBtn(false);
  }

  async function wizardPlaceNode(svgX, svgY) {
    const x = Math.max(30, Math.min(VW - 30, svgX));
    const y = Math.max(30, Math.min(VH - 30, svgY));

    state.positions[wizardState.newNodeId] = [x, y];

    const { title, summary, type } = wizardState.pendingNode;
    const { error } = await sb.from('nodes').insert({
      id:          wizardState.newNodeId,
      title,
      summary,
      type,
      status:      'new',
      confidence:  3.0,
      votes_count: 0,
      created_by:  currentUser.id
    });

    if (error) {
      _setWizardInfo('Error saving node: ' + error.message);
      return;
    }

    await loadAll();

    wizardState.phase = 'connecting';
    state.currentId   = wizardState.newNodeId;
    _setWizardInfo('Step 2 of 2 — click existing nodes to connect (0 selected). Click "Done" when finished.');
    _showDoneBtn(true);
    renderGraph();
    renderDetail();
  }

  function cancelWizard() {
    if (wizardState.newNodeId && wizardState.phase === 'connecting') {
      state.nodes = state.nodes.filter(n => n.id !== wizardState.newNodeId);
      delete state.positions[wizardState.newNodeId];
      sb.from('nodes').delete().eq('id', wizardState.newNodeId).then(() => {});
    }

    _detachWizardSubmit();

    wizardState.phase = 'idle';
    wizardState.newNodeId = null;
    wizardState.ghostPos  = null;
    wizardState.selectedConnections = new Set();

    _hideWizardInfo();
    _showDoneBtn(false);
    $('#factModal').classList.remove('show');
    renderGraph();
    renderStats();
  }

  async function finishWizardConnections() {
    const fromId      = wizardState.newNodeId;
    const targetIds   = [...wizardState.selectedConnections];

    if (targetIds.length > 0) {
      const { error } = await sb.from('links').insert(
        targetIds.map(toId => ({ from_id: fromId, to_id: toId, kind: 'support', created_by: currentUser.id }))
      );
      if (error) {
        _setWizardInfo('Error creating connections: ' + error.message);
        return;
      }
      await loadAll();
    }

    _detachWizardSubmit();

    wizardState.phase = 'idle';
    wizardState.newNodeId = null;
    wizardState.ghostPos  = null;
    wizardState.selectedConnections = new Set();

    _hideWizardInfo();
    _showDoneBtn(false);
    renderGraph();
    renderDetail();
    renderStats();
  }

  init().catch(err => {
    console.error(err);
    document.body?.insertAdjacentHTML('afterbegin',
      `<div style="padding:1rem;color:#fff;background:#7d1e5e">Supabase init failed: ${esc(err.message || err)}</div>`);
  });
})();
