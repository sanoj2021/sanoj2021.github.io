(function(){
  'use strict';

  const user = sessionStorage.getItem('scienceDbUser');
  if(!user){ window.location.href='../'; return; }

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = (s,n) => s.length>n ? s.slice(0,n-1)+'\u2026' : s;

  /* ── State ───────────────────────────────────────────────────── */
  const STORAGE_KEY = 'sciencedb:v2';
  const DEFAULT_STATE = () => ({
    nodes: structuredClone(window.SDB.nodes),
    sources: structuredClone(window.SDB.sources),
    votes: [],
    challenges: [],
    submissions: [],
    currentId: 'f1',
    view: 'graph'
  });
  function loadState(){
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : DEFAULT_STATE(); }
    catch(e){ return DEFAULT_STATE(); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  let state = loadState();

  /* ── Theme ───────────────────────────────────────────────────── */
  const root = document.documentElement;
  let theme = root.getAttribute('data-theme') || 'dark';
  root.setAttribute('data-theme', theme);
  $('#themeBtn').addEventListener('click', ()=>{ theme = theme==='dark'?'light':'dark'; root.setAttribute('data-theme',theme); });

  /* ── Helpers ─────────────────────────────────────────────────── */
  function byId(id){ return state.nodes.find(n=>n.id===id); }
  function visibleNodes(){
    if(state.view==='facts') return state.nodes.filter(n=>n.type==='fact');
    if(state.view==='questions') return state.nodes.filter(n=>n.type==='question');
    return state.nodes;
  }
  function queueItems(){ return [...state.submissions, ...state.challenges.filter(c=>c.status==='pending')]; }
  function userVoteFor(factId){ return state.votes.find(v=>v.targetId===factId && v.user===user); }

  function renderStats(){
    $('#statFacts').textContent = state.nodes.filter(n=>n.type==='fact').length;
    $('#statQuestions').textContent = state.nodes.filter(n=>n.type==='question').length;
    $('#statQueue').textContent = queueItems().length;
  }

  /* ── Node positions ──────────────────────────────────────────── */
  const POS = {f1:[280,175],f2:[490,95],f3:[510,275],f4:[740,120],f5:[755,305],f6:[235,340]};
  // Deterministic layout for dynamically added nodes using a golden-angle spiral
  function posOf(id){
    if(POS[id]) return [...POS[id]];
    const idx = state.nodes.findIndex(n=>n.id===id);
    const angle = idx * 2.399963; // golden angle in radians
    const r = 80 + idx * 22;
    return [450 + r*Math.cos(angle), 240 + r*Math.sin(angle)];
  }

  /* ── Pan / Zoom state ────────────────────────────────────────── */
  let vx=0, vy=0, vscale=1;
  const VW=900, VH=480;

  function applyTransform(){
    const g = $('#graphRoot');
    if(g) g.setAttribute('transform', `translate(${vx},${vy}) scale(${vscale})`);
  }

  function clampTransform(){
    // loose clamp: always keep at least 200px of canvas in view
    const margin = 200;
    const w = VW*vscale, h = VH*vscale;
    vx = Math.min(margin, Math.max(VW - w - margin, vx));
    vy = Math.min(margin, Math.max(VH - h - margin, vy));
  }

  /* ── Graph rendering ─────────────────────────────────────────── */
  function renderGraph(){
    const svg = $('#graphSvg');
    svg.setAttribute('viewBox',`0 0 ${VW} ${VH}`);

    const defs = `<defs>
      <marker id="aS" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--primary)"/></marker>
      <marker id="aD" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--muted)"/></marker>
      <marker id="aC" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--error)"/></marker>
    </defs>`;

    let edges = '';
    state.nodes.forEach(n=>{ (n.links||[]).forEach(l=>{
      const [x1,y1]=posOf(n.id), [x2,y2]=posOf(l.to);
      const mx=(x1+x2)/2;
      const cls=l.kind==='support'?'support':l.kind==='conflict'?'conflict':'depend';
      const mk=l.kind==='support'?'url(#aS)':l.kind==='conflict'?'url(#aC)':'url(#aD)';
      edges+=`<path class="edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="${mk}"/>`;
    }); });

    const visible = visibleNodes();
    let nodes = '';
    visible.forEach(n=>{
      const [x,y]=posOf(n.id);
      const active = n.id===state.currentId;
      const r = active ? 34 : 26;
      const fillOuter = n.status==='challenged' ? 'color-mix(in oklab,var(--error) 18%,var(--surface2))'
        : n.type==='question' ? 'color-mix(in oklab,var(--warn) 15%,var(--surface2))'
        : n.status==='pending' ? 'color-mix(in oklab,var(--warn) 15%,var(--surface2))'
        : 'color-mix(in oklab,var(--primary) 15%,var(--surface2))';
      const fillDot = n.status==='challenged' ? 'var(--error)'
        : n.type==='question' ? 'var(--warn)'
        : n.status==='pending' ? 'var(--warn)'
        : 'var(--primary)';
      nodes += `<g class="node${active?' active-node':''}" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}">`
        + `<circle cx="${x}" cy="${y}" r="${r}" fill="${fillOuter}"/>`
        + `<circle cx="${x}" cy="${y}" r="7" fill="${fillDot}"/>`
        + `<text x="${x}" y="${y+r+16}" text-anchor="middle">${esc(short(n.title,38))}</text>`
        + `</g>`;
    });

    svg.innerHTML = defs + `<g id="graphRoot" transform="translate(${vx},${vy}) scale(${vscale})">${edges}${nodes}</g>`;
    $$('.node').forEach(el=>el.addEventListener('click', e=>{
      e.stopPropagation();
      state.currentId = el.dataset.id;
      saveState();
      renderGraph();
      renderDetail();
    }));
    initPanZoom();
  }

  /* ── Pan / Zoom interaction ──────────────────────────────────── */
  function initPanZoom(){
    const canvas = $('#graphCanvas');
    const svg = $('#graphSvg');
    let dragging=false, startX=0, startY=0, startVx=0, startVy=0;
    let lastDist = null;

    // Pointer drag (mouse + single-touch)
    canvas.onpointerdown = e=>{
      if(e.target.closest('.node')) return; // let node clicks pass
      canvas.setPointerCapture(e.pointerId);
      dragging=true; startX=e.clientX; startY=e.clientY; startVx=vx; startVy=vy;
    };
    canvas.onpointermove = e=>{
      if(!dragging) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = VW / rect.width;
      const scaleY = VH / rect.height;
      vx = startVx + (e.clientX - startX)*scaleX;
      vy = startVy + (e.clientY - startY)*scaleY;
      clampTransform();
      applyTransform();
    };
    canvas.onpointerup = canvas.onpointercancel = ()=>{ dragging=false; lastDist=null; };

    // Mouse wheel zoom
    canvas.onwheel = e=>{
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scaleX = VW / rect.width;
      const scaleY = VH / rect.height;
      const mx = (e.clientX - rect.left)*scaleX; // cursor in SVG coords before transform
      const my = (e.clientY - rect.top)*scaleY;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const ns = Math.min(4, Math.max(0.25, vscale*factor));
      // zoom toward cursor
      vx = mx - (mx - vx)*(ns/vscale);
      vy = my - (my - vy)*(ns/vscale);
      vscale = ns;
      clampTransform();
      applyTransform();
    };

    // Pinch-to-zoom (touch)
    canvas.ontouchstart = e=>{ if(e.touches.length===2){ lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); } };
    canvas.ontouchmove = e=>{
      if(e.touches.length===2){
        e.preventDefault();
        const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        if(lastDist){
          const factor = d/lastDist;
          vscale = Math.min(4, Math.max(0.25, vscale*factor));
          clampTransform(); applyTransform();
        }
        lastDist=d;
      }
    };
    canvas.ontouchend = ()=>{ lastDist=null; };
  }

  function zoomBy(factor, cx=VW/2, cy=VH/2){
    const ns = Math.min(4, Math.max(0.25, vscale*factor));
    vx = cx - (cx - vx)*(ns/vscale);
    vy = cy - (cy - vy)*(ns/vscale);
    vscale = ns;
    clampTransform();
    applyTransform();
  }

  $('#zoomIn').addEventListener('click', ()=>zoomBy(1.2));
  $('#zoomOut').addEventListener('click', ()=>zoomBy(0.83));
  $('#zoomReset').addEventListener('click', ()=>{ vx=0; vy=0; vscale=1; applyTransform(); });

  /* ── Detail panel ────────────────────────────────────────────── */
  function renderDetail(){
    const n = byId(state.currentId) || state.nodes[0];
    state.currentId = n.id;

    $('#factTitle').textContent = n.title;
    $('#factSummary').textContent = n.summary;

    const existingVote = userVoteFor(n.id);
    const sliderVal = existingVote ? existingVote.value : Math.round(n.confidence);
    $('#confidenceValue').textContent = sliderVal;
    $('#voteRange').value = sliderVal;

    if(existingVote){
      $('#voteBtn').disabled = true;
      $('#voteBtn').textContent = `Voted (${existingVote.value}/5)`;
      $('#voteNotice').textContent = `You already voted ${existingVote.value}/5 on this fact.`;
      $('#voteNotice').classList.remove('hidden');
    } else {
      $('#voteBtn').disabled = false;
      $('#voteBtn').textContent = 'Vote';
      $('#voteNotice').classList.add('hidden');
    }

    const cls = n.status==='challenged'?'conflict':n.type==='question'?'question':n.status==='pending'?'pending':'support';
    $('#factMeta').innerHTML =
      `<span class="badge ${cls}">${esc(n.status)}</span>`
      +`<span class="badge">${esc(n.type)}</span>`
      +`<span class="badge">${n.votes} votes</span>`
      +`<span class="badge">confidence: ${n.confidence.toFixed(1)}</span>`;

    // Linked facts — clickable
    const linked = (n.links||[]).map(l=>byId(l.to)).filter(Boolean);
    $('#linkedFacts').innerHTML = linked.length
      ? linked.map(ln=>{
          const lc = ln.status==='challenged'?'conflict':ln.type==='question'?'question':ln.status==='pending'?'pending':'support';
          return `<div class="item clickable" data-navigate="${ln.id}">`
            +`<div class="badges" style="margin-bottom:.25rem"><span class="badge ${lc}">${esc(ln.status)}</span></div>`
            +`<h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p>`
            +`<small>Click to select &rarr; ${ln.id}</small>`
            +`</div>`;
        }).join('')
      : '<div class="item"><p>No linked facts.</p></div>';

    $$('[data-navigate]').forEach(el=>el.addEventListener('click',()=>{
      state.currentId = el.dataset.navigate;
      saveState();
      renderGraph();
      renderDetail();
      // scroll detail panel into view
      $('#detailPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
    }));

    // Sources
    renderSources(n);
  }

  function renderSources(n){
    const srcs = (n.sources||[]).map(id=>state.sources[id]).filter(Boolean);
    $('#sources').innerHTML = srcs.length
      ? srcs.map(s=>`<div class="item">`
          +`<h4>${esc(s.title)}</h4>`
          +`<p>${esc(s.note)}</p>`
          +`<small>${esc(s.kind)} &middot; quality: ${esc(s.quality)}</small>`
          +`<div class="source-actions">`
          +`<button class="btn" data-sid="${s.id}" data-action="irrelevant">Challenge: irrelevant</button>`
          +`<button class="btn error" data-sid="${s.id}" data-action="false">Challenge: false</button>`
          +`</div></div>`).join('')
      : '<div class="item"><p>No sources attached yet.</p></div>';
    $$('[data-sid]').forEach(btn=>btn.addEventListener('click',()=>openChallenge(btn.dataset.sid, btn.dataset.action)));
    $('#sourceNotice').classList.add('hidden');
    // reset add-source form
    $('#srcTitle').value='';
    $('#srcNote').value='';
    $('#addSourceDetails').removeAttribute('open');
  }

  /* ── Other view renderers ────────────────────────────────────── */
  function renderQueue(){
    const items = queueItems();
    $('#lowerLeftTitle').textContent = 'Moderation queue';
    $('#linkedFacts').innerHTML = items.length
      ? items.map(item=>{
          const ts = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
          return `<div class="item">`
            +`<h4>${esc(item.title || item.reason || item.id)}</h4>`
            +`<p>${esc(item.summary || item.reason || '')}</p>`
            +`<small>${esc(item.targetType||'submission')} &middot; ${esc(item.status||'pending')} &middot; ${ts}</small>`
            +`</div>`;
        }).join('')
      : '<div class="item"><p>Queue is empty.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Facts gain stable status automatically as community confidence votes accumulate.</p></div>';
  }

  function renderFactsList(){
    const facts = state.nodes.filter(n=>n.type==='fact'||n.type==='claim');
    $('#lowerLeftTitle').textContent = 'All facts & claims';
    $('#linkedFacts').innerHTML = facts.map(n=>{
      const cls = n.status==='challenged'?'conflict':n.status==='pending'?'pending':'support';
      return `<div class="item clickable" data-navigate="${n.id}">`
        +`<div class="badges" style="margin-bottom:.3rem"><span class="badge ${cls}">${esc(n.status)}</span><span class="badge">${n.votes} votes</span><span class="badge">conf: ${n.confidence.toFixed(1)}</span></div>`
        +`<h4>${esc(n.title)}</h4><p>${esc(n.summary)}</p>`
        +`</div>`;
    }).join('');
    $$('[data-navigate]').forEach(el=>el.addEventListener('click',()=>{
      state.currentId = el.dataset.navigate;
      saveState();
      setView('graph');
    }));
    $('#sources').innerHTML = '<div class="item"><p>Click a fact to inspect it in the graph view.</p></div>';
  }

  function renderQuestionsList(){
    const questions = state.nodes.filter(n=>n.type==='question');
    $('#lowerLeftTitle').textContent = 'Open questions';
    $('#linkedFacts').innerHTML = questions.length
      ? questions.map(n=>`<div class="item">`
          +`<div class="badges" style="margin-bottom:.3rem"><span class="badge question">question</span><span class="badge">${n.votes} votes</span></div>`
          +`<h4>${esc(n.title)}</h4><p>${esc(n.summary)}</p>`
          +`</div>`).join('')
      : '<div class="item"><p>No open questions yet.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Questions can be submitted via &ldquo;+ Add fact&rdquo; selecting type &ldquo;Question&rdquo;.</p></div>';
  }

  /* ── View switcher ───────────────────────────────────────────── */
  function setView(view){
    state.view = view;
    saveState();
    $$('[data-view]').forEach(a=>a.classList.toggle('active', a.dataset.view===view));
    const titles = {graph:'Knowledge graph',facts:'Facts',questions:'Questions',queue:'Moderation queue'};
    const subs   = {graph:'Atomic facts, linked evidence, crowd review',facts:'All submitted fact and claim nodes',questions:'Open questions awaiting evidence',queue:'Pending submissions and challenges for review'};
    $('#viewTitle').textContent = titles[view] || view;
    $('#viewSub').textContent   = subs[view] || '';
    const isQueue = view==='queue';
    $('#graphPanel').classList.toggle('hidden', isQueue);
    $('#detailPanel').classList.toggle('hidden', isQueue);
    $('#sourcesPanel').classList.toggle('hidden', isQueue);
    if(isQueue){ renderQueue(); }
    else if(view==='facts'){ renderGraph(); renderFactsList(); }
    else if(view==='questions'){ renderGraph(); renderQuestionsList(); }
    else { renderGraph(); renderDetail(); }
    renderStats();
  }

  /* ── Challenge modal ─────────────────────────────────────────── */
  function openChallenge(targetId, mode){
    const src = state.sources[targetId];
    const isSource = !!src;
    $('#challengeTypeWrap').classList.toggle('hidden', !isSource);
    if(isSource){
      $('#modalTitle').textContent = mode==='irrelevant' ? 'Challenge: source not relevant' : 'Challenge: source unreliable';
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

  /* ── Event listeners ─────────────────────────────────────────── */
  $('#usernameLabel').textContent = user;
  $('#logoutBtn').addEventListener('click',()=>{ sessionStorage.removeItem('scienceDbUser'); window.location.href='../'; });

  $('#voteRange').addEventListener('input', e=>{ $('#confidenceValue').textContent = Number(e.target.value).toFixed(1); });

  $('#voteBtn').addEventListener('click',()=>{
    const n = byId(state.currentId); if(!n) return;
    if(userVoteFor(n.id)){
      $('#voteNotice').textContent = 'You have already voted on this fact. Each user can vote once per fact.';
      $('#voteNotice').classList.remove('hidden');
      return;
    }
    const v = parseInt($('#voteRange').value, 10);
    n.confidence = ((n.confidence * n.votes) + v) / (n.votes + 1);
    n.votes++;
    state.votes.push({targetId:n.id, user, value:v, timestamp:Date.now()});
    saveState();
    renderStats();
    renderDetail();
    renderGraph();
  });

  $('#factChallengeBtn').addEventListener('click',()=>openChallenge(state.currentId, null));
  $('#closeModal').addEventListener('click',()=>$('#challengeModal').classList.remove('show'));
  $('#challengeModal').addEventListener('click',e=>{ if(e.target===$('#challengeModal')) $('#challengeModal').classList.remove('show'); });

  $('#challengeForm').addEventListener('submit', e=>{
    e.preventDefault();
    const target = $('#targetInfo').value;
    const isSource = !!state.sources[target];
    state.challenges.push({
      id:'c'+Date.now(), targetId:target,
      targetType: isSource?'source':'fact',
      challengeType: isSource ? $('#challengeType').value : 'fact',
      reason: $('#challengeReason').value.trim(),
      user, status:'pending', timestamp:Date.now()
    });
    if(!isSource){ const n=byId(target); if(n) n.status='challenged'; }
    saveState();
    $('#challengeNotice').textContent = `Challenge submitted. It is now in the queue.`;
    $('#challengeNotice').classList.remove('hidden');
    renderStats(); renderGraph(); renderDetail();
  });

  $('#addFactBtn').addEventListener('click',()=>{
    $('#newFactTitle').value=''; $('#newFactSummary').value=''; $('#newFactLinks').value='';
    $('#factNotice').classList.add('hidden');
    $('#factModal').classList.add('show');
  });
  $('#closeFactModal').addEventListener('click',()=>$('#factModal').classList.remove('show'));
  $('#factModal').addEventListener('click',e=>{ if(e.target===$('#factModal')) $('#factModal').classList.remove('show'); });

  $('#factForm').addEventListener('submit', e=>{
    e.preventDefault();
    const id = 'f'+Date.now();
    const title   = $('#newFactTitle').value.trim();
    const summary = $('#newFactSummary').value.trim();
    const type    = $('#newFactType').value;
    const links   = $('#newFactLinks').value.split(',').map(s=>s.trim()).filter(Boolean).map(to=>({to,kind:'support'}));
    const newNode = {id, title, summary, type, status:'pending', confidence:3.0, votes:0, sources:[], links};
    state.nodes.unshift(newNode);
    state.submissions.push({id, title, summary, type, links:links.map(l=>l.to), status:'pending', user, timestamp:Date.now()});
    saveState();
    $('#factNotice').textContent = `"${title}" submitted and queued for moderation.`;
    $('#factNotice').classList.remove('hidden');
    renderStats(); renderGraph();
  });

  // Add source
  $('#cancelSource').addEventListener('click',()=>$('#addSourceDetails').removeAttribute('open'));
  $('#sourceForm').addEventListener('submit', e=>{
    e.preventDefault();
    const n = byId(state.currentId); if(!n) return;
    const sid = 's'+Date.now();
    state.sources[sid] = {
      id: sid,
      title: $('#srcTitle').value.trim(),
      kind: $('#srcKind').value,
      quality: $('#srcQuality').value,
      note: $('#srcNote').value.trim() || ''
    };
    if(!n.sources) n.sources=[];
    n.sources.push(sid);
    saveState();
    $('#sourceNotice').textContent = `Source attached to "${short(n.title,50)}".`;
    $('#sourceNotice').classList.remove('hidden');
    renderSources(n);
  });

  $('#navLinks').addEventListener('click', e=>{
    const a = e.target.closest('[data-view]');
    if(a){ e.preventDefault(); setView(a.dataset.view); }
  });

  setView(state.view || 'graph');

})();
