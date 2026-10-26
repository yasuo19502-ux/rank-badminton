// Disposable browser + deferred cloud responses. Never connects to the club database.
import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';import {JSDOM,VirtualConsole} from 'jsdom';import {webcrypto} from 'node:crypto';
const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};Object.defineProperty(w,'crypto',{value:webcrypto});w.prompt=()=>{throw new Error('A score tap must not open a blocking prompt');};
const src=fs.readFileSync('src/js/app.js','utf8')+'\nwindow.__scoreHarness={cloud:supabaseService,state,bootCloud:initCloudSyncAndRealtime,loadInitialState,scoreSync,finishMatch};';
const bundle=await build({stdin:{contents:src,resolveDir:process.cwd()+'/src/js',sourcefile:'app.js'},bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env':'{}'}});
const tick=()=>new Promise(r=>setTimeout(r,0));
try{
 w.eval(bundle.outputFiles[0].text);w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 const {cloud,state,bootCloud,loadInitialState}=w.__scoreHarness;const s=w.StorageService;
 const people=['a','b','c','d'].map(id=>({id,name:id,elo:1000,matchesPlayed:30,gender:'male',coins:100}));s.saveLocalMembers(people);s.setCurrentUser('a');
 const live={matchId:'match_zs_responsive',courtNumber:'Sân 1',team1:people.slice(0,2),team2:people.slice(2),score1:0,score2:0,status:'ready',matchStatus:'ready'};s.saveLocalActiveMatch(live,'court_1');loadInitialState();w.appSwitchTab('court');
 cloud.client={};cloud.getSessionToken=()=> 'test-token';s.syncFromCloud=async()=>true;let realtime;cloud.subscribeToChanges=fn=>{realtime=fn;};await bootCloud();
 let memberReads=0;const getMembers=s.getMembers.bind(s);s.getMembers=()=>{memberReads++;return getMembers();};
 const originalCard=w.document.getElementById('team1-players-grid').firstElementChild;
 const calls=[];cloud.score=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));
 const record=(s1,s2,time)=>({id:'court_1',match_id:live.matchId,court_number:'Sân 1',team1:['a','b'],team2:['c','d'],score1:s1,score2:s2,status:'in_progress',updated_at:`2026-10-26T12:00:${String(time).padStart(2,'0')}.000Z`});
 w.document.getElementById('btn-t1-plus').click();w.document.getElementById('btn-t1-plus').click();assert.equal(memberReads,0,'The immediate tap path must not parse all member avatars');assert.equal(w.document.getElementById('score-team1-val').textContent,'2');await tick();
 await realtime('live_court',{new:record(1,0,1)});
 assert.equal(w.document.getElementById('score-team1-val').textContent,'2','An earlier realtime echo must not roll back a later local tap');
 calls[0].resolve(record(1,0,1));await tick();calls[1].resolve(record(2,0,2));await tick();
 assert.equal(w.document.getElementById('score-team1-val').textContent,'2');
 assert.strictEqual(w.document.getElementById('team1-players-grid').firstElementChild,originalCard,'Score acknowledgements must keep player DOM stable');
 // Even unavailable audio and a lost response must not block the visible point.
 w.AudioContext=class{constructor(){throw new Error('audio unavailable');}};
 w.document.getElementById('score-team1-val').click();assert.equal(w.document.getElementById('score-team1-val').textContent,'3');await tick();
 calls[2].reject(new Error('network'));await tick();assert.equal(w.document.getElementById('score-team1-val').textContent,'3');assert.equal(w.document.getElementById('btn-retry-score').hidden,false);
 w.document.getElementById('btn-t1-plus').click();assert.equal(w.document.getElementById('score-team1-val').textContent,'3','Error state must not silently accept unsent taps');
 w.document.getElementById('btn-retry-score').click();assert.deepEqual(calls[3].args,calls[2].args,'Retry retains exactly the same request ID');calls[3].resolve(record(3,0,3));await tick();
 // Burst input is visible before any of its deferred cloud responses.
 const start=performance.now();for(let n=0;n<10;n++)w.document.getElementById('btn-t1-plus').click();
 assert.equal(w.document.getElementById('score-team1-val').textContent,'13');const burstMs=performance.now()-start;
 await realtime('live_court',{new:record(4,0,4)});assert.equal(w.document.getElementById('score-team1-val').textContent,'13');
 for(let n=4;n<=13;n++){await tick();assert.equal(calls[n].args[2],'delta');calls[n].resolve(record(n,0,n));}await w.__scoreHarness.scoreSync.flush('court_1');
 assert.strictEqual(w.document.getElementById('team1-players-grid').firstElementChild,originalCard);
 cloud.fetchMembers=async()=>s.getMembers();await realtime('members',{});assert.strictEqual(w.document.getElementById('team1-players-grid').firstElementChild,originalCard,'Unchanged member polls must not rebuild the court');
 // Explicit editing remains available, without intercepting the normal tap surface.
 w.document.getElementById('btn-manual-score').click();assert.ok(w.document.getElementById('modal-manual-score').classList.contains('open'));
 w.document.getElementById('manual-score-1').value='14';w.document.getElementById('manual-score-2').value='2';
 w.document.getElementById('form-manual-score').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(calls[14].args[2],'set');assert.deepEqual(JSON.parse(JSON.stringify(calls[14].args[3])),{expected1:13,expected2:0,score1:14,score2:2});calls[14].resolve(record(14,2,14));await w.__scoreHarness.scoreSync.flush('court_1');
 // Finishing waits for the final tap and freezes additional taps while closing.
 let posted=null;cloud.checkWalletVersion=async()=>3;cloud.insertMatch=async m=>{posted=m;return true;};
 s.syncFromCloud=async()=>{if(posted)s.saveLocalActiveMatch(null,'court_1');return true;};
 w.document.getElementById('btn-t2-plus').click();await tick();const finishing=w.__scoreHarness.finishMatch();await tick();assert.equal(posted,null);
 w.document.getElementById('btn-t1-plus').click();assert.equal(w.document.getElementById('score-team1-val').textContent,'14');
 calls[15].resolve(record(14,3,15));await finishing;assert.equal(posted.score1,14);assert.equal(posted.score2,3);
 process.stdout.write(`PASS Ten synchronous score taps display before network replies (${burstMs.toFixed(1)} ms in the disposable DOM), retain stable player nodes, retry safely, and finish with the acknowledged score\n`);
 assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
 process.stdout.write('PASS Deferred cloud echo never rolls back rapid score taps\n');
}finally{w.close();}
