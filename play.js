/* GameVault Codex gameplay client.
   The permanent Codex app-server + authoritative SQLite database must run on a secure backend.
   Do not expose Codex, a local port, or API secrets directly to the internet. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const ENDPOINT='gamevault:server-endpoint:v1';
 const ACCESS='gamevault:server-access:session:v1';
 const TURN_HISTORY='gamevault:pending-turns:v1';
 const getAccess=()=>sessionStorage.getItem(ACCESS)||'';
 const backend=()=>($('play-endpoint').value||'').trim().replace(/\/+$/,'');
 const setStatus=(t,bad=false)=>{const el=$('play-status');el.textContent=t;el.style.color=bad?'#ffb2a4':'#d9c69e';};
 const log=(role,content)=>{
   const d=document.createElement('div');d.className='play-message '+(role==='You'?'play-player':'play-dm');
   const title=document.createElement('strong');title.textContent=role;
   const p=document.createElement('p');p.textContent=String(content||'');
   d.append(title,p);$('play-transcript').append(d);$('play-transcript').scrollTop=$('play-transcript').scrollHeight;
 };
 let busy=false;
 async function call(action,payload={}){
   const url=backend();
   if(!/^https:\/\/[^/?#]+/i.test(url))throw Error('Enter the secure HTTPS GameVault gateway address first.');
   const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),90000);
   try{
     const r=await fetch(url+action,{
       method:'POST',headers:{'Content-Type':'application/json',...(getAccess()?{'Authorization':'Bearer '+getAccess()}:{})},
       body:JSON.stringify(payload),signal:ac.signal,cache:'no-store'});
     const body=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(body.error||body.message||'Server returned '+r.status);
     return body;
   }finally{clearTimeout(timer);}
 }
 const saveConfig=()=>{
   const url=backend();
   if(!/^https:\/\/[^/?#]+/i.test(url)){setStatus('A secure HTTPS server address is required. No Tailscale or temporary tunnel link.',true);return;}
   localStorage.setItem(ENDPOINT,url);
   const access=$('play-access').value.trim();
   if(access){sessionStorage.setItem(ACCESS,access);$('play-access').value='';}
   setStatus('Gateway settings saved in this browser. Use Test connection.');
 };
 const applyState=s=>{
   if(!s||typeof s!=='object')return;
   const m=window.GameVaultMemory;
   if(!m)return;
   const old=m.get();
   if(s.location&&s.location!==old.location)m.setLocation(s.location);
   if(s.objective&&s.objective!==old.objective)m.setObjective(s.objective);
   if(Array.isArray(s.newClues))s.newClues.forEach(x=>m.addClue(x));
   // The server remains authoritative. Mirror individual fields for visibility, never overwrite maps.
 };
 $('play-config').addEventListener('click',saveConfig);
 $('play-test').addEventListener('click',async()=>{
   if(busy)return;busy=true;setStatus('Checking persistent game server…');
   try{
     const result=await call('/v1/game/status',{campaignId:'tomb-of-horrors-seraphina'});
     $('play-server-state').textContent='Server: '+String(result.status||'connected')+' · Session: '+String(result.session||'unknown')+' · Save: '+String(result.saveBackend||'not reported');
     if(result.saveBackend!=='sqlite')setStatus('Connected, but the server has not confirmed SQLite authoritative saves.',true);
     else if(!result.persistentSession)setStatus('Connected, but persistent Codex session not confirmed.',true);
     else setStatus('Persistent Codex session and SQLite save confirmed.');
   }catch(e){setStatus('Connection not ready: '+e.message,true);}
   finally{busy=false;}
 });
 async function submit(){
   const action=$('play-input').value.trim();if(!action||busy)return;
   busy=true;$('play-send').disabled=true;setStatus('Sending action to persistent Codex game session…');
   try{
     // Reuse the same ID when retrying an unconfirmed action: prevents duplicate turns.
     let pending=null;
     try{pending=JSON.parse(localStorage.getItem(TURN_HISTORY)||'null');}catch(e){}
     if(!pending||pending.action!==action){
       pending={action,clientTurnId:crypto.randomUUID()};
       localStorage.setItem(TURN_HISTORY,JSON.stringify(pending));
     }
     const result=await call('/v1/game/turn',{campaignId:'tomb-of-horrors-seraphina',...pending});
     localStorage.removeItem(TURN_HISTORY);
     if(typeof result.response!=='string'||!result.response.trim())throw Error('Server returned no Dungeon Master response.');
     log('You',action);log('Dungeon Master',result.response);
     if(result.state)applyState(result.state);
     if(window.GameVaultMemory)window.GameVaultMemory.addTurn(action,result.response);
     $('play-input').value='';
     setStatus('Turn received. SQLite server is authoritative; the local journal is a convenient mirror.');
   }catch(e){
     setStatus('Action was not confirmed or saved by the server: '+e.message+'. Check the server before retrying to avoid duplicate actions.',true);
   }finally{busy=false;$('play-send').disabled=false;}
 }
 $('play-send').addEventListener('click',submit);
 $('play-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}});
 const saved=localStorage.getItem(ENDPOINT);
 if(saved)$('play-endpoint').value=saved;
 $('play-server-state').textContent='Server: not verified';
 setStatus('Gameplay requires the persistent Codex backend. Configure the secure gateway to begin. The public page cannot run Codex or SQLite itself.');
 log('GameVault','The game is paused at the Bronze Eye Door. Connect the persistent Codex game server to play here. Maps, pictures and memory remain accessible.');
})();