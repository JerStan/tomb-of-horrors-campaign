/* GameVault Play: no-cost local scene, with persistent journal and optional ChatGPT handoff.
   This is a bounded scene engine, not an AI server. Never accept or store API keys. */
(() => {
 'use strict';
 const $ = id=>document.getElementById(id);
 const chat=$('play-chat'), entry=$('play-input'), status=$('play-status');
 const K='gamevault:play:tomb-of-horrors:v1';
 const memory=()=>window.GameVaultMemory;
 let busy=false;
 function message(role,content){
   const div=document.createElement('article');div.className='play-message '+(role==='Player'?'play-player':'play-dm');
   const heading=document.createElement('strong');heading.textContent=role;
   const p=document.createElement('p');p.textContent=content;
   div.append(heading,p);chat.append(div);chat.scrollTop=chat.scrollHeight;
 }
 const responses=[
   {pattern:/^(?:look|observe|survey|inspect|examine)(?: around| room| surroundings| area)?$/i,
    text:'You stand before the sealed Bronze Eye Door. Twelve bronze symbols form its puzzle face, including skulls, eyes, and three wind emblems. A narrow parchment recess sits beside an enclosed bronze tube and shutter. The passage behind you remains accessible.'},
   {pattern:/door|bronze eye|symbols|wind|inspect the eye/i,
    text:'The twelve symbols include skulls, eyes and three winds. Your recorded sequence is Rising Breath → Silent Breath → Falling Breath. The Silent Breath emblem bears HUSH. The bronze door is still sealed; no opening has been attempted.'},
   {pattern:/parchment|read|writing|recess|tube|shutter/i,
    text:'The parchment and recess appear central to the mechanism. Your recorded inscription reads: “Let the words be heard before the breath is stilled.” The recess connects to Silent Breath through a bronze tube and shutter. Nothing has been inserted.'},
   {pattern:/inventory|bag|items|equipment/i,
    text:'Your inventory includes a short sword, dagger, lantern, two oil flasks, rope, chalk, ten spikes, thieves’ tools, a small mirror, healing draught and ancient parchment. The serpent key remains in the ventilation shaft lock.'},
   {pattern:/back|retreat|return|passage|ledge/i,
    text:'You can retrace your route to the narrow ledge and right-hand passage. The clockwise turn of the iron ring previously restored the ledge and closed the ceiling shutters. No new section is revealed.'},
   {pattern:/mirror|reflect/i,
    text:'You recall that Skull, Eye and Wind markings were visible only with the mirror. The clue is preserved, but examining the reflection now does not establish a new solution.'},
   {pattern:/press|turn|touch|insert|place|speak|say|whisper|shout|open|unlock|activate|use|move/i,
    text:'You prepare to act on the sealed mechanism. The established record does not specify the outcome of this action, so local play will not invent a successful opening or a trap. Continue this action with the ChatGPT Dungeon Master using the handoff below.'}
 ];
 function answer(action){
   const trimmed=action.trim();
   if(!trimmed)return;
   if(busy)return;busy=true;
   message('Player',trimmed);
   const match=responses.find(r=>r.pattern.test(trimmed));
   const reply=match?match.text:'You consider that approach at the Bronze Eye Door. The local scene can recall established clues, but new discoveries and complex actions require the ChatGPT Dungeon Master. Use “Continue in ChatGPT” to resolve this move without fabricating campaign events.';
   message('Dungeon Master',reply);
   try{
     const m=memory();
     if(m) m.addTurn(trimmed,reply);
     else{
       const current=JSON.parse(localStorage.getItem(K)||'[]');
       current.push({action:trimmed,reply,at:new Date().toISOString()});
       localStorage.setItem(K,JSON.stringify(current.slice(-80)));
     }
     status.textContent='Turn saved on this device. Use Memory → Upload for cross-device sync.';
   }catch(e){status.textContent='Could not save this turn. Download a memory backup.';}
   entry.value='';busy=false;
 }
 $('play-submit').addEventListener('click',()=>answer(entry.value));
 entry.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();answer(entry.value);}});
 document.querySelectorAll('[data-play-action]').forEach(el=>el.addEventListener('click',()=>answer(el.dataset.playAction)));
 function resumePrompt(){
   const m=memory()?.get();
   const snapshot=m?JSON.stringify({character:m.character,location:m.location,status:m.status,stats:m.stats,inventory:m.inventory,clues:m.clues,journal:m.journal.slice(-24),exploredAreas:m.exploredAreas,objective:m.objective,notes:m.notes,mapPolicy:m.mapPolicy}):'Seraphina Vale is unharmed at the sealed Bronze Eye Door; resume from there without changing explored locations.';
   return 'Act as my solo Tomb of Horrors Dungeon Master. Resume the established GameVault campaign without changing the explored map. Maintain continuity and do not invent previously completed actions. Present the current scene and ask for my next action. After each turn supply a concise structured campaign memory update for GameVault. Current campaign snapshot:\n'+snapshot;
 }
 $('play-copy-prompt').addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(resumePrompt());status.textContent='Resume prompt copied. Open ChatGPT and paste it to continue with AI.';}
   catch(e){$('play-prompt-preview').hidden=false;$('play-prompt-preview').value=resumePrompt();$('play-prompt-preview').select();status.textContent='Select and copy the prompt below, then paste into ChatGPT.';}
 });
 $('play-chatgpt').addEventListener('click',()=>window.open('https://chatgpt.com/','_blank','noopener,noreferrer'));
 function init(){
   if(chat.childElementCount)return;
   message('Dungeon Master','Seraphina Vale stands unharmed before the sealed Bronze Eye Door. Twelve symbols and three wind emblems challenge you. Your map, clues, and journal are preserved in GameVault. What do you examine?');
   status.textContent='Local scene active · No AI API charges · Saves to campaign memory.';
 }
 window.addEventListener('gamevault-memory-ready',()=>{
   // Transfer any play turns logged while memory loaded late.
   let pending=[];try{pending=JSON.parse(localStorage.getItem(K)||'[]');}catch(e){}
   if(pending.length&&memory()){
     pending.forEach(t=>memory().addTurn(t.action,t.reply));
     localStorage.removeItem(K);
   }
   const d=memory()?.get();
   if(d?.journal?.length){
     const recent=d.journal.slice(-16);
     for(let i=0;i<recent.length;i++){
       if(recent[i].startsWith('Player: ')&&recent[i+1]?.startsWith('Dungeon Master: ')){
         message('Player',recent[i].slice(8));
         message('Dungeon Master',recent[i+1].slice(16));
         i++;
       }
     }
   }
 });
 init();
})();