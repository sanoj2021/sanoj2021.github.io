(function(){
  'use strict';

  const user = sessionStorage.getItem('scienceDbUser');
  if(!user){ window.location.href='../'; return; }

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = (s,n) => s.length>n ? s.slice(0,n-1)+'\u2026' : s;

  /* ── State ───────────────────────────────────────────────────── */
  const STORAGE_KEY = 'sciencedb:v3';
  const BASE_POS = {f1:[280,175],f2:[490,95],f3:[510,275],f4:[740,120],f5:[755,305],f6:[235,340]};
  const DEFAULT_STATE = () => ({
    nodes: structuredClone(window.SDB.nodes),
    sources: structuredClone(window.SDB.sources),
    votes: [],
    challenges: [],
    submissions: [],
    positions: structuredClone(BASE_POS),
    currentId: 'f1',
    view: 'graph',
    linkedFilter: null   // null | 'facts' | 'questions'
  });
  function loadState(){
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : DEFAULT_STATE(); }
    catch(e){ return DEFAULT_STATE(); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  let state = loadState();
  if(!state.positions) state.positions = structuredClone(BASE_POS);
  if(!('linkedFilter' in state)) state.linkedFilter = null;

  /* ── Theme ───────────────────────────────────────────────────── */
  const root = document.documentElement;
  let theme = root.getAttribute('data-theme') || 'dark';
  root.setAttribute('data-theme', theme);
  $('#themeBtn').addEventListener('click', ()=>{ theme = theme==='dark'?'light':'dark'; root.setAttribute('data-theme',theme); });

  /* ── Helpers ─────────────────────────────────────────────────── */
  function byId(id){ return state.nodes.find(n=>n.id===id); }
  function queueItems(){ return [...state.submissions, ...state.challenges.filter(c=>c.status==='pending')]; }
  function userVoteFor(factId){ return state.votes.find(v=>v.targetId===factId && v.user===user); }

  function renderStats(){
    $('#statFacts').textContent = state.nodes.filter(n=>n.type==='fact').length;
    $('#statQuestions').textContent = state.nodes.filter(n=>n.type==='question').length;
    $('#statQueue').textContent = queueItems().length;
  }

  /* ── Node positions (smart placement) ───────────────────────── */
  const VW=900, VH=480;
  const MIN_DIST = 80;

  function posOf(id){
    if(state.positions[id]) return [...state.positions[id]];
    const idx = state.nodes.findIndex(n=>n.id===id);
    const angle = idx * 2.399963;
    const r = 100 + idx * 18;
    return [VW/2 + r*Math.cos(angle), VH/2 + r*Math.sin(angle)];
  }

  function placeNewNode(newId, linkedIds){
    let cx = VW/2, cy = VH/2;
    const neighbours = linkedIds.map(id=>state.positions[id]).filter(Boolean);
    if(neighbours.length){
      cx = neighbours.reduce((s,p)=>s+p[0],0)/neighbours.length;
      cy = neighbours.reduce((s,p)=>s+p[1],0)/neighbours.length;
      cx += 40; cy += 30;
    }
    cx = Math.max(50, Math.min(VW-50, cx));
    cy = Math.max(50, Math.min(VH-50, cy));
    state.positions[newId] = [cx, cy];
    const allIds = state.nodes.map(n=>n.id);
    for(let iter=0; iter<3; iter++){
      allIds.forEach(oid=>{
        if(oid===newId) return;
        const [ox,oy] = state.positions[oid] || posOf(oid);
        const [nx,ny] = state.positions[newId];
        const dx=ox-nx, dy=oy-ny;
        const dist = Math.hypot(dx,dy) || 0.01;
        if(dist < MIN_DIST){
          const push = (MIN_DIST - dist) / 2 + 4;
          const ux=dx/dist, uy=dy/dist;
          state.positions[oid] = [Math.max(45,Math.min(VW-45,ox+ux*push)),Math.max(45,Math.min(VH-45,oy+uy*push))];
          state.positions[newId] = [Math.max(45,Math.min(VW-45,nx-ux*push)),Math.max(45,Math.min(VH-45,ny-uy*push))];
        }
      });
    }
  }

  /* ── Pan / Zoom state ────────────────────────────────────────── */
  let vx=0, vy=0, vscale=1;

  function applyTransform(){
    const g = $('#graphRoot');
    if(g) g.setAttribute('transform',`translate(${vx},${vy}) scale(${vscale})`);
  }
  function clampTransform(){
    const margin=200, w=VW*vscale, h=VH*vscale;
    vx=Math.min(margin,Math.max(VW-w-margin,vx));
    vy=Math.min(margin,Math.max(VH-h-margin,vy));
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

    /* ── Build visible set when a filter is active ────────────────── */
    const f = state.linkedFilter;
    let visibleIds = null;   // null = show everything
    if(f && state.currentId){
      const cur = byId(state.currentId);
      if(cur){
        // Direct neighbours that match the filter type
        const neighbourIds = (cur.links||[])
          .map(l=>l.to)
          .filter(id=>{
            const nb = byId(id);
            if(!nb) return false;
            if(f==='facts')    return nb.type==='fact'||nb.type==='claim';
            if(f==='questions') return nb.type==='question';
            return true;
          });
        visibleIds = new Set([state.currentId, ...neighbourIds]);
      }
    }

    /* ── Edges (only between visible nodes) ─────────────────────── */
    let edges = '';
    state.nodes.forEach(n=>{
      if(visibleIds && !visibleIds.has(n.id)) return;
      (n.links||[]).forEach(l=>{
        if(visibleIds && !visibleIds.has(l.to)) return;
        const [x1,y1]=posOf(n.id), [x2,y2]=posOf(l.to);
        const mx=(x1+x2)/2;
        const cls=l.kind==='support'?'support':l.kind==='conflict'?'conflict':'depend';
        const mk=l.kind==='support'?'url(#aS)':l.kind==='conflict'?'url(#aC)':'url(#aD)';
        edges+=`<path class="edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="${mk}"/>`;
      });
    });

    /* ── Nodes (only visible) ─────────────────────────────────── */
    let nodes = '';
    state.nodes.forEach(n=>{
      if(visibleIds && !visibleIds.has(n.id)) return;
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
    let dragging=false, startX=0, startY=0, startVx=0, startVy=0, lastDist=null;

    canvas.onpointerdown = e=>{
      if(e.target.closest('.node')) return;
      canvas.setPointerCapture(e.pointerId);
      dragging=true; startX=e.clientX; startY=e.clientY; startVx=vx; startVy=vy;
    };
    canvas.onpointermove = e=>{
      if(!dragging) return;
      const rect=svg.getBoundingClientRect();
      vx = startVx+(e.clientX-startX)*(VW/rect.width);
      vy = startVy+(e.clientY-startY)*(VH/rect.height);
      clampTransform(); applyTransform();
    };
    canvas.onpointerup = canvas.onpointercancel = ()=>{ dragging=false; lastDist=null; };

    canvas.onwheel = e=>{
      e.preventDefault();
      const rect=svg.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(VW/rect.width);
      const my=(e.clientY-rect.top)*(VH/rect.height);
      const factor = e.deltaY<0 ? 1.06 : 0.94;
      const ns=Math.min(4,Math.max(0.25,vscale*factor));
      vx=mx-(mx-vx)*(ns/vscale); vy=my-(my-vy)*(ns/vscale); vscale=ns;
      clampTransform(); applyTransform();
    };
    canvas.ontouchstart = e=>{ if(e.touches.length===2) lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); };
    canvas.ontouchmove = e=>{
      if(e.touches.length===2){
        e.preventDefault();
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        if(lastDist){ vscale=Math.min(4,Math.max(0.25,vscale*(0.5+d/lastDist*0.5))); clampTransform(); applyTransform(); }
        lastDist=d;
      }
    };
    canvas.ontouchend = ()=>{ lastDist=null; };
  }

  function zoomBy(f,cx=VW/2,cy=VH/2){
    const ns=Math.min(4,Math.max(0.25,vscale*f));
    vx=cx-(cx-vx)*(ns/vscale); vy=cy-(cy-vy)*(ns/vscale); vscale=ns;
    clampTransform(); applyTransform();
  }
  $('#zoomIn').addEventListener('click',()=>zoomBy(1.2));
  $('#zoomOut').addEventListener('click',()=>zoomBy(0.83));
  $('#zoomReset').addEventListener('click',()=>{ vx=0;vy=0;vscale=1; applyTransform(); });

  /* ── Filter toggles ──────────────────────────────────────────── */
  function syncFilterButtons(){
    const f = state.linkedFilter;
    $('#filterFacts').setAttribute('aria-pressed', f==='facts'?'true':'false');
    $('#filterQuestions').setAttribute('aria-pressed', f==='questions'?'true':'false');
    $('#filterHint').textContent = f ? `Showing only ${f} directly linked to selected node` : '';
  }

  $('#filterFacts').addEventListener('click',()=>{
    state.linkedFilter = state.linkedFilter==='facts' ? null : 'facts';
    saveState(); syncFilterButtons(); renderGraph(); renderLinkedPanel();
  });
  $('#filterQuestions').addEventListener('click',()=>{
    state.linkedFilter = state.linkedFilter==='questions' ? null : 'questions';
    saveState(); syncFilterButtons(); renderGraph(); renderLinkedPanel();
  });

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

    $('#voteBtn').disabled = false;
    if(existingVote){
      $('#voteBtn').textContent = 'Update vote';
      $('#voteNotice').textContent = `Your current vote: ${existingVote.value}/5. Move the slider to change it.`;
      $('#voteNotice').classList.remove('hidden');
    } else {
      $('#voteBtn').textContent = 'Vote';
      $('#voteNotice').classList.add('hidden');
    }

    const cls = n.status==='challenged'?'conflict':n.type==='question'?'question':n.status==='pending'?'pending':'support';
    $('#factMeta').innerHTML =
      `<span class="badge ${cls}">${esc(n.status)}</span>`
      +`<span class="badge">${esc(n.type)}</span>`
      +`<span class="badge">${n.votes} votes</span>`
      +`<span class="badge">confidence: ${n.confidence.toFixed(1)}</span>`;

    renderLinkedPanel();
    renderSources(n);
    syncFilterButtons();
  }

  function renderLinkedPanel(){
    const n = byId(state.currentId);
    if(!n){ $('#linkedFacts').innerHTML='<div class="item"><p>No node selected.</p></div>'; return; }

    const f = state.linkedFilter;
    // Direct neighbours only — no transitivity
    let linked = (n.links||[]).map(l=>byId(l.to)).filter(Boolean);
    if(f==='facts')      linked = linked.filter(ln=>ln.type==='fact'||ln.type==='claim');
    else if(f==='questions') linked = linked.filter(ln=>ln.type==='question');

    $('#lowerLeftTitle').textContent = f
      ? `${f==='facts'?'Facts':'Questions'} directly linked to: ${short(n.title,40)}`
      : 'Linked facts';

    $('#linkedFacts').innerHTML = linked.length
      ? linked.map(ln=>{
          const lc = ln.status==='challenged'?'conflict':ln.type==='question'?'question':ln.status==='pending'?'pending':'support';
          return `<div class="item clickable" data-navigate="${ln.id}">`
            +`<div class="badges" style="margin-bottom:.25rem"><span class="badge ${lc}">${esc(ln.status)}</span><span class="badge">${esc(ln.type)}</span></div>`
            +`<h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p>`
            +`<small>Click to select &rarr; ${ln.id}</small>`
            +`</div>`;
        }).join('')
      : `<div class="item"><p>${f?'No '+f+' directly linked to this node.':'No linked facts.'}</p></div>`;

    $$('[data-navigate]').forEach(el=>el.addEventListener('click',()=>{
      state.currentId = el.dataset.navigate;
      saveState(); renderGraph(); renderDetail();
      $('#detailPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
    }));
  }

  function renderSources(n){
    const srcs = (n.sources||[]).map(id=>state.sources[id]).filter(Boolean);
    $('#sources').innerHTML = srcs.length
      ? srcs.map(s=>`<div class="item">`
          +`<h4>${esc(s.title)}</h4><p>${esc(s.note)}</p>`
          +`<small>${esc(s.kind)} &middot; quality: ${esc(s.quality)}</small>`
          +`<div class="source-actions">`
          +`<button class="btn" data-sid="${s.id}" data-action="irrelevant">Challenge: irrelevant</button>`
          +`<button class="btn error" data-sid="${s.id}" data-action="false">Challenge: false</button>`
          +`</div></div>`).join('')
      : '<div class="item"><p>No sources attached yet.</p></div>';
    $$('[data-sid]').forEach(btn=>btn.addEventListener('click',()=>openChallenge(btn.dataset.sid,btn.dataset.action)));
    $('#sourceNotice').classList.add('hidden');
    $('#srcTitle').value=''; $('#srcNote').value='';
    $('#addSourceDetails').removeAttribute('open');
  }

  /* ── Queue view ──────────────────────────────────────────────── */
  function renderQueue(){
    const items = queueItems();
    $('#lowerLeftTitle').textContent = 'Moderation queue';
    $('#linkedFacts').innerHTML = items.length
      ? items.map(item=>{
          const ts = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
          return `<div class="item"><h4>${esc(item.title||item.reason||item.id)}</h4>`
            +`<p>${esc(item.summary||item.reason||'')}</p>`
            +`<small>${esc(item.targetType||'submission')} &middot; ${esc(item.status||'pending')} &middot; ${ts}</small></div>`;
        }).join('')
      : '<div class="item"><p>Queue is empty.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Facts gain stable status automatically as community confidence votes accumulate.</p></div>';
  }

  /* ── View switcher ───────────────────────────────────────────── */
  function setView(view){
    state.view = view;
    saveState();
    $$('[data-view]').forEach(a=>a.classList.toggle('active', a.dataset.view===view));
    const titles = {graph:'Knowledge graph',queue:'Moderation queue'};
    const subs   = {graph:'Atomic facts, linked evidence, crowd review',queue:'Pending submissions and challenges for review'};
    $('#viewTitle').textContent = titles[view]||view;
    $('#viewSub').textContent   = subs[view]||'';
    const isQueue = view==='queue';
    $('#graphPanel').classList.toggle('hidden', isQueue);
    $('#detailPanel').classList.toggle('hidden', isQueue);
    $('#sourcesPanel').classList.toggle('hidden', isQueue);
    if(isQueue) renderQueue();
    else { renderGraph(); renderDetail(); }
    renderStats();
  }

  /* ── Challenge modal ─────────────────────────────────────────── */
  function openChallenge(targetId, mode){
    const src = state.sources[targetId];
    const isSource = !!src;
    $('#challengeTypeWrap').classList.toggle('hidden',!isSource);
    if(isSource){
      $('#modalTitle').textContent = mode==='irrelevant'?'Challenge: source not relevant':'Challenge: source unreliable';
      $('#modalIntro').textContent = `Source: "${src.title}"`;
      $('#challengeType').value = mode;
    } else {
      const fact=byId(targetId);
      $('#modalTitle').textContent='Challenge fact';
      $('#modalIntro').textContent=fact?`Fact: "${fact.title}"`:`ID: ${targetId}`;
    }
    $('#targetInfo').value=targetId;
    $('#challengeReason').value='';
    $('#challengeNotice').classList.add('hidden');
    $('#challengeModal').classList.add('show');
  }

  /* ── Event listeners ─────────────────────────────────────────── */
  $('#usernameLabel').textContent = user;
  $('#logoutBtn').addEventListener('click',()=>{ sessionStorage.removeItem('scienceDbUser'); window.location.href='../'; });
  $('#voteRange').addEventListener('input',e=>{ $('#confidenceValue').textContent=Number(e.target.value).toFixed(1); });

  $('#voteBtn').addEventListener('click',()=>{
    const n=byId(state.currentId); if(!n) return;
    const v=parseInt($('#voteRange').value,10);
    const existing=userVoteFor(n.id);
    if(existing){
      n.confidence=(n.confidence*n.votes-existing.value+v)/n.votes;
      existing.value=v; existing.timestamp=Date.now();
    } else {
      n.confidence=((n.confidence*n.votes)+v)/(n.votes+1);
      n.votes++;
      state.votes.push({targetId:n.id,user,value:v,timestamp:Date.now()});
    }
    saveState();
    $('#voteNotice').textContent=existing
      ?`Vote updated to ${v}/5. New confidence: ${n.confidence.toFixed(1)}.`
      :`Vote recorded (${v}/5). Confidence: ${n.confidence.toFixed(1)}.`;
    $('#voteNotice').classList.remove('hidden');
    renderStats(); renderDetail(); renderGraph();
  });

  $('#factChallengeBtn').addEventListener('click',()=>openChallenge(state.currentId,null));
  $('#closeModal').addEventListener('click',()=>$('#challengeModal').classList.remove('show'));
  $('#challengeModal').addEventListener('click',e=>{ if(e.target===$('#challengeModal')) $('#challengeModal').classList.remove('show'); });

  $('#challengeForm').addEventListener('submit',e=>{
    e.preventDefault();
    const target=$('#targetInfo').value;
    const isSource=!!state.sources[target];
    state.challenges.push({id:'c'+Date.now(),targetId:target,targetType:isSource?'source':'fact',
      challengeType:isSource?$('#challengeType').value:'fact',
      reason:$('#challengeReason').value.trim(),user,status:'pending',timestamp:Date.now()});
    if(!isSource){ const n=byId(target); if(n) n.status='challenged'; }
    saveState();
    $('#challengeNotice').textContent='Challenge submitted. It is now in the queue.';
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

  $('#factForm').addEventListener('submit',e=>{
    e.preventDefault();
    const id='f'+Date.now();
    const title=$('#newFactTitle').value.trim();
    const summary=$('#newFactSummary').value.trim();
    const type=$('#newFactType').value;
    const linkedIds=$('#newFactLinks').value.split(',').map(s=>s.trim()).filter(Boolean);
    const links=linkedIds.map(to=>({to,kind:'support'}));
    state.nodes.unshift({id,title,summary,type,status:'pending',confidence:3.0,votes:0,sources:[],links});
    placeNewNode(id,linkedIds);
    state.submissions.push({id,title,summary,type,links:linkedIds,status:'pending',user,timestamp:Date.now()});
    saveState();
    $('#factNotice').textContent=`"${title}" submitted and placed near linked nodes.`;
    $('#factNotice').classList.remove('hidden');
    renderStats(); renderGraph();
  });

  $('#cancelSource').addEventListener('click',()=>$('#addSourceDetails').removeAttribute('open'));
  $('#sourceForm').addEventListener('submit',e=>{
    e.preventDefault();
    const n=byId(state.currentId); if(!n) return;
    const sid='s'+Date.now();
    state.sources[sid]={id:sid,title:$('#srcTitle').value.trim(),kind:$('#srcKind').value,
      quality:$('#srcQuality').value,note:$('#srcNote').value.trim()||''};
    if(!n.sources) n.sources=[];
    n.sources.push(sid);
    saveState();
    $('#sourceNotice').textContent=`Source attached to "${short(n.title,50)}".`;
    $('#sourceNotice').classList.remove('hidden');
    renderSources(n);
  });

  $('#navLinks').addEventListener('click',e=>{
    const a=e.target.closest('[data-view]');
    if(a){ e.preventDefault(); setView(a.dataset.view); }
  });

  setView(state.view||'graph');

})();
