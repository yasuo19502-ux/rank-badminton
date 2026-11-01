// No network or production data: browser HTML and service stubs only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createHtmlSanitizer,installSafeHtml,escapeHtml,safeImageUrl} from './src/js/html.js';
const dom=new JSDOM('<!doctype html><div id="test"></div>',{url:'https://test.invalid/'});
globalThis.localStorage=dom.window.localStorage;globalThis.crypto??=webcrypto;
const {supabaseService:cloud}=await import('./src/js/supabase.js');const {StorageService:store,getLocalDateStr}=await import('./src/js/storage.js');
let passed=0;async function test(name,run){localStorage.clear();cloud.client=null;cloud.walletVersion=3;await run();console.log('PASS '+name);passed++;}
await test('HTML retains approved app actions but removes executable member content',async()=>{
 installSafeHtml(dom.window);const el=dom.window.document.querySelector('#test');
 el.safeInnerHTML=`<button onclick="window.appEquipFrame('')">OK</button><img src=x onerror="alert(1)"><script>alert(1)</script><button onclick="window.appEquipFrame('x');alert(1)">bad</button><span>${escapeHtml('<img src=x onerror=alert(1)>')}</span>`;
 assert.equal(el.querySelector('button').getAttribute('onclick'),"window.appEquipFrame('')");assert.equal(el.querySelectorAll('[onerror],script').length,0);assert.equal(el.querySelectorAll('[onclick]').length,1);assert.ok(el.textContent.includes('<img'));
 assert.equal(safeImageUrl('javascript:alert(1)'),'');assert.equal(safeImageUrl('https://example.com/a.png'),'https://example.com/a.png');
});
await test('Every rendered action belongs to the sanitizer allowlist',async()=>{
 const src=fs.readFileSync('src/js/app.js','utf8'),san=fs.readFileSync('src/js/html.js','utf8');
 for(const [,action] of src.matchAll(/onclick="(?:event\.stopPropagation\(\);\s*)?window\.(app\w+)\(/g))assert.ok(san.includes("'"+action+"'"),action);
});
await test('Pagination loads all 405 rows instead of truncating wallet history',async()=>{
 const all=Array.from({length:405},(_,id)=>({id}));cloud.client={from(){return{select(){return this;},order(){return this;},async range(a,b){return{data:all.slice(a,b+1),error:null};}};}};assert.equal((await cloud.fetchAll('coin_transactions')).length,405);
});
await test('A lost point response retries the same operation ID',async()=>{
 let n=0,args=[];cloud.client={rpc:async(name,a)=>{args.push(a);return ++n===1?{error:{message:'network'}}:{data:{score1:1,score2:0}};}};
 const result=await cloud.score('court_1','match_zs_test','delta',{team:'team1',delta:1},'score_client_test');assert.equal(result.score1,1);assert.equal(args.length,2);assert.deepEqual(args[0],args[1]);
});
await test('Registration preserves retry ID after network loss and never caches raw PIN',async()=>{
 const calls=[];cloud.client={rpc:async(name,args)=>{calls.push(args);return calls.length===1?{error:{message:'network'}}:{data:{success:true,memberId:'new',token:'token'}};}};
 const payload={name:'Example',pinCode:'9264'};await assert.rejects(cloud.createMember(payload),/network/);assert.ok(!localStorage.getItem('cbb_registration_request').includes('9264'));await cloud.createMember(payload);assert.equal(calls[0].p_payload.requestId,calls[1].p_payload.requestId);assert.equal(localStorage.getItem('cbb_registration_request'),null);
});
await test('Local identity alone does not authenticate a cloud user',async()=>{
 store.saveLocalMembers([{id:'a',name:'A',elo:1000}]);store.setCurrentUser('a');cloud.client={};assert.equal(store.getCurrentUser(),null);
});
await test('New day drops stale guest cache without changing cloud attendance',async()=>{
 store.saveGuests([{id:'guest_old'}]);store.saveLocalAttendance({date:'2000-01-01',presentIds:[],gamesPlayedToday:{}});assert.deepEqual(store.getAttendance().guests,[]);assert.equal(store.getAttendance().date,getLocalDateStr());
});
await test('Export covers wallet, inventory and both courts; cloud import refuses all writes',async()=>{
 const data=JSON.parse(store.exportAllData());for(const key of ['members','matches','sessions','attendance','guests','inventory','bets','coinTransactions','settings','courts'])assert.ok(key in data,key);
 cloud.client={};const before=JSON.stringify({...localStorage});assert.throws(()=>store.importAllData(JSON.stringify(data)),/Không tự ghi đè/);assert.equal(JSON.stringify({...localStorage}),before);
});
await test('Reset clears both courts, guests, bets, inventory and current session locally',async()=>{
 store.saveGuests([{id:'guest_old'}]);store.saveLocalActiveMatch({id:'one'},'court_1');store.saveLocalActiveMatch({id:'two'},'court_2');localStorage.setItem('cbb_club_session_v3','test');store.resetAllData();assert.ok(store.getActiveMatch('court_1').team1.every(p=>!p));assert.ok(store.getActiveMatch('court_2').team2.every(p=>!p));assert.deepEqual(store.getGuests(),[]);assert.equal(localStorage.getItem('cbb_club_session_v3'),null);
});
console.log(`${passed} guarded-client tests passed.`);dom.window.close();
