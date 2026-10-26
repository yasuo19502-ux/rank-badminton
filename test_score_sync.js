import assert from 'node:assert/strict';import {ScoreSync,compareScoreVersions} from './src/js/score-sync.js';
const tick=()=>new Promise(r=>setTimeout(r,0));const op=id=>({requestId:id,action:'delta',values:{team:'team1',delta:1}});const record=(id,n,time)=>({id,match_id:'match_'+id,score1:n,score2:0,updated_at:'2026-10-26T12:00:'+String(time).padStart(2,'0')+'.000Z'});
let passed=0;async function test(name,run){await run();process.stdout.write('PASS '+name+'\n');passed++;}
await test('Sequential point requests run independently on two courts; flush waits for its court only',async()=>{
 const sends=[],applied=[];const q=new ScoreSync({send:(...args)=>new Promise((resolve,reject)=>sends.push({args,resolve,reject})),onRecord:(id,r)=>applied.push([id,r.score1])});
 q.enqueue('a','match_a',op('a1'));q.enqueue('a','match_a',op('a2'));q.enqueue('b','match_b',op('b1'));assert.equal(sends.length,2);
 let flushed=false;const done=q.flush('a').then(()=>flushed=true);sends[0].resolve(record('a',1,1));await tick();assert.equal(sends[2].args[2].requestId,'a2');assert.equal(flushed,false);
 sends[2].resolve(record('a',2,2));await done;assert.deepEqual(applied,[['a',2]]);assert.equal(q.hasPending('b'),true);sends[1].resolve(record('b',1,3));await q.flush('b');
});
await test('Buffer newest realtime record during local taps and never apply a stale acknowledgement',async()=>{
 let resolve,last;const q=new ScoreSync({send:()=>new Promise(r=>resolve=r),onRecord:(_,r)=>last=r});q.enqueue('a','match_a',op('a1'));
 assert.equal(q.observe('a',record('a',4,4)),true);q.observe('a',record('a',2,2));assert.equal(last,undefined);resolve(record('a',1,1));await q.flush('a');assert.equal(last.score1,4);
});
await test('Unknown response pauses later operations; retry sends the identical operation ID and payload',async()=>{
 const sends=[],errors=[];const q=new ScoreSync({send:(...args)=>new Promise((resolve,reject)=>sends.push({args,resolve,reject})),onError:(_,e)=>errors.push(e)});q.enqueue('a','match_a',op('stable_1'));q.enqueue('a','match_a',op('stable_2'));
 const flush=q.flush('a');sends[0].reject(new Error('network'));await assert.rejects(flush,/network/);assert.equal(sends.length,1);assert.equal(q.status('a').pending,2);assert.equal(errors.length,1);
 q.retry('a');assert.deepEqual(sends[1].args,sends[0].args);sends[1].resolve(record('a',1,1));await tick();assert.equal(sends[2].args[2].requestId,'stable_2');sends[2].resolve(record('a',2,2));await q.flush('a');assert.equal(q.hasPending('a'),false);
});
await test('Changed match cancels old requests and late replies cannot overwrite the new match',async()=>{
 let resolve;const applied=[],errors=[];const q=new ScoreSync({send:()=>new Promise(r=>resolve=r),onRecord:r=>applied.push(r),onError:(_,e)=>errors.push(e)});q.enqueue('a','match_a',op('old'));
 const flush=q.flush('a');assert.equal(q.observe('a',{...record('a',0,3),match_id:'new_match'}),false);await assert.rejects(flush,/thay đổi/);resolve(record('a',1,1));await tick();assert.equal(applied.length,0);assert.equal(q.hasPending('a'),false);assert.equal(errors[0].cancelled,true);
});
await test('Definitive rejection stays visible and cannot be mistaken for a saved score',async()=>{
 const error=Object.assign(new Error('conflict'),{definite:true});const q=new ScoreSync({send:async()=>{throw error;}});q.enqueue('a','match_a',op('a1'));await assert.rejects(q.flush('a'),/conflict/);assert.equal(q.status('a').error.definite,true);assert.equal(q.hasPending('a'),true);q.cancel('a');assert.equal(q.hasPending('a'),false);
});
await test('Version ordering preserves PostgreSQL sub-millisecond precision',async()=>{
 assert.ok(compareScoreVersions('2026-10-26T12:00:00.123456+00:00','2026-10-26T12:00:00.123455Z')>0);assert.ok(compareScoreVersions('2026-10-26T12:00:00.123+00:00','2026-10-26T12:00:00.124Z')<0);
});
process.stdout.write(`${passed} score synchronization tests passed.\n`);
