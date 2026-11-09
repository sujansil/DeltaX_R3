(function(){
  'use strict';
  const {E,renderText,formatClock,remaining,toast}=window.R3;
  const main=document.getElementById('mainPanel');
  const tabChallenge=document.getElementById('challengeTab');
  const tabResources=document.getElementById('resourcesTab');
  const dialog=document.getElementById('briefDialog');
  let payload=null, section='challenge', signature='', inFlight=false, interval;
  const stages='<div class="journey"><span><small>01</small> OBSERVE</span><i></i><span><small>02</small> PLAY</span><i></i><span class="journey-now"><small>03</small> PROVE <b class="journey-star">✳</b></span></div>';
  const diagramA=`<svg viewBox="0 0 500 254" class="math-diagram" role="img" aria-label="Semi-elliptical launch boundary enclosing a rectangular satellite core"><defs><linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b98b69" stop-opacity=".23"/><stop offset="1" stop-color="#b98b69" stop-opacity=".01"/></linearGradient></defs><path d="M25 215H475" stroke="#8c9a96" stroke-width=".8" opacity=".35"/><path d="M250 18V236" stroke="#8c9a96" stroke-width=".8" opacity=".27" stroke-dasharray="3 7"/><path class="draw-line" d="M58 215 A192 178 0 0 1 442 215" stroke="#c6a184" stroke-width="1.6" fill="none"/><path d="M114 215 L114 89 L386 89 L386 215 Z" stroke="#d3d4c7" opacity=".74" fill="url(#gA)" stroke-width="1.1"/><path d="M114 89H386" stroke="#d3d4c7" stroke-dasharray="4 7" opacity=".52"/><path d="M114 89L250 215L386 89" stroke="#c5aa87" opacity=".26" fill="none"/><circle cx="114" cy="89" r="3" fill="#c6a184"/><circle cx="386" cy="89" r="3" fill="#c6a184"/><text x="252" y="228" text-anchor="middle">2x₀</text><text x="100" y="155">y₀</text><text x="318" y="40">x²/36 + y²/25 ≤ 1</text><path d="M100 89h-11m11 126h-11M94.5 89v126" stroke="#c6a184" opacity=".4"/></svg>`;
  // Qualitative drawing of the actual coupling law: θ₂ = 2θ₁ relative to
  // segment 1, hence absolute second-segment orientation = 3θ₁. Not to scale.
  const diagramB=`<svg viewBox="0 0 500 254" class="math-diagram" role="img" aria-label="Two equal length solar-array links; first at theta one to the horizontal, second at three theta one to the horizontal, with hinge rotation theta two equals two theta one"><path d="M24 214H478M250 15V238" stroke="#8c9a96" opacity=".29" stroke-width=".8"/><path class="draw-line" d="M58 215 A192 178 0 0 1 442 215" fill="none" stroke="#8cb7bb" opacity=".65"/><rect x="161" y="204" width="74" height="12" fill="#a7b5af" fill-opacity=".07" stroke="#a7b5af" stroke-opacity=".5"/><path d="M210 205H387" stroke="#a6c4c4" opacity=".28" stroke-dasharray="4 5"/><path d="M210 205L303 161L330 62" fill="none" stroke="#a6c4c4" stroke-width="5" stroke-linecap="round"/><path d="M210 205L303 161L330 62" fill="none" stroke="#e2e3d8" stroke-width="1.2"/><path d="M303 161L392 119" fill="none" stroke="#a6c4c4" opacity=".34" stroke-dasharray="4 5"/><path d="M245 205 A35 35 0 0 0 242 190" fill="none" stroke="#d9aa82" stroke-width="1.7"/><path d="M332 147 A32 32 0 0 0 311 130" fill="none" stroke="#d9aa82" stroke-width="1.7"/><circle cx="210" cy="205" r="5" fill="#d9aa82"/><circle cx="303" cy="161" r="5" fill="#d9aa82"/><circle cx="330" cy="62" r="4" fill="#b1cfcc"/><text x="255" y="193">θ₁</text><text x="345" y="136">θ₂ = 2θ₁</text><text x="254" y="157">L</text><text x="323" y="107">L</text><text x="69" y="33">φ₂ = θ₁ + θ₂ = 3θ₁</text></svg>`;
  const orbitArt=`<div class="hero-orbit" aria-hidden="true"><svg viewBox="0 0 460 320" fill="none"><defs><radialGradient id="sunGlow"><stop stop-color="#d2a275" stop-opacity=".4"/><stop offset="1" stop-color="#d2a275" stop-opacity="0"/></radialGradient></defs><circle cx="240" cy="161" r="145" stroke="#a4adab" stroke-opacity=".1"/><circle cx="240" cy="161" r="99" stroke="#a4adab" stroke-opacity=".14" stroke-dasharray="2 7"/><ellipse cx="240" cy="161" rx="187" ry="80" transform="rotate(-20 240 161)" stroke="#d1a580" stroke-opacity=".46"/><ellipse cx="240" cy="161" rx="187" ry="80" transform="rotate(40 240 161)" stroke="#93bcc0" stroke-opacity=".3"/><circle cx="240" cy="161" r="31" stroke="#b3bcb4" stroke-opacity=".6"/><path d="M210 161h60m-30-30v60" stroke="#b3bcb4" stroke-opacity=".4"/><rect x="234" y="154" width="12" height="14" stroke="#d4d6cb" fill="#12191a"/><path d="M211 151h22m13 0h22m-57 0v20m57-20v20" stroke="#abbfc0"/><circle cx="379" cy="92" r="52" fill="url(#sunGlow)"/><circle cx="379" cy="92" r="4" fill="#d4ac83"/><path d="M379 92L270 156" stroke="#d4ac83" stroke-dasharray="2 6" opacity=".6"/><text x="88" y="284">∫ LIGHT · AREA · TIME</text><text x="284" y="34">T = 2π/ω</text></svg></div>`;
  const escTitle=(track)=>track==='A'?'01 / HELIOS I':'02 / HELIOS II';
  function setHeader(){
    let s=payload?.state; if(!s)return;
    const labels={preview:'AWAITING THE CHOICE',locked:'THE CHOICE IS LOCKED',running:'FINAL ROUND IN PROGRESS',paused:'CLOCK PAUSED',finished:'TIME HAS EXPIRED'};
    document.getElementById('headerStatus').textContent=labels[s.phase]||'ROUND THREE';
  }
  function card(track,q){
    let warm=track==='A';
    return `<article class="track-card ${warm?'track-warm':'track-cool'}" aria-label="${E(q.title)}"><div class="track-card-top"><span class="eyebrow">PATH ${track} <span class="track-symbol">↗</span></span><span class="track-points">100 MARKS <span> / </span> 03 PARTS</span></div><div class="track-art">${warm?diagramA:diagramB}<div class="art-code">${warm?'BOUNDARY / GEOMETRY':'COUPLING / KINEMATICS'}</div></div><div class="track-copy"><span class="track-serial">${warm?'I':'II'}</span><div><h2>${E(q.title)}</h2><p class="track-subtitle">${E(q.subtitle)}</p><p class="track-blurb">${E(q.blurb)}</p></div></div><div class="track-card-bottom"><span>${warm?'FORM, FIT & FLUX':'MOTION, LINKS & FLUX'}</span><button type="button" class="read-brief" data-open="${track}">EXPLORE QUESTION <span aria-hidden="true">↗</span></button></div></article>`;
  }
  function renderPreview(){
    const qs=payload.questions, common=payload.state.shared;
    main.innerHTML=`<div class="preview-hero"><div class="hero-copy">${stages}<div class="eyebrow hero-overline"><span class="tiny-diamond"></span> THE GRAND FINALE · ROUND 03</div><h1>Two possibilities.<br><em>One proof.</em></h1><p>The game ends where the thinking begins. Two mathematical paths. One final decision. The work is yours.</p><div class="hero-foot"><span class="thin-line"></span> FIVE MINUTES TO READ <span class="mini-spark">✳</span> ONE COLLECTIVE VOTE</div></div>${orbitArt}</div><div class="section-heading"><div><span class="eyebrow">CHOOSE THE PATH</span><h2>Two ways to face the same Sun.</h2></div><span class="section-heading-right">THE DECISION IS MADE BY THE ROOM <span>↘</span></span></div><div class="track-grid">${card('A',qs.A)}${card('B',qs.B)}</div><section class="shared-strip"><div class="shared-number">00 <span>/</span></div><div><span class="eyebrow">THE SAME RULES OF PHYSICS</span><h3>One sky. Two approaches.</h3><p>Both paths share the same orbital conditions, solar vector and geometric launch envelope.</p><button class="underline-button" id="sharedBtn">READ SHARED CONDITIONS ↗</button></div><div class="shared-formula">S(t) = [cos(ωt), sin(ωt)/√2, sin(ωt)/√2]ᵀ</div></section>`;
    document.querySelectorAll('[data-open]').forEach(btn=>btn.addEventListener('click',()=>openBrief(btn.dataset.open)));
    document.getElementById('sharedBtn').addEventListener('click',()=>openBrief('shared'));
  }
  function renderSelected(){
    const s=payload.state,q=payload.questions[s.selected];if(!q)return;
    const label=s.selected==='A'?'PATH A / GEOMETRY':'PATH B / KINEMATICS';
    let stateTag={locked:'WAITING FOR THE CLOCK',running:'THE FINAL ROUND IS LIVE',paused:'THE CLOCK IS PAUSED',finished:'THE FINAL ROUND HAS ENDED'}[s.phase]||'';
    main.innerHTML=`<div class="selected-hero"><div class="selected-hero-head">${stages}<span class="eyebrow">ONLY ONE PATH REMAINS</span></div><div class="selected-head-main"><div><div class="eyebrow selected-overline"><span class="tiny-diamond"></span> THE DECISION HAS BEEN MADE</div><h1>${E(q.title)}<span class="selected-period">.</span></h1><p>${E(q.subtitle)}</p></div><div class="selected-hero-art">${s.selected==='A'?diagramA:diagramB}</div></div><div class="clock-panel" id="clockPanel"><div class="clock-identity"><span class="clock-icon">◷</span><div><span class="eyebrow">THE TIME THAT REMAINS</span><strong id="publicPhaseLabel">${stateTag}</strong></div></div><div class="countdown"><div id="publicClock" aria-label="Remaining time">${formatClock(remaining(s))}</div><span>HH : MM : SS</span></div><div class="clock-track"><span id="clockProgress"></span></div></div></div><div class="selected-layout"><div class="reading-column"><div class="brief-header"><span class="eyebrow">OFFICIAL QUESTION / ${E(label)}</span><span class="question-total">100 MARKS</span></div><div class="selected-shared"><button class="shared-toggle" type="button" id="sharedToggle" aria-expanded="false"><span>00 / SHARED PHYSICAL SCENARIO</span><span id="sharedChevron">＋</span></button><div class="shared-body brief-typography hidden" id="sharedBody">${renderText(s.shared)}</div></div><article class="brief-typography selected-text">${renderText(q.content)}</article><div class="brief-end">END OF BRIEF <span>✳</span> SHOW ALL MATHEMATICAL WORKING</div></div><aside class="selected-aside"><div class="aside-block"><span class="eyebrow">THE FINISH LINE</span><p>There are no more power-ups. No shortcuts. Only the answer you can prove.</p></div><div class="aside-block"><span class="eyebrow">RULES AT A GLANCE</span><ul><li>Pen, paper and non-programmable scientific calculators only.</li><li>Show intermediate steps and mathematical derivations.</li><li>Submit work in the supplied answer booklet.</li></ul></div><div class="aside-deco"><span>Δ</span><span>THE LAST VARIABLE IS YOU.</span></div></aside></div>`;
    document.getElementById('sharedToggle').addEventListener('click',()=>{const body=document.getElementById('sharedBody'); const expanded=body.classList.toggle('hidden');document.getElementById('sharedToggle').setAttribute('aria-expanded', String(!expanded));document.getElementById('sharedChevron').textContent=expanded?'＋':'−';});
    tick();
  }
  function renderResources(){
    const resources=payload.resources||[];
    main.innerHTML=`<div class="resources-hero">${stages}<span class="eyebrow">02 / RESOURCE DESK</span><h1>Everything within <em>reach.</em></h1><p>References, clarifications and supporting material made available by the organizers.</p></div><section class="resources-public"><div class="section-heading"><div><span class="eyebrow">AVAILABLE MATERIAL</span><h2>The resource library.</h2></div><span class="tiny-label">${String(resources.length).padStart(2,'0')} ITEMS</span></div>${resources.length?`<div class="public-resource-grid">${resources.map(r=>{const url=r.kind==='file'?`/api/resources/${r.id}/download`:r.url;return `<a class="public-resource" href="${E(url)}" target="_blank" rel="noopener noreferrer"><span class="resource-type">${r.kind==='file'?'DOCUMENT':'EXTERNAL LINK'}</span><h3>${E(r.title)}</h3><p>${E(r.description||'Provided by the organizers.')}</p><span class="resource-arrow">↗</span></a>`;}).join('')}</div>`:`<div class="resources-empty"><span class="empty-figure">∅</span><h3>A clean slate.</h3><p>No resources have been published for this round yet.<br>If the organizers share any, they will appear here.</p><span class="eyebrow">THE QUESTION IS STILL THE MAIN EVENT</span></div>`}</section>`;
  }
  function openBrief(track){
    if(!payload)return;
    const q=payload.questions[track];
    document.getElementById('dialogEyebrow').textContent=track==='shared'?'THE SHARED CONDITIONS':`PATH ${track} / FULL BRIEF`;
    document.getElementById('dialogTitle').textContent=track==='shared'?'The physical scenario.':q.title;
    document.getElementById('dialogSubtitle').textContent=track==='shared'?'Common to both challenges.':q.subtitle;
    document.getElementById('dialogShared').innerHTML=track==='shared'?'':renderText(payload.state.shared);
    document.getElementById('dialogBody').innerHTML=renderText(track==='shared'?payload.state.shared:q.content);
    dialog.showModal();
  }
  function tick(){
    const el=document.getElementById('publicClock'),s=payload?.state;
    if(!el||!s)return;
    let secs=remaining(s);
    el.textContent=formatClock(secs);
    const progress=document.getElementById('clockProgress');
    if(progress)progress.style.width=`${Math.min(100,Math.max(0,100*secs/(s.duration||7200)))}%`;
    const panel=document.getElementById('clockPanel');
    if(panel)panel.dataset.phase=s.phase==='running'&&secs===0?'finished':s.phase;
    if(s.phase==='running'&&secs===0)document.getElementById('publicPhaseLabel').textContent='TIME HAS EXPIRED';
  }
  async function refresh(){if(inFlight)return;inFlight=true;try{
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),5000);
    const r=await fetch('/api/public',{cache:'no-store',signal:controller.signal}).finally(()=>clearTimeout(timeout));if(!r.ok)throw Error('Connection unavailable');
    const next=await r.json();
    if(next.masked){
      // Fail closed on a live seal: immediately erase already-rendered challenges.
      payload=null;signature='';document.documentElement.style.background='#000';
      document.body.replaceChildren();
      location.replace('/?sealed='+Date.now());
      return;
    }
    window.R3.timeOffset=next.state.server_now-Date.now()/1000;
    let key=`${next.state.revision}:${next.state.phase}:${section}`;
    payload=next;
    document.getElementById('resourceCount').textContent=String(next.resources.length).padStart(2,'0');
    setHeader();
    if(key!==signature){
      const changing=signature && section==='challenge' && (signature.includes(':preview:') !== key.includes(':preview:'));
      signature=key;
      if(changing && document.startViewTransition) document.startViewTransition(()=>render());
      else render();
    }
    tick();
  }catch(e){document.getElementById('headerStatus').textContent='RECONNECTING…';if(!payload)main.innerHTML='<div class="initial-loading">Connection interrupted. Trying again…</div>';}finally{inFlight=false;}}
  function render(){
    tabChallenge.classList.toggle('active',section==='challenge');
    tabResources.classList.toggle('active',section==='resources');
    if(section==='resources')renderResources();
    else if(payload?.state.phase==='preview')renderPreview();
    else if(payload)renderSelected();
  }
  tabChallenge.addEventListener('click',()=>{section='challenge';signature='';render();});
  tabResources.addEventListener('click',()=>{section='resources';signature='';render();});
  document.getElementById('closeDialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',(e)=>{if(e.target===dialog)dialog.close();});
  refresh();setInterval(refresh,2500);interval=setInterval(tick,250);
})();
