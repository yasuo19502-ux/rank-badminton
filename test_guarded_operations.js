// All writes are confined to an in-memory PostgreSQL instance.
import assert from 'node:assert/strict';import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {calculateDoublesElo} from './src/js/elo.js';
const db=new PGlite({extensions:{pgcrypto}});
const old=fs.readFileSync('test_wallet_db.js','utf8').split('await db.exec(`')[1].split('  insert into members(id,phone)')[0];await db.exec(old);
await db.exec(`alter table members add column name text,add column nickname text,add column gender text default 'male',add column frequency text default 'regular',add column avatar text,add column joined_date text,add column updated_at timestamptz default now();
 alter table matches add column is_deuce boolean;
 alter table live_court add column updated_at timestamptz default now();
 create table attendance(date text primary key,present_ids text[],games_played_today jsonb,updated_at timestamptz default now());
 create table sessions(id text primary key,title text,date text,start_time text,end_time text,venue_name text,venue_address text,court_numbers text,fee_note text,rsvps jsonb,updated_at timestamptz default now());
 create table club_settings(id text primary key,club_name text,announcement text,default_venue text,default_address text,k_factor integer);
 grant all on all tables in schema public to anon,authenticated;`);
for(const p of ['20261023_atomic_wallet.sql','20261024_safe_frame_gifts.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+p,'utf8'));
const migration=fs.readFileSync('supabase/migrations/20261024_guarded_operations.sql','utf8');
const q=async(sql,args=[])=>db.query(sql,args);const scalar=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const rpc=async(name,args=[])=>scalar(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
const snapshot=async()=>{const data={};for(const t of ['members','matches','bets','coin_transactions','user_inventory','live_court','attendance','sessions','club_settings'])data[t]=(await q(`select to_jsonb(t) item from ${t} t order by to_jsonb(t)::text`)).rows;return data;};
await db.exec(`insert into members(id,name,elo,matches_played,phone) values('baseline','Baseline',1234,17,'{"coins":347,"pinCode":"2468","activeFrame":"frame_gold","activeEloShield":true}');`);
if(process.env.CLUB_PRESERVATION_BACKUP){
 const tables=JSON.parse(fs.readFileSync(process.env.CLUB_PRESERVATION_BACKUP,'utf8')).tables;
 await db.exec(`alter table members add column created_at timestamptz;alter table matches add column session_id text,add column created_at timestamptz;alter table user_inventory add column created_at timestamptz;alter table attendance add column session_id text;alter table sessions add column created_at timestamptz;alter table club_settings add column updated_at timestamptz;set session_replication_role=replica;`);
 for(const [table,rows] of Object.entries(tables))for(const row of rows)await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,[row]);
 await db.exec('set session_replication_role=origin');
 console.log('Loaded complete private backup into isolated database; no network used.');
}
const baseline=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),baseline);await db.exec(migration);assert.deepEqual(await snapshot(),baseline);
const shieldMigration=fs.readFileSync('supabase/migrations/20261028_per_match_shield.sql','utf8');
const shieldBaseline=await snapshot();await db.exec(shieldMigration);assert.deepEqual(await snapshot(),shieldBaseline);await db.exec(shieldMigration);assert.deepEqual(await snapshot(),shieldBaseline);
let passed=0;const admin='mem_1789569517045';
async function actor(id=admin){const token='test-token-'+id;await q("insert into club_private.sessions values(sha256(convert_to($1,'UTF8')),$2,clock_timestamp()+interval '1 day') on conflict(token_hash) do update set expires_at=excluded.expires_at",[token,id]);await q("select set_config('request.headers',$1,false)",[JSON.stringify({'x-club-session':token})]);}
async function reset(){await db.exec(`reset role;truncate matches,live_court,bets,coin_transactions,user_inventory,club_daily_rewards,attendance,sessions,club_private.operations,members cascade;
 insert into members(id,name,elo,matches_played,wins,losses,phone) select x,x,1000,30,15,15,'{"pinCode":"2468"}' from unnest(array['${admin}','a','b','c','d','x','y']) x;`);await actor();}
