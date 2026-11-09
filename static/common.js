(function(){
  'use strict';
  const E = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'", '&#39;');
  const I = (s) => E(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  function renderText(input){
    let rows=String(input||'').split(/\r?\n/), result=[], paragraph=[], inList=false;
    function closeP(){ if(paragraph.length){result.push('<p>'+paragraph.map(I).join(' ')+'</p>');paragraph=[];} }
    function closeL(){if(inList){result.push('</ul>');inList=false;}}
    rows.forEach(raw=>{let line=raw.trim();
      if(!line){closeP();closeL();return;}
      if(line.startsWith('## ')){closeP();closeL();result.push('<h3>'+I(line.slice(3))+'</h3>');return;}
      if(line.startsWith('### ')){closeP();closeL();result.push('<h4>'+I(line.slice(4))+'</h4>');return;}
      if(line.startsWith(':: ')){closeP();closeL();result.push('<div class="formula"><span class="formula-marker">∴</span><span>'+I(line.slice(3))+'</span></div>');return;}
      if(line.startsWith('- ')){closeP();if(!inList){result.push('<ul>');inList=true;}result.push('<li>'+I(line.slice(2))+'</li>');return;}
      closeL();paragraph.push(line);
    });closeP();closeL();return result.join('');
  }
  function pad(n){return String(Math.max(0,Math.floor(n))).padStart(2,'0');}
  function formatClock(secs){secs=Math.max(0,Math.ceil(secs));return `${pad(secs/3600)}:${pad((secs%3600)/60)}:${pad(secs%60)}`;}
  function remaining(state){ if(!state)return 0; if(state.phase==='running' && state.ends_at){return Math.max(0,state.ends_at-(Date.now()/1000+(window.R3.timeOffset||0)));}return state.phase==='finished'?0:state.remaining; }
  let toastHandle;
  function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(toastHandle);toastHandle=setTimeout(()=>el.classList.remove('show'),3500);}
  window.R3={E,I,renderText,formatClock,remaining,toast,timeOffset:0};
})();
