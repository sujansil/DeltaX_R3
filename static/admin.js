(function(){
  'use strict';
  const {E,renderText,formatClock,remaining,toast}=window.R3;
  const $=id=>document.getElementById(id);
  let csrf='', info=null, editorTrack='A', dirty=false, activeSection='control', busy=false;
  const phaseNames={preview:'Awaiting the vote.',locked:'The decision is locked.',running:'The clock is running.',paused:'Time is on hold.',finished:'The round is complete.'};
  const phaseExplanations={preview:'Both mathematical paths are currently on the public screen.',locked:'One question is now visible. The timer has not yet started.',running:'The selected problem and live countdown are on the public screen.',paused:'The remaining time is frozen for every viewer.',finished:'Time is up. The selected challenge remains visible.'};
  async function api(path,options={}){
    const method=options.method||'GET';
    const headers={};
    if(method!=='GET')headers['X-CSRF-Token']=csrf;
    if(options.body!==undefined && !(options.body instanceof FormData)){headers['Content-Type']='application/json'; options.body=JSON.stringify(options.body);}
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
    let res;try{res=await fetch(path,{...options,method,headers:{...headers,...options.headers},credentials:'same-origin',cache:'no-store',signal:controller.signal});}finally{clearTimeout(timeout);}
    let data={};try{data=await res.json();}catch{}
    if(!res.ok){
      if(res.status===401){showLogin();}
      let detail=data.detail;
      if(Array.isArray(detail))detail=detail.map(x=>x.msg).join('; ');
      throw Error(typeof detail==='string'?detail:`Request failed (${res.status})`);
    }
    return data;
  }
  function showLogin(){$('loginView').classList.remove('hidden');$('adminApp').classList.add('hidden');csrf='';}
  function showApp(){$('loginView').classList.add('hidden');$('adminApp').classList.remove('hidden');}
  function notify(text,type='success'){
    const n=$('adminNotice');n.textContent=text;n.className=`admin-notice ${type}`;
    setTimeout(()=>{n.classList.add('hidden');},4200);
  }
  async function checkSession(){
    try{let s=await api('/api/admin/session');csrf=s.csrf;showApp();await refresh(true);}
    catch{showLogin();}
  }
  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget;let btn=form.querySelector('button[type=submit]');btn.disabled=true;
    $('loginError').textContent='';
    try{let s=await api('/api/admin/login',{method:'POST',body:{username:$('username').value,password:$('password').value}});
      csrf=s.csrf;$('password').value='';showApp();await refresh(true);
    }catch(err){$('loginError').textContent=err.message;}
    finally{btn.disabled=false;}
  });
  $('logoutBtn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{}showLogin();});
  function setSection(section){
    if(section!==activeSection && dirty && !confirm('Discard unsaved question edits?'))return;
    activeSection=section;
    document.querySelectorAll('.side-link').forEach(x=>x.classList.toggle('active',x.dataset.section===section));
    document.querySelectorAll('.admin-section').forEach(x=>x.classList.toggle('active',x.id===`section-${section}`));
    $('adminSectionTitle').textContent={control:'The control room.',questions:'The question studio.',resources:'The resource desk.'}[section];
    if(section==='questions'){fillEditor();} if(section==='resources'&&info)renderResources();
  }
  document.querySelectorAll('.side-link').forEach(x=>x.addEventListener('click',()=>setSection(x.dataset.section)));
  function updateClock(){
    if(!info)return;
    const s=info.state;
    $('adminClock').textContent=formatClock(remaining(s));
    const phase=s.phase==='running'&&remaining(s)===0?'finished':s.phase;
    $('adminClockState').textContent=phase.toUpperCase();
  }
  function paintControls(){
    if(!info)return;const s=info.state,phase=s.phase==='running'&&remaining(s)===0?'finished':s.phase;
    $('phaseDisplay').textContent=phaseNames[phase];
    $('phaseExplainer').textContent=phaseExplanations[phase];
    $('adminStatusLabel').textContent=phase.replaceAll('_',' ').toUpperCase();
    const revealed=Boolean(s.audience_revealed);
    $('audienceGate').classList.toggle('is-sealed',!revealed);
    $('audienceGate').classList.toggle('is-live',revealed);
    $('gateTitle').textContent=revealed?'AUDIENCE VIEW IS LIVE':'AUDIENCE VIEW IS SEALED';
    $('gateDescription').textContent=revealed
      ? 'The public website can show the published questions and resources. Seal it instantly to block further access.'
      : 'The public site is pitch black. Questions, diagrams and resources are blocked until you reveal them.';
    $('gateToggle').disabled=false;
    $('gateToggle').textContent=revealed?'SEAL SITE NOW ⬛':'REVEAL PUBLIC WEBSITE ↗';
    $('lastSync').textContent=`STATE: ${phase.toUpperCase()} · REV ${s.revision}`;
    $('adminChoices').innerHTML=['A','B'].map(track=>{let q=info.questions[track],selected=s.selected===track;
      return `<div class="choice-row ${selected?'selected-choice':''}"><span class="choice-letter">${track}</span><div><strong>${E(q.title)}</strong><span>${E(q.subtitle)}</span></div><button type="button" data-choice="${track}" ${!['preview','locked'].includes(phase)?'disabled':''}>${selected?'SELECTED ✓':'SELECT ↗'}</button></div>`;}).join('');
    $('adminChoices').querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',async()=>{
      const track=button.dataset.choice;
      if(s.selected===track)return;
      if(!confirm(`Show only Project Helios ${track==='A'?'I':'II'} to everyone?\n\nThe other track will disappear from the public screen. The timer will remain stopped.`))return;
      await act('/api/admin/select',{track},`Helios ${track==='A'?'I':'II'} selected.`);
    }));
    $('resetRoundBtn').disabled=phase==='preview';
    $('startBtn').disabled=phase!=='locked';
    $('pauseBtn').disabled=phase!=='running';
    $('resumeBtn').disabled=phase!=='paused';
    $('finishBtn').disabled=!['locked','running','paused'].includes(phase);
    $('resetTimerBtn').disabled=!s.selected;
    $('duration').disabled=phase!=='locked';
    if(phase==='preview'||phase==='locked'){
      if(document.activeElement!==$('duration'))$('duration').value=Math.round(s.duration/60);
    }
    $('auditList').innerHTML=info.audit.length?info.audit.map(log=>`<div class="audit-row"><div><strong>${E(log.action.replaceAll('_',' ').toUpperCase())}</strong><span>${E(log.details)}</span></div><time>${new Date(log.created_at*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):'<p class="muted">No actions yet.</p>';
    updateClock();
  }
  async function act(path,body,success){
    if(busy)return;busy=true;
    try{await api(path,{method:'POST',body});await refresh(false);notify(success);}catch(e){notify(e.message,'error');}
    finally{busy=false;}
  }
  $('gateToggle').addEventListener('click',async()=>{
    if(!info || busy)return;
    const revealed=Boolean(info.state.audience_revealed);
    if(!revealed){
      // Deliberate friction: accidentally publishing questions is irreversible.
      const word=prompt('WARNING: This reveals the ACTUAL competition questions, diagrams and published resources to anyone with the public link.\n\nType REVEAL to open the audience website:');
      if(word!=='REVEAL'){notify('Reveal cancelled. The website remains sealed.');return;}
    }
    busy=true;$('gateToggle').disabled=true;
    try{
      await api('/api/admin/visibility',{method:'POST',body:{revealed:!revealed}});
      await refresh(false);
      notify(revealed?'Public website sealed. Questions and resources are blocked.':'Public website revealed. Audience can now read the challenges.');
    }catch(e){notify(e.message,'error');}
    finally{busy=false;$('gateToggle').disabled=false;}
  });
  $('startBtn').addEventListener('click',()=>{
    const duration=Number($('duration').value);
    if(!Number.isInteger(duration)||duration<1||duration>240){notify('Set a duration between 1 and 240 minutes.','error');return;}
    if(!confirm(`Start the live ${duration}-minute finale countdown now?`))return;
    act('/api/admin/timer',{action:'start',duration_minutes:duration},'The finale clock is live.');
  });
  $('pauseBtn').addEventListener('click',()=>act('/api/admin/timer',{action:'pause'},'Timer paused for every viewer.'));
  $('resumeBtn').addEventListener('click',()=>act('/api/admin/timer',{action:'resume'},'Timer resumed.'));
  $('finishBtn').addEventListener('click',()=>{if(confirm('End the finale immediately? The public display will show time expired.'))act('/api/admin/timer',{action:'finish'},'Round ended.');});
  $('resetTimerBtn').addEventListener('click',()=>{if(confirm('Reset the clock? This discards the current countdown, but keeps the selected track.'))act('/api/admin/timer',{action:'reset_timer'},'Timer reset.');});
  $('resetRoundBtn').addEventListener('click',()=>{if(confirm('Return to the initial TWO-question screen?\nThis clears the selection and resets the timer.'))act('/api/admin/timer',{action:'reset_round'},'Two-question preview restored.');});
  async function refresh(resetEditor=false){
    if(!csrf)return;
    try{let next=await api('/api/admin/state');window.R3.timeOffset=next.state.server_now-Date.now()/1000;info=next;paintControls();renderResources();
      if(resetEditor){fillEditor();}
    }catch(e){notify(`Unable to refresh: ${e.message}`,'error');}
  }
  function fillEditor(){
    if(!info)return;
    let isShared=editorTrack==='shared';
    document.querySelectorAll('.editor-tab').forEach(x=>x.classList.toggle('active',x.dataset.track===editorTrack));
    $('regularFields').classList.toggle('hidden',isShared);
    $('qContent').previousElementSibling?.classList?.toggle('nothing',false);
    if(isShared){$('qContent').value=info.state.shared;}
    else{const q=info.questions[editorTrack];$('qTitle').value=q.title;$('qSubtitle').value=q.subtitle;$('qBlurb').value=q.blurb;$('qContent').value=q.content;}
    dirty=false;
  }
  document.querySelectorAll('.editor-tab').forEach(btn=>btn.addEventListener('click',()=>{
    if(dirty&&!confirm('Discard unsaved edits and switch document?'))return;
    editorTrack=btn.dataset.track;fillEditor();
  }));
  $('questionForm').addEventListener('input',()=>{dirty=true;});
  $('questionForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const shared=editorTrack==='shared';
    const url=shared?'/api/admin/shared':`/api/admin/questions/${editorTrack}`;
    const body=shared?{shared:$('qContent').value}:{title:$('qTitle').value,subtitle:$('qSubtitle').value,blurb:$('qBlurb').value,content:$('qContent').value};
    try{await api(url,{method:'PUT',body});dirty=false;await refresh(true);notify('Content saved. The public display will update automatically.');}
    catch(err){notify(err.message,'error');}
  });
  $('previewQuestionBtn').addEventListener('click',()=>{
    $('previewBody').innerHTML=renderText($('qContent').value);
    $('previewDialog').showModal();
  });
  $('closePreview').addEventListener('click',()=>$('previewDialog').close());
  function renderResources(){
    if(!info)return;
    $('resourceTotal').textContent=`${String(info.resources.length).padStart(2,'0')} ITEMS`;
    $('adminResourceList').innerHTML=info.resources.length?info.resources.map(r=>{
      const url=r.kind==='file'?`/api/resources/${r.id}/download`:r.url;
      return `<div class="admin-resource-row"><div class="resource-file-symbol">${r.kind==='file'?'▤':'↗'}</div><div class="resource-row-details"><strong>${E(r.title)}</strong><span>${E(r.description||r.filename||url||'')}</span><a href="${E(url)}" target="_blank" rel="noopener noreferrer">OPEN ${r.kind==='file'?'FILE':'LINK'} ↗</a></div><div class="resource-row-actions"><button type="button" class="visibility-button ${r.visible?'published':''}" data-visibility="${r.id}" data-now="${r.visible?'1':'0'}">${r.visible?'PUBLIC':'HIDDEN'}</button><button type="button" class="remove-button" data-delete="${r.id}" title="Delete resource">×</button></div></div>`;
    }).join(''):'<p class="muted resource-none">No resources added yet. Your audience will see the empty state.</p>';
    document.querySelectorAll('[data-visibility]').forEach(btn=>btn.addEventListener('click',async()=>{
      const visible=btn.dataset.now!=='1';try{await api(`/api/admin/resources/${btn.dataset.visibility}`,{method:'PATCH',body:{visible}});await refresh();notify(visible?'Resource published.':'Resource hidden from audience.');}catch(e){notify(e.message,'error');}
    }));
    document.querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('Permanently delete this resource?'))return;
      try{await api(`/api/admin/resources/${btn.dataset.delete}`,{method:'DELETE'});await refresh();notify('Resource deleted.');}catch(e){notify(e.message,'error');}
    }));
  }
  $('linkForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.target;const d=new FormData(f);
    try{await api('/api/admin/resources',{method:'POST',body:{title:d.get('title'),url:d.get('url'),description:d.get('description'),visible:d.has('visible')}});f.reset();await refresh();notify('Link added to resources.');}
    catch(err){notify(err.message,'error');}
  });
  $('uploadForm').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.target;const d=new FormData(f);
    const file=d.get('file');if(!file||!file.size){notify('Choose a file first.','error');return;}
    const params=new URLSearchParams({title:d.get('title'),description:d.get('description'),visible:String(d.has('visible'))});
    const upload=new FormData();upload.append('file',file);
    try{await api('/api/admin/resources/upload?'+params,{method:'POST',body:upload});f.reset();await refresh();notify('File uploaded.');}
    catch(err){notify(err.message,'error');}
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&activeSection==='questions'){
      e.preventDefault();$('questionForm').requestSubmit();
    }
  });
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  setInterval(()=>{if(csrf)refresh(false);},4000);
  setInterval(updateClock,250);
  checkSession();
})();
