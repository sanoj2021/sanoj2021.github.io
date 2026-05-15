(function(){
  'use strict';
  const user = sessionStorage.getItem('scienceDbUser');
  if(!user){ window.location.href='../'; return; }

  const db = window.SDB;
  let cur = 'f1';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const node = id => db.nodes.find(n=>n.id===id);
  const esc = s => s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short = (s,n) => s.length>n ? s.slice(0,n-1)+'\u2026' : s;

  /* ── Theme ── */
  const root = document.documentElement;
  let theme = root.getAttribute('data-theme')||'dark';
  function applyTheme(){ root.setAttribute('data-theme', theme); }
  applyTheme();
  function toggleTheme(){ theme = theme==='dark'?'light':'dark'; applyTheme(); }

  /* ── Stats ── */
  function renderStats(){
    $('#statFacts').textContent = db.nodes.filter(n=>n.type==='fact').length;
    $('#statQuestions').textContent = db.nodes.filter(n=>n.type==='question').length;
    $('#statChallenges').textContent = db.nodes.filter(n=>n.status==='challenged').length;
  }

  /* ── Graph ── */
  const POS = {f1:[280,175],f2:[490,95],f3:[510,275],f4:[740,120],f5:[755,305],f6:[235,340]};

  function renderGraph(){
    const svg = $('#graphSvg');
    const W=900, H=480;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);

    const defs = `<defs>
      <marker id="aS" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--primary)"/></marker>
      <marker id="aD" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--muted)"/></marker>
      <marker id="aC" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--error)"/></marker>
    </defs>`;

    let edges = '';
    db.nodes.forEach(n=>{
      (n.links||[]).forEach(l=>{
        const p1=POS[n.id], p2=POS[l.to];
        if(!p1||!p2) return;
        const [x1,y1]=p1, [x2,y2]=p2;
        const mx=(x1+x2)/2;
        const cls = l.kind==='support'?'support':l.kind==='conflict'?'conflict':'depend';
        const m = l.kind==='support'?'url(#aS)':l.kind==='conflict'?'url(#aC)':'url(#aD)';
        edges+=`<path class="edge ${cls}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" marker-end="${m}"/>`;
      });
    });

    let nodes = '';
    db.nodes.forEach(n=>{
      const [x,y]=POS[n.id];
      const active = n.id===cur;
      const r = active?34:26;
      const fillOuter = n.status==='challenged'
        ? 'color-mix(in oklab,var(--error) 18%,var(--surface2))'
        : n.type==='question'
          ? 'color-mix(in oklab,var(--warn) 15%,var(--surface2))'
          : 'color-mix(in oklab,var(--primary) 15%,var(--surface2))';
      const fillDot = n.status==='challenged'?'var(--error)':n.type==='question'?'var(--warn)':'var(--primary)';
      nodes+=`<g class="node" data-id="${n.id}" role="button" aria-label="${esc(short(n.title,60))}">
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fillOuter}"/>
        <circle cx="${x}" cy="${y}" r="7" fill="${fillDot}"/>
        <text x="${x}" y="${y+r+16}" text-anchor="middle">${esc(short(n.title,36))}</text>
      </g>`;
    });

    svg.innerHTML = defs + edges + nodes;
    $$('.node').forEach(el=>el.addEventListener('click',()=>{ cur=el.dataset.id; renderAll(); }));
  }

  /* ── Detail panel ── */
  function renderDetail(){
    const n = node(cur);
    $('#factTitle').textContent = n.title;
    $('#factSummary').textContent = n.summary;
    $('#confidenceValue').textContent = n.confidence.toFixed(1);
    $('#voteRange').value = Math.round(n.confidence);

    const statusCls = n.status==='challenged'?'conflict':n.type==='question'?'question':'support';
    $('#factMeta').innerHTML =
      `<span class="badge ${statusCls}">${n.status}</span>`+
      `<span class="badge">${n.type}</span>`+
      `<span class="badge">${n.votes} votes</span>`;

    // Linked facts
    const linked = (n.links||[]).map(l=>node(l.to)).filter(Boolean);
    $('#linkedFacts').innerHTML = linked.length
      ? linked.map(ln=>`<div class="item"><h4>${esc(ln.title)}</h4><p>${esc(ln.summary)}</p><small>ID: ${ln.id} &middot; ${ln.status}</small></div>`).join('')
      : '<div class="item"><p>No linked facts.</p></div>';

    // Sources
    const srcs = (n.sources||[]).map(id=>db.sources[id]).filter(Boolean);
    $('#sources').innerHTML = srcs.length
      ? srcs.map(s=>`<div class="item"><h4>${esc(s.title)}</h4><p>${esc(s.note)}</p><small>${s.kind} &middot; quality: ${s.quality}</small>
          <div class="source-actions">
            <button class="btn" data-sid="${s.id}" data-action="irrelevant">Challenge: irrelevant for this fact</button>
            <button class="btn error" data-sid="${s.id}" data-action="false">Challenge: false / unreliable</button>
          </div></div>`).join('')
      : '<div class="item"><p>No sources attached.</p></div>';

    $$('[data-sid]').forEach(btn=>btn.addEventListener('click',()=>openModal(btn.dataset.sid, btn.dataset.action)));
  }

  /* ── Modal ── */
  function openModal(targetId, mode){
    const isSource = !!db.sources[targetId];
    $('#challengeTypeWrap').classList.toggle('hidden', !isSource);
    if(isSource){
      const s = db.sources[targetId];
      $('#modalTitle').textContent = mode==='irrelevant' ? 'Challenge: source not relevant' : 'Challenge: source unreliable';
      $('#modalIntro').textContent = mode==='irrelevant'
        ? `The source "${s.title}" may be real but not appropriate evidence for this fact.`
        : `The source "${s.title}" may itself be false, misleading, or unreliable.`;
      $('#challengeType').value = mode;
    } else {
      $('#modalTitle').textContent = 'Challenge fact';
      $('#modalIntro').textContent = `Submit a challenge for: ${node(targetId).title}`;
    }
    $('#targetInfo').value = targetId;
    $('#challengeNotice').classList.add('hidden');
    $('#challengeReason').value = '';
    $('#challengeModal').classList.add('show');
  }

  /* ── Bind events ── */
  function bind(){
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#logoutBtn').addEventListener('click',()=>{ sessionStorage.removeItem('scienceDbUser'); window.location.href='../'; });
    $('#usernameLabel').textContent = user;
    $('#voteRange').addEventListener('input', e=>{ $('#confidenceValue').textContent = Number(e.target.value).toFixed(1); });
    $('#voteBtn').addEventListener('click',()=>{
      const n=node(cur);
      const v=parseInt($('#voteRange').value);
      n.confidence=((n.confidence*n.votes)+v)/(n.votes+1);
      n.votes++;
      renderAll();
    });
    $('#factChallengeBtn').addEventListener('click',()=>openModal(cur, null));
    $('#closeModal').addEventListener('click',()=>$('#challengeModal').classList.remove('show'));
    $('#challengeModal').addEventListener('click', e=>{ if(e.target===$('#challengeModal')) $('#challengeModal').classList.remove('show'); });
    $('#challengeForm').addEventListener('submit', e=>{
      e.preventDefault();
      $('#challengeNotice').textContent = `Challenge recorded for "${$('#targetInfo').value}". This is a prototype — submissions are not yet persisted.`;
      $('#challengeNotice').classList.remove('hidden');
    });
  }

  function renderAll(){ renderStats(); renderGraph(); renderDetail(); }

  document.addEventListener('DOMContentLoaded',()=>{ bind(); renderAll(); });
})();