async function test(name,run){await reset();await run();passed++;console.log('PASS '+name);}
const payload=(court='court_1',id='match_zs_audit',t1=['a','b'],t2=['c','d'])=>({id:court,match_id:id,team1:t1,team2:t2,score1:0,score2:0,status:'ready',matchmaker_mode:'balanced',diff_elo:0});
const court=async(...args)=>rpc('club_save_court',[payload(...args),null]);
const finish=async(id='match_zs_audit',s1=21,s2=19)=>{const c=(await q('select * from live_court where match_id=$1',[id])).rows[0];if(c)await q('update live_court set score1=$1,score2=$2 where id=$3',[s1,s2,c.id]);return rpc('club_finish_match',[id,s1,s2]);};
try{
console.log('PASS migration preserves every existing record, including rerun');passed++;
await test('Anonymous actor cannot spend another wallet or directly update protected tables',async()=>{
 await q("select set_config('request.headers','{}',false)");await db.exec('set role anon');
 await assert.rejects(rpc('club_buy_item',['purchase_audit_x','x','elo_shield']),/đăng nhập/);
 await assert.rejects(db.exec("update members set elo=2000 where id='x'"),/permission denied/);
 await assert.rejects(db.exec("select phone from members"),/permission denied/);
 const rows=await rpc('club_members_public');assert.equal(rows.length,7);assert.ok(rows.every(m=>!('phone'in m)&&!('pin_code'in m)));await db.exec('reset role');
});
await test('Logged-in member cannot impersonate another member or become admin by name',async()=>{
 await actor('x');await assert.rejects(rpc('club_buy_item',['purchase_audit_x','y','elo_shield']),/không có quyền/);await assert.rejects(rpc('club_delete_member',['a']),/không có quyền/);
});
await test('PIN stays private; login throttles wrong attempts and preserves original PIN',async()=>{
 await q("select set_config('request.headers','{}',false)");const good=await rpc('club_login',['x','2468']);assert.equal(good.success,true);assert.ok(good.token.length>=64);
 for(let i=0;i<5;i++)assert.equal((await rpc('club_login',['y','0000'])).success,false);
 assert.equal((await rpc('club_login',['y','2468'])).success,false);
 assert.equal(await scalar("select phone::jsonb->>'pinCode' from members where id='x'"),'2468');
});
await test('Cosmetic patch preserves Elo/stats/wallet and rejects stale profile or forbidden fields',async()=>{
 await actor('a');await db.exec("update members set elo=1123 where id='a'");const version=await scalar("select updated_at::text from members where id='a'");
 await rpc('club_patch_member',['a',{nickname:'updated'},version]);assert.equal(await scalar("select elo from members where id='a'"),1123);
 await assert.rejects(rpc('club_patch_member',['a',{elo:2000},version]),/Không được/);await assert.rejects(rpc('club_patch_member',['a',{nickname:'stale'},version]),/đã thay đổi/);
});
await test('Removing frame stays removed even after repeated automatic gift calls',async()=>{
 await db.exec("update members set gender='female',phone=jsonb_set(phone::jsonb,'{activeFrame}','\"frame_gold\"')::text where id='a'");await actor('a');
 await rpc('club_patch_member',['a',{activeFrame:''},await scalar("select updated_at::text from members where id='a'")]);await rpc('club_gift_october20');await rpc('club_gift_october20');assert.equal(await scalar("select phone::jsonb->>'activeFrame' from members where id='a'"),'');
});
await test('Different-device point operations preserve both points; retry does not add twice',async()=>{
 await court();await rpc('club_score',['score_audit_1','court_1','match_zs_audit','delta',{team:'team1',delta:1}]);await actor('x');await rpc('club_score',['score_audit_2','court_1','match_zs_audit','delta',{team:'team2',delta:1}]);await rpc('club_score',['score_audit_2','court_1','match_zs_audit','delta',{team:'team2',delta:1}]);assert.deepEqual((await q('select score1,score2 from live_court')).rows[0],{score1:1,score2:1});
 await assert.rejects(rpc('club_score',['score_audit_3','court_1','match_zs_audit','set',{expected1:0,expected2:0,score1:21,score2:15}]),/đã được cập nhật/);
});
await test('Server refuses score overwrite and double-booking across courts',async()=>{
 await court();await assert.rejects(rpc('club_save_court',[{...payload(),score1:10},'match_zs_audit']),/ghi điểm/);await assert.rejects(court('court_2','match_zs_other'),/sân khác/);
});
await test('Draft court with one player is retained on server',async()=>{
 const c=await rpc('club_save_court',[payload('court_1','draft',['a',''],['','']),null]);assert.deepEqual(c.team1,['a','']);assert.equal(c.status,'idle');
});
await test('Server computes Elo and rewards once, rejects unfinished or deuce result',async()=>{
 await court();await assert.rejects(finish(undefined,1,0),/Tỷ số/);await assert.rejects(finish(undefined,21,20),/Tỷ số/);
 const m=await finish();assert.equal(m.elo_change,11);assert.equal(await scalar("select elo from members where id='a'"),1011);assert.equal(await scalar("select elo from members where id='c'"),989);await finish();assert.equal(await scalar("select coins from members where id='a'"),170);
 assert.equal(await scalar("select (games_played_today->>'a')::integer from attendance"),1);
});
await test('Server calculates odds and rejects tampered or stale quote',async()=>{
 await court();await actor('x');await assert.rejects(rpc('club_place_bet',['bet_audit_x','court_1','match_zs_audit','x','team1',10,3]),/Kèo/);await rpc('club_place_bet',['bet_audit_x','court_1','match_zs_audit','x','team1',10,1.9]);await actor();await finish();assert.equal(await scalar("select coins from members where id='x'"),109);
});
await test('Grip claims are atomic, retry-safe, and cannot restore consumed quantity',async()=>{
 await db.exec("insert into user_inventory(id,member_id,item_id,item_type,quantity) values('grip','x','grip','consumable',2)");await actor('x');await rpc('club_claim_grip',['claim_audit_001','x']);await rpc('club_claim_grip',['claim_audit_001','x']);await rpc('club_claim_grip',['claim_audit_002','x']);assert.equal(await scalar("select quantity from user_inventory where id='grip'"),0);await assert.rejects(rpc('club_claim_grip',['claim_audit_003','x']),/không có/);
});
await test('Attendance merges per-person actions without losing another device registration',async()=>{
 await rpc('club_attendance_action',['att_audit_0001','roster',{presentIds:[]}]);await rpc('club_attendance_action',['att_audit_0002','present',{memberId:'a',present:true}]);await actor('x');await rpc('club_attendance_action',['att_audit_0003','present',{memberId:'b',present:true}]);assert.deepEqual((await scalar('select present_ids from attendance')).sort(),['a','b']);
});
await test('RSVP updates only one member and keeps other RSVPs',async()=>{
 await db.exec("insert into sessions(id,title,date,rsvps) values('session1','test','2026-10-24','{}')");await actor('a');await rpc('club_rsvp',['session1','a','attending']);await actor('b');await rpc('club_rsvp',['session1','b','attending']);assert.deepEqual(await scalar("select rsvps from sessions"),{a:'attending',b:'attending'});
});
await test('Guest Elo and attendance counters commit/undo with match, not a later client write',async()=>{
 await rpc('club_attendance_action',['att_audit_guest','guest_add',{guest:{id:'guest_audit',name:'guest',gender:'male',elo:1000}}]);await court('court_1','match_zs_guest',['a','guest_audit'],['c','d']);await finish('match_zs_guest');let g=await scalar("select games_played_today->'_guest_profiles'->0 from attendance");assert.equal(g.elo,1014);assert.equal(g.matchesPlayed,1);await rpc('club_undo_match',['match_zs_guest']);g=await scalar("select games_played_today->'_guest_profiles'->0 from attendance");assert.equal(g.elo,1000);assert.equal(g.matchesPlayed,0);
});
await test('Shield discount matches JS rounding and consumption/reversal is atomic',async()=>{
 await db.exec("insert into user_inventory(id,member_id,item_id,item_type,quantity) values('shield','c','elo_shield','perk',1);update members set phone=jsonb_set(phone::jsonb,'{activeEloShield}','true')::text where id='c'");await court();await finish();assert.equal(await scalar("select elo from members where id='c'"),995);assert.equal(await scalar("select quantity from user_inventory where id='shield'"),0);await rpc('club_undo_match',['match_zs_audit']);assert.equal(await scalar("select elo from members where id='c'"),1000);assert.equal(await scalar("select quantity from user_inventory where id='shield'"),1);
});
await test('Enabled shields consume one per finished match for winners and losers, with safe retry and undo',async()=>{
 await db.exec("insert into user_inventory(id,member_id,item_id,item_type,quantity) values('win_shield','a','elo_shield','perk',2),('loss_shield','c','elo_shield','perk',1);update members set phone=jsonb_set(phone::jsonb,'{activeEloShield}','true')::text where id in('a','c')");
 await court();const result=await finish();
 assert.equal(await scalar("select elo from members where id='a'"),1011);
 assert.equal(await scalar("select elo from members where id='c'"),995);
 assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),1);
 assert.equal(await scalar("select quantity from user_inventory where id='loss_shield'"),0);
 assert.equal(await scalar("select (phone::jsonb->>'activeEloShield')::boolean from members where id='a'"),true);
 assert.equal(await scalar("select (phone::jsonb->>'activeEloShield')::boolean from members where id='c'"),false);
 const audit=await scalar('select club_match_audit($1)',[result.court_number]);
 assert.equal(audit.playerResults.a.shieldUsed,true);assert.equal(audit.playerResults.c.shieldUsed,true);
 await finish();assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),1);
 await court('court_1','match_zs_second_shield');await finish('match_zs_second_shield');
 assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),0);
 assert.equal(await scalar("select (phone::jsonb->>'activeEloShield')::boolean from members where id='a'"),false);
 await rpc('club_undo_match',['match_zs_second_shield']);
 assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),1);
 await rpc('club_undo_match',['match_zs_audit']);
 assert.equal(await scalar("select elo from members where id='a'"),1000);assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),2);assert.equal(await scalar("select quantity from user_inventory where id='loss_shield'"),1);
 await rpc('club_undo_match',['match_zs_audit']);assert.equal(await scalar("select quantity from user_inventory where id='win_shield'"),2);
});
await test('Disabled or empty shields never consume a card or change full Elo',async()=>{
 await db.exec("insert into user_inventory(id,member_id,item_id,item_type,quantity) values('disabled_shield','a','elo_shield','perk',1),('empty_shield','c','elo_shield','perk',0);update members set phone=jsonb_set(phone::jsonb,'{activeEloShield}','true')::text where id='c'");
 await court();await finish();assert.equal(await scalar("select elo from members where id='a'"),1011);assert.equal(await scalar("select elo from members where id='c'"),989);assert.equal(await scalar("select quantity from user_inventory where id='disabled_shield'"),1);assert.equal(await scalar("select quantity from user_inventory where id='empty_shield'"),0);
});
await test('Export includes all operational tables and never exposes PIN or session tokens',async()=>{
 const data=await rpc('club_export_snapshot');for(const k of ['members','matches','sessions','attendance','coinTransactions','bets','inventory','courts','settings'])assert.ok(Array.isArray(data[k]),k);assert.ok(!JSON.stringify(data).includes('pinCode'));assert.ok(!JSON.stringify(data).includes('2468'));await actor('a');await assert.rejects(rpc('club_export_snapshot'),/không có quyền/);
});
await test('Server Elo matches client rules across ratings, experience, margins and both winners',async()=>{
 for(const elo1 of [500,800,1000,1200])for(const elo2 of [500,800,1000,1200])for(const games of [0,15,30])for(const gap of [1,2,6,15])for(const winner of [1,2]){
  const a=[{elo:elo1,matchesPlayed:games},{elo:elo1+13,matchesPlayed:games+1}];const b=[{elo:elo2,matchesPlayed:15},{elo:elo2+27,matchesPlayed:15}];
  const s1=winner===1?30:30-gap,s2=winner===2?30:30-gap;
  assert.equal(await rpc('club_private.elo_delta',[a,b,s1,s2]),calculateDoublesElo(a,b,s1,s2).deltaTeam1||0,JSON.stringify({elo1,elo2,games,gap,winner}));
 }
});
await test('Two-court shuffle commits together, retries once and rolls back invalid lineup',async()=>{
 await db.exec("insert into members(id,name,elo,matches_played,phone) values('z','z',1000,30,'{}')");await court();await court('court_2','old_court_two',['x','y'],[admin,'z']);
 const ps=[payload('court_1','new_court_one',['a','x'],['c','y']),payload('court_2','new_court_two',['b','d'],[admin,'z'])];const expected={court_1:'match_zs_audit',court_2:'old_court_two'};
 const before=await snapshot();await assert.rejects(rpc('club_save_courts',['shuffle_invalid_1',[ps[0],{...ps[1],team2:[admin,'missing']}],expected]),/thành viên|người chơi|vận động viên/i);assert.deepEqual(await snapshot(),before);
 const result=await rpc('club_save_courts',['shuffle_valid_01',ps,expected]);assert.equal(result.length,2);assert.deepEqual(await rpc('club_save_courts',['shuffle_valid_01',ps,expected]),result);
});
await test('Registration requires PIN and is retry-safe without storing plaintext in private receipt',async()=>{
 await q("select set_config('request.headers','{}',false)");
 const p={requestId:'register_test_123456789',name:'New',pinCode:'1357',gender:'female',elo:2300};
 await assert.rejects(rpc('club_create_member',[{...p,pinCode:''}]),/PIN/);
 const a=await rpc('club_create_member',[p]);const b=await rpc('club_create_member',[p]);assert.equal(a.memberId,b.memberId);assert.equal(a.token,b.token);assert.equal(await scalar('select elo from members where id=$1',[a.memberId]),1000);assert.equal(await scalar('select coins from members where id=$1',[a.memberId]),100);assert.equal((await rpc('club_login',[a.memberId,'1357'])).success,true);
 assert.ok(!JSON.stringify(await scalar('select arguments from club_private.operations where id=$1',[p.requestId])).includes('1357'));
});
await test('Malformed null inputs cannot erase PIN, guests or RSVPs',async()=>{
 await assert.rejects(rpc('club_patch_member',['a',{pinCode:null},await scalar("select updated_at::text from members where id='a'")]),/PIN/);
 await rpc('club_attendance_action',['att_null_guest_add','guest_add',{guest:{id:'guest_null_test',name:'Guest',gender:'male',elo:1000}}]);
 const before=await snapshot();await assert.rejects(rpc('club_attendance_action',['att_null_remove','guest_remove',{}]),/không tồn tại/);assert.deepEqual(await snapshot(),before);
 await db.exec("insert into sessions(id,title,date,rsvps) values('null_session','test','2026-10-24','{\"a\":\"attending\"}')");await assert.rejects(rpc('club_rsvp',['null_session','a',null]),/Trạng thái/);assert.deepEqual(await scalar("select rsvps from sessions where id='null_session'"),{a:'attending'});
});
console.log(`${passed} guarded-operation database tests passed.`);
}finally{await db.close();}
