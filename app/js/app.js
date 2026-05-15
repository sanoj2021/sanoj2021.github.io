(function(){
  'use strict';

  const user = sessionStorage.getItem('scienceDbUser');
  if(!user){ window.location.href='../'; return; }

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = (s,n) => s.length>n ? s.slice(0,n-1)+'\u2026' : s;

  const STORAGE_KEY = 'sciencedb:v1';
  const DEFAULT_STATE = {
    nodes: window.SDB.nodes,
    sources: window.SDB.sources,
    votes: [],
    challenges: [],
    submissions: [],
    currentId: 'f1',
    view: 'graph'
  };
  function loadState(){
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : structuredClone(DEFAULT_STATE); }
    catch(e){ return structuredClone(DEFAULT_STATE); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  let state = loadState();

  const root = document.documentElement;
  let theme = root.getAttribute('data-theme') || 'dark';
  root.setAttribute('data-theme', theme);
  $('#themeBtn').addEventListener('click', ()=>{ theme = theme==='dark'?'light':'dark'; root.setAttribute('data-theme',theme); });

  function byId(id){ return state.nodes.find(n=>n.id===id); }
  function visibleNodes(){
    if(state.view==='facts') return state.nodes.filter(n=>n.type==='fact');
    if(state.view==='questions') return state.nodes.filter(n=>n.type==='question');
    return state.nodes;
  }
  function queueItems(){ return [...state.submissions, ...state.challenges.filter(c=>c.status==='pending')]; }

  function renderStats(){
    $('#statFacts').textContent = state.nodes.filter(n=>n.type==='fact').length;
    $('#statQuestions').textContent = state.nodes.filter(n=>n.type==='question').length;
    $('#statQueue').textContent = queueItems().length;
  }

  const POS = {f1:[280,175],f2:[490,95],f3:[510,275],f4:[740,120],f5:[755,305],f6:[235,340]};
  function posOf(id){ return POS[id] || [100+((id.charCodeAt(1)||0)*137)%700, 80+((id.charCodeAt(2)||0)*97)%320]; }

  function renderGraph(){
    const svg = $('#graphSvg');
    svg.setAttribute('viewBox','0 0 900 480');
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
      const active=n.id===state.currentId;
      const r=active?34:26;
      const fillOuter=n.status==='challenged'?'color-mix(in oklab,var(--error) 18%,var(--surface2))':n.type==='question'?'color-mix(in oklab,var(--warn) 15%,var(--surface2))':n.status==='pending'?'color-mix(in oklab,var(--warn) 15%,var(--surface2))':'color-mix(in oklab,var(--primary) 15%,var(--surface2))';
      const fillDot=n.status==='challenged'?'var(--error)':n.type==='question'?'var(--warn)':n.status==='pending'?'var(--warn)':'var(--primary)';
      nodes+=`<g class="node" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}"><circle cx="${x}" cy="${y}" r="${r}" fill="${fillOuter}"/><circle cx="${x}" cy="${y}" r="7" fill="${fillDot}"/><text x="${x}" y="${y+r+16}" text-anchor="middle">${esc(short(n.title,38))}</text></g>`;
    });
    svg.innerHTML = defs + edges + nodes;
    $$('.node').forEach(el=>el.addEventListener('click',()=>{ state.currentId=el.dataset.id; saveState(); renderDetail(); }));
  }

  function renderDetail(){
    const n = byId(state.currentId) || state.nodes[0];
    state.currentId = n.id;
    $('#factTitle').textContent = n.title;
    $('#factSummary').textContent = n.summary;
    $('#confidenceValue').textContent = n.confidence.toFixed(1);
    $('#voteRange').value = Math.round(n.confidence);
    const cls=n.status==='challenged'?'conflict':n.type==='question'?'question':n.status==='pending'?'pending':'support';
    $('#factMeta').innerHTML=`<span class="badge ${cls}">${esc(n.status)}</span><span class="badge">${esc(n.type)}</span><span class="badge">${n.votes} votes</span><span class="badge">confidence: ${n.confidence.toFixed(1)}</span>`;
    const linked=(n.links||[]).map(l=>byId(l.to)).filter(Boolean);
    $('#linkedFacts').innerHTML=linked.length?linked.map(ln=>`<div class="item"><h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p><small>ID: ${ln.id} &middot; ${ln.status}</small></div>`).join(''):'<div class="item"><p>No linked facts.</p></div>';
    const srcs=(n.sources||[]).map(id=>state.sources[id]).filter(Boolean);
    $('#sources').innerHTML=srcs.length?srcs.map(s=>`<div class="item"><h4>${esc(s.title)}</h4><p>${esc(s.note)}</p><small>${esc(s.kind)} &middot; quality: ${esc(s.quality)}</small><div class="source-actions"><button class="btn" data-sid="${s.id}" data-action="irrelevant">Challenge: irrelevant</button><button class="btn error" data-sid="${s.id}" data-action="false">Challenge: false</button></div></div>`).join(''):'<div class="item"><p>No sources attached.</p></div>';
    $$('[data-sid]').forEach(btn=>btn.addEventListener('click',()=>openChallenge(btn.dataset.sid, btn.dataset.action)));
    $('#voteNotice').classList.add('hidden');
  }

  function renderQueue(){
    const items = queueItems();
    $('#lowerLeftTitle').textContent = 'Moderation queue';
    $('#linkedFacts').innerHTML = items.length ? items.map(item=>{
      const ts = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
      return `<div class="item"><h4>${esc(item.title || item.reason || item.id)}</h4><p>${esc(item.summary || item.reason || '')}</p><small>${esc(item.targetType||'submission')} &middot; ${esc(item.status||'pending')} &middot; ${ts}</small></div>`;
    }).join('') : '<div class="item"><p>Queue is empty. New submissions and challenges appear here.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Full moderation controls (approve / reject) will be available to high-reputation users in a future update.</p></div>';
  }

  function renderFactsList(){
    const facts = state.nodes.filter(n=>n.type==='fact'||n.type==='claim');
    $('#lowerLeftTitle').textContent = 'All facts & claims';
    $('#linkedFacts').innerHTML = facts.map(n=>{
      const cls=n.status==='challenged'?'conflict':n.status==='pending'?'pending':'support';
      return `<div class="item"><div class="badges" style="margin-bottom:.3rem"><span class="badge ${cls}">${esc(n.status)}</span><span class="badge">${n.votes} votes</span><span class="badge">conf: ${n.confidence.toFixed(1)}</span></div><h4>${esc(n.title)}</h4><p>${esc(n.summary)}</p></div>`;
    }).join('');
    $('#sources').innerHTML = '<div class="item"><p>Select a node in the graph to inspect its sources and challenge options.</p></div>';
  }

  function renderQuestionsList(){
    const questions = state.nodes.filter(n=>n.type==='question');
    $('#lowerLeftTitle').textContent = 'Open questions';
    $('#linkedFacts').innerHTML = questions.length ? questions.map(n=>`<div class="item"><div class="badges" style="margin-bottom:.3rem"><span class="badge question">question</span><span class="badge">${n.votes} votes</span></div><h4>${esc(n.title)}</h4><p>${esc(n.summary)}</p></div>`).join('') : '<div class="item"><p>No open questions yet.</p></div>';
    $('#sources').innerHTML = '<div class="item"><p>Questions can be submitted via &ldquo;+ Add fact&rdquo; by selecting type &ldquo;Question&rdquo;.</p></div>';
  }

  function setView(view){
    state.view = view;
    saveState();
    $$('[data-view]').forEach(a=>a.classList.toggle('active', a.dataset.view===view));
    const titles = {graph:'Knowledge graph',facts:'Facts',questions:'Questions',queue:'Moderation queue'};
    const subs = {graph:'Atomic facts, linked evidence, crowd review',facts:'All submitted fact and claim nodes',questions:'Open questions awaiting evidence',queue:'Pending submissions and challenges for review'};
    $('#viewTitle').textContent = titles[view] || view;
    $('#viewSub').textContent = subs[view] || '';
    const isQueue = view==='queue';
    $('#graphPanel').classList.toggle('hidden', isQueue);
    $('#detailPanel').classList.toggle('hidden', isQueue);
    if(isQueue){ renderQueue(); }
    else if(view==='facts'){ renderGraph(); renderFactsList(); }
    else if(view==='questions'){ renderGraph(); renderQuestionsList(); }
    else { renderGraph(); renderDetail(); }
    renderStats();
  }

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

  $('#usernameLabel').textContent = user;
  $('#logoutBtn').addEventListener('click',()=>{ sessionStorage.removeItem('scienceDbUser'); window.location.href='../'; });
  $('#voteRange').addEventListener('input', e=>{ $('#confidenceValue').textContent = Number(e.target.value).toFixed(1); });

  $('#voteBtn').addEventListener('click',()=>{
    const n = byId(state.currentId); if(!n) return;
    const v = parseInt($('#voteRange').value, 10);
    n.confidence = ((n.confidence * n.votes) + v) / (n.votes + 1);
    n.votes++;
    state.votes.push({targetId:n.id, user, value:v, timestamp:Date.now()});
    saveState();
    $('#voteNotice').textContent = `Vote recorded (${v}/5). New confidence: ${n.confidence.toFixed(1)}.`;
    $('#voteNotice').classList.remove('hidden');
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
      id:'c'+Date.now(),
      targetId: target,
      targetType: isSource?'source':'fact',
      challengeType: isSource ? $('#challengeType').value : 'fact',
      reason: $('#challengeReason').value.trim(),
      user, status:'pending', timestamp:Date.now()
    });
    if(!isSource){ const n=byId(target); if(n) n.status='challenged'; }
    saveState();
    $('#challengeNotice').textContent = `Challenge submitted for "${target}". It is now in the moderation queue.`;
    $('#challengeNotice').classList.remove('hidden');
    renderStats();
    renderGraph();
    renderDetail();
  });

  $('#addFactBtn').addEventListener('click',()=>{
    $('#newFactTitle').value='';
    $('#newFactSummary').value='';
    $('#newFactLinks').value='';
    $('#factNotice').classList.add('hidden');
    $('#factModal').classList.add('show');
  });
  $('#closeFactModal').addEventListener('click',()=>$('#factModal').classList.remove('show'));
  $('#factModal').addEventListener('click',e=>{ if(e.target===$('#factModal')) $('#factModal').classList.remove('show'); });

  $('#factForm').addEventListener('submit', e=>{
    e.preventDefault();
    const id = 'f'+Date.now();
    const title = $('#newFactTitle').value.trim();
    const summary = $('#newFactSummary').value.trim();
    const type = $('#newFactType').value;
    const links = $('#newFactLinks').value.split(',').map(s=>s.trim()).filter(Boolean).map(to=>({to,kind:'support'}));
    const newNode = {id, title, summary, type, status:'pending', confidence:3.0, votes:0, sources:[], links};
    state.nodes.unshift(newNode);
    state.submissions.push({id, title, summary, type, links:links.map(l=>l.to), status:'pending', user, timestamp:Date.now()});
    saveState();
    $('#factNotice').textContent = `"${title}" submitted and queued for moderation.`;
    $('#factNotice').classList.remove('hidden');
    renderStats();
    renderGraph();
  });

  $('#navLinks').addEventListener('click', e=>{
    const a = e.target.closest('[data-view]');
    if(a){ e.preventDefault(); setView(a.dataset.view); }
  });

  setView(state.view || 'graph');

})();
