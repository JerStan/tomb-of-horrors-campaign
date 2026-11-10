/* GameVault campaign memory v1 — browser autosave + optional owner-authorized GitHub sync.
   No access tokens are included in published files. */
(() => {
  'use strict';
  const KEY = 'gamevault:tomb-of-horrors-seraphina:v1';
  const TOKEN_KEY = 'gamevault:github-token:session';
  const REPO = 'JerStan/tomb-of-horrors-campaign';
  const FILE = 'campaign-memory.json';
  const url = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE;
  const $ = id => document.getElementById(id);
  const status = (message, error = false) => { const e = $('memory-status'); if(e){e.textContent = message;e.style.color=error?'#ffb1a0':'#d6c39f';} };
  const clean = value => String(value ?? '').trim();
  const ensure = d => ({
    schemaVersion:1,campaignId:'tomb-of-horrors-seraphina',
    campaign:'Tomb of Horrors',character:'Seraphina Vale',
    location:clean(d.location)||'Bronze Eye Door',status:clean(d.status)||'Unharmed',
    stats:d.stats && typeof d.stats==='object' ? d.stats : {},
    inventory:Array.isArray(d.inventory)?d.inventory.map(clean):[],
    clues:Array.isArray(d.clues)?d.clues.map(clean):[],
    journal:Array.isArray(d.journal)?d.journal.map(clean):[],
    exploredAreas:Array.isArray(d.exploredAreas)?d.exploredAreas.map(clean):[],
    objective:clean(d.objective),notes:clean(d.notes),
    mapPolicy:'Append only: never redraw or replace previously explored map areas.',
    updatedAt:clean(d.updatedAt)||new Date().toISOString()
  });
  let data, remoteSha = null, pushing=false, syncTimer=null, dirty=false;
  const token = () => clean(sessionStorage.getItem(TOKEN_KEY));
  const encode = str => {
    const bytes = new TextEncoder().encode(str); let raw='';
    for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(raw);
  };
  const decode = str => {
    const raw=atob(str.replace(/\s/g,'')), bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };
  async function request(method, body){
    const t=token(); if(!t) throw new Error('Connect GitHub sync first.');
    const resp=await fetch(url,{method,headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+t,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const json=await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error((json.message||'GitHub request failed')+' ('+resp.status+')');
    return json;
  }
  function localWrite(){
    data.updatedAt=new Date().toISOString();
    try { localStorage.setItem(KEY,JSON.stringify(data)); }
    catch(e){status('Local save failed. Export a backup now.',true);return;}
    dirty=true;render();status('Saved on this device. '+(token()?'Cloud sync pending.':'Connect GitHub for cross-device sync.'));
    if(token()) {clearTimeout(syncTimer);syncTimer=setTimeout(()=>push(false),1800);}
  }
  const appendItem = (key,value)=>{
    value=clean(value);if(!value)return;
    data[key].push(value);localWrite();
  };
  function renderList(id,items,emptyText){
    const el=$(id);if(!el)return;el.replaceChildren();
    if(!items.length){const p=document.createElement('p');p.className='muted';p.textContent=emptyText;el.append(p);return;}
    const list=document.createElement('ol');
    items.forEach(item=>{const li=document.createElement('li');li.textContent=item;list.append(li);});el.append(list);
  }
  function render(){
    if(!data)return;
    $('memory-location').value=data.location;
    $('memory-condition').value=data.status;
    $('memory-objective').value=data.objective;
    $('memory-notes').value=data.notes;
    $('memory-updated').textContent='Last saved: '+new Date(data.updatedAt).toLocaleString();
    renderList('memory-journal',data.journal,'No journal entries.');
    renderList('memory-clues',data.clues,'No clues logged.');
    renderList('memory-inventory',data.inventory,'No inventory recorded.');
    renderList('memory-areas',data.exploredAreas,'No areas recorded.');
    const header=document.querySelector('#campaign-library header .tag:last-child');
    if(header) header.textContent='Current location: '+data.location;
    const on=$('memory-sync-state');if(on) on.textContent=token()?'GitHub sync connected for this browser session':'Local autosave active · GitHub sync not connected';
  }
  async function pull(force=false){
    if(dirty && !force) {status('Unsynced local changes. Upload or export them before downloading remote memory.',true);return;}
    try{
      status('Reading campaign memory from GitHub…');
      const resp=await fetch(url+'?ref=main&_='+Date.now(),{headers:token()?{'Authorization':'Bearer '+token(),'Accept':'application/vnd.github+json'}:{'Accept':'application/vnd.github+json'},cache:'no-store'});
      if(!resp.ok) throw new Error('GitHub memory read failed ('+resp.status+')');
      const obj=await resp.json();const incoming=ensure(JSON.parse(decode(obj.content)));
      remoteSha=obj.sha;
      // Do not silently overwrite newer local memory.
      if(!force && data && Date.parse(data.updatedAt)>Date.parse(incoming.updatedAt)){
        status('This device has newer memory. Export or upload it before replacing it.',true);return;
      }
      data=incoming;localStorage.setItem(KEY,JSON.stringify(data));dirty=false;render();
      status('Campaign memory loaded from GitHub.');
    }catch(e){status('Download failed: '+e.message,true);}
  }
  async function push(manual=true){
    if(!token()){status('Enter a fine-grained GitHub token with Contents read/write for this repository.',true);return;}
    if(pushing)return;
    pushing=true;clearTimeout(syncTimer);
    try{
      status('Synchronising campaign memory…');
      const remote=await request('GET');
      remoteSha=remote.sha;
      const current=ensure(JSON.parse(decode(remote.content)));
      if(Date.parse(current.updatedAt)>Date.parse(data.updatedAt)){
        status('Newer campaign memory exists on GitHub. Download it or export your local copy first; nothing overwritten.',true);
        return;
      }
      // Preserve immutable exploration history. Local state can append new areas but not remove remote history.
      for(const name of current.exploredAreas){if(!data.exploredAreas.includes(name)) data.exploredAreas.push(name);}
      const snapshot=JSON.stringify(data,null,2)+'\n';
      const updated=await request('PUT',{message:'Update GameVault campaign memory',content:encode(snapshot),sha:remoteSha,branch:'main'});
      remoteSha=updated.content?.sha||null;dirty=false;
      localStorage.setItem(KEY,JSON.stringify(data));render();
      status('Synced to GitHub. Other devices can download the latest memory.');
    }catch(e){status('Sync failed: '+e.message+' — local changes remain saved.',true);}
    finally{pushing=false;}
  }
  function download(){
    const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='gamevault-tomb-of-horrors-memory.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);status('Memory backup downloaded.');
  }
  async function importFile(file){
    if(!file)return;
    try{
      const candidate=JSON.parse(await file.text());
      if(candidate.campaignId!=='tomb-of-horrors-seraphina'||!Array.isArray(candidate.journal))throw new Error('Not a Tomb of Horrors GameVault memory backup.');
      if(!confirm('Replace this device’s campaign memory with the selected backup? Export first if you want to keep the current version.'))return;
      data=ensure(candidate);localWrite();status('Backup imported and saved on this device.');
    }catch(e){status('Import failed: '+e.message,true);}
  }
  function initialize(seed){
    let stored=null;
    try{stored=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){}
    data=ensure(stored?.campaignId==='tomb-of-horrors-seraphina'?stored:seed);
    render();
    status(stored?'Restored saved campaign memory on this device.':'Loaded initial campaign record. Local autosave is enabled.');
    if(token()){ $('memory-token').value=token(); $('memory-sync-state').textContent='GitHub sync connected for this browser session';}
    if(!stored) localStorage.setItem(KEY,JSON.stringify(data));
  }
  $('memory-save').addEventListener('click',()=>{
    data.location=clean($('memory-location').value)||data.location;
    data.status=clean($('memory-condition').value);
    data.objective=clean($('memory-objective').value);
    data.notes=clean($('memory-notes').value);
    localWrite();
  });
  for(const [button,input,key] of [
    ['memory-add-journal','memory-new-journal','journal'],
    ['memory-add-clue','memory-new-clue','clues'],
    ['memory-add-inventory','memory-new-inventory','inventory'],
    ['memory-add-area','memory-new-area','exploredAreas']
  ]){
    $(button).addEventListener('click',()=>{const v=$(input).value;appendItem(key,v);$(input).value='';});
  }
  $('memory-export').addEventListener('click',download);
  $('memory-import-file').addEventListener('change',e=>importFile(e.target.files?.[0]));
  $('memory-connect').addEventListener('click',()=>{
    const val=clean($('memory-token').value);
    if(!val){status('Paste a fine-grained GitHub personal access token first.',true);return;}
    sessionStorage.setItem(TOKEN_KEY,val);
    $('memory-token').value='';
    render();status('GitHub authentication saved for this browser session only. Use Upload to sync.');
  });
  $('memory-disconnect').addEventListener('click',()=>{sessionStorage.removeItem(TOKEN_KEY);$('memory-token').value='';render();status('GitHub disconnected. Local autosave remains active.');});
  $('memory-pull').addEventListener('click',()=>pull(false));
  $('memory-push').addEventListener('click',()=>push(true));
  fetch('campaign-memory.json?fresh='+Date.now(),{cache:'no-store'})
    .then(r=>{if(!r.ok)throw Error('No published memory seed');return r.json();})
    .then(initialize)
    .catch(()=>initialize({campaignId:'tomb-of-horrors-seraphina',location:'Bronze Eye Door',journal:[],clues:[],inventory:[],exploredAreas:[],notes:'',objective:''}));
})();
