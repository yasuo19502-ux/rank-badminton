// Real PostgreSQL engine, isolated in memory. Never connects to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table members(id text primary key,phone text,elo integer default 1000,matches_played integer default 0,wins integer default 0,losses integer default 0,streak integer default 0);
  create table live_court(id text primary key,court_number text,status text,team1 text[],team2 text[],score1 integer,score2 integer,matchmaker_mode text,diff_elo integer);
  create table coin_transactions(id text primary key,member_id text references members(id),amount integer,balance_after integer,type text,description text,created_at timestamptz default now());
  create table bets(id text primary key,court_id text,match_id text,member_id text,predicted_team text,amount integer,odds numeric,potential_payout integer,status text,created_at timestamptz default now());
  create table matches(id text primary key,timestamp bigint,court_number text,team1 text[],team2 text[],score1 integer,score2 integer,elo_change integer default 11);
  create table user_inventory(id text primary key,member_id text,item_id text,item_type text,quantity integer,status text,updated_at timestamptz default now());
  insert into members(id,phone) values('existing','{"coins":347,"pinCode":"1234"}');
`);
const migration = fs.readFileSync(new URL('./supabase/migrations/20261023_atomic_wallet.sql',import.meta.url),'utf8');
await db.exec(migration);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
assert.equal(await scalar("select coins from members where id='existing'"),347);
await db.exec(migration); // Repeat deployment preserves data.
assert.equal(await scalar("select coins from members where id='existing'"),347);
let passed=0;
async function test(name,run){ await run(); passed++; console.log('PASS '+name); }
async function reset(){
  await db.exec(`truncate matches,live_court,bets,coin_transactions,user_inventory,club_daily_rewards,members cascade;
    insert into members(id,phone) select x,'{}' from unnest(array['a','b','c','d','bettor','bettor2']) x;`);
}
async function court(id='court_1',team1=['a','b'],team2=['c','d']){
  const r=await db.query(`insert into live_court(id,court_number,status,team1,team2,score1,score2) values($1,$2,'ready',$3,$4,0,0)
    on conflict(id) do update set team1=excluded.team1,team2=excluded.team2,score1=0,score2=0,status='ready',match_id='match_zs_'||gen_random_uuid()::text returning match_id`,[id,id==='court_2'?'Sân 2':'Sân 1',team1,team2]);
  return r.rows[0].match_id;
}
async function bet(match,id='bet_00000001',member='bettor',team='team1',amount=30,odds=2,courtId='court_1'){
  return scalar('select club_place_bet($1,$2,$3,$4,$5,$6,$7)',[id,courtId,match,member,team,amount,odds]);
}
async function finish(id,s1=21,s2=15,stamp=Date.parse('2026-10-23T12:00:00Z'),patch={}){
  const c=(await db.query('select * from live_court where match_id=$1',[id])).rows[0];
  const players=(await db.query('select id,elo from members where id=any($1)',[c.team1.concat(c.team2)])).rows;
  const playerResults=Object.fromEntries(players.map(p=>{const d=(c.team1.includes(p.id)===(s1>s2))?11:-11;return [p.id,{eloBefore:p.elo,eloAfter:p.elo+d,eloDelta:d,shieldUsed:false}];}));
  for(const [who,delta] of Object.entries(patch))Object.assign(playerResults[who],delta);
  const court=c.court_number+'|audit_v1:'+encodeURIComponent(JSON.stringify({playerResults}));
  await db.query(`insert into matches(id,timestamp,court_number,team1,team2,score1,score2)
    select $1,$2,$5,team1,team2,$3,$4 from live_court where match_id=$1`,[id,stamp,s1,s2,court]);
}
try {
await test('Migration giữ số dư cũ và chạy lại an toàn',async()=>assert.equal(await scalar("select coins from members where id='existing'"),347));
await reset();
await test('Lưu hồ sơ/Elo từ cache không ghi đè xu, cả khi cập nhật phone',async()=>{
  await db.exec(`update members set coins=0,elo=1200,phone='{"coins":0,"pinCode":"5678"}' where id='a'`);
  assert.equal(await scalar("select coins from members where id='a'"),100);
  assert.equal(await scalar("select (phone::jsonb->>'coins')::int from members where id='a'"),100);
  assert.equal(await scalar("select elo from members where id='a'"),1200);
});
await test('Đặt cược trừ đúng một lần khi gửi lại cùng yêu cầu',async()=>{
  const id=await court(); await bet(id); await bet(id);
  assert.equal(await scalar("select coins from members where id='bettor'"),70);
  assert.equal(await scalar("select count(*)::int from coin_transactions where type='bet_placed'"),1);
  await assert.rejects(bet(id,'bet_00000002'),/đã đặt cược/);
});
await test('Máy chốt không có vé trong cache vẫn trả thưởng đúng trận',async()=>{
  const id=await scalar("select match_id from live_court where id='court_1'");
  await finish(id);
  assert.equal(await scalar("select status from bets where id='bet_00000001'"),'won');
  assert.equal(await scalar("select coins from members where id='bettor'"),130);
  assert.deepEqual((await db.query("select id,coins from members where id in ('a','b','c','d') order by id")).rows.map(m=>m.coins),[170,170,155,155]);
  assert.equal(await scalar("select status from live_court where id='court_1'"),'idle');
});
await test('Không trả thưởng lại ở trận sau; không cho cược vào trận đã chốt',async()=>{
  const old=await scalar("select match_id from bets where id='bet_00000001'");
  await assert.rejects(bet(old,'bet_00000003','bettor2'),/thay đổi/);
  const next=await court(); await finish(next,15,21);
  assert.equal(await scalar("select coins from members where id='bettor'"),130);
  assert.equal(await scalar("select count(*)::int from coin_transactions where type='bet_win'"),1);
});
await reset();
await test('Đổi đội hình tự hoàn tất cả vé; vé hoàn không sống lại',async()=>{
  const id=await court(); await bet(id);
  const next=await court('court_1',['a','c'],['b','d']);
  assert.equal(await scalar("select coins from members where id='bettor'"),100);
  assert.equal(await scalar("select status from bets where id='bet_00000001'"),'refunded');
  await finish(next);
  assert.equal(await scalar("select coins from members where id='bettor'"),100);
  assert.equal(await scalar("select count(*)::int from coin_transactions where type='bet_win'"),0);
});
await reset();
await test('Chặn chốt kết quả bằng ID/đội hình khác',async()=>{
  const id=await court();
  await assert.rejects(db.query("insert into matches values($1,$2,'Sân 1',array['a','c'],array['b','d'],21,15)",[id,Date.now()]),/thay đổi/);
  assert.equal(await scalar('select count(*)::int from coin_transactions'),0);
});
await reset();
await test('Khóa cược ở 10 điểm và chặn người đang thi đấu',async()=>{
  const id=await court(); await assert.rejects(bet(id,'bet_00000001','a'),/đang thi đấu/);
  await db.exec("update live_court set score1=10 where id='court_1'");
  await assert.rejects(bet(id),/10 điểm/);
  assert.equal(await scalar('select count(*)::int from bets'),0);
});
await reset();
await test('Hai yêu cầu chi tiền cạnh tranh: không âm ví, không sinh vé không được trả tiền',async()=>{
  const id=await court();
  await db.exec("select club_apply_coin('bettor',-80,'test','test','prepare')");
  const outcomes=await Promise.allSettled([bet(id,'bet_00000001','bettor','team1',20),bet(id,'bet_00000002','bettor','team2',20)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await scalar("select coins from members where id='bettor'"),0);
  assert.equal(await scalar('select count(*)::int from bets'),1);
});
await reset();
await test('Cược không đủ tiền rollback cả vé và sổ',async()=>{
  const id=await court(); await db.exec("select club_apply_coin('bettor',-90,'test','test','prepare')");
  await assert.rejects(bet(id),/không đủ/);
  assert.equal(await scalar('select count(*)::int from bets'),0);
  assert.equal(await scalar("select count(*)::int from coin_transactions where type='bet_placed'"),0);
});
await reset();
await test('Mua đồ là một giao dịch; gửi lại không trừ/thêm lần hai',async()=>{
  await db.exec("select club_apply_coin('bettor',200,'test','test','prepare')");
  await db.exec("select club_buy_item('purchase_001','bettor','elo_shield');select club_buy_item('purchase_001','bettor','elo_shield')");
  assert.equal(await scalar("select coins from members where id='bettor'"),180);
  assert.equal(await scalar("select quantity from user_inventory where member_id='bettor'"),1);
  await db.exec("select club_buy_item('purchase_002','bettor','elo_shield')");
  await assert.rejects(db.exec("select club_buy_item('purchase_003','bettor','elo_shield')"),/không đủ/);
  assert.equal(await scalar("select quantity from user_inventory where member_id='bettor'"),2);
  assert.equal(await scalar("select coins from members where id='bettor'"),60);
});
await reset();
await test('Hoàn tác vé thắng/thua và thưởng ngày; chơi lại chỉ nhận một lần',async()=>{
  const id=await court(); await bet(id); await bet(id,'bet_00000002','bettor2','team2'); await finish(id);
  await db.query('delete from matches where id=$1',[id]);
  assert.equal(await scalar("select coins from members where id='bettor'"),100);
  assert.equal(await scalar("select coins from members where id='bettor2'"),100);
  assert.equal(await scalar("select coins from members where id='a'"),100);
  await db.query('delete from matches where id=$1',[id]);
  assert.equal(await scalar("select coins from members where id='a'"),100);
  const next=await court(); await finish(next);
  assert.equal(await scalar("select coins from members where id='a'"),170);
});
await test('Sổ mới khớp liên tiếp cho mọi thành viên',async()=>{
  const rows=(await db.query('select * from coin_transactions order by created_at,id')).rows;
  for(const who of new Set(rows.map(r=>r.member_id))){
    let balance=100;
    for(const tx of rows.filter(r=>r.member_id===who)){balance+=tx.amount;assert.equal(tx.balance_after,balance);}
    assert.equal(await scalar('select coins from members where id=$1',[who]),balance);
  }
});
await reset();
await test('Hồ sơ đổi trong lúc chốt: rollback cả kết quả, xu và cược',async()=>{
  const id=await court();await bet(id);
  await assert.rejects(finish(id,21,15,Date.now(),{a:{eloBefore:900}}),/Điểm thành viên/);
  assert.equal(await scalar('select count(*)::int from matches'),0);
  assert.equal(await scalar("select status from bets where id='bet_00000001'"),'pending');
  assert.equal(await scalar("select coins from members where id='a'"),100);
});
await reset();
await test('Tiêu hao thẻ và hoàn tác cùng giao dịch Elo/xu',async()=>{
  const id=await court();
  await db.exec("insert into user_inventory(id,member_id,item_id,item_type,quantity,status) values('shield','c','elo_shield','perk',1,'available')");
  await db.exec(`update members set phone='{"activeEloShield":true}' where id='c'`);
  await finish(id,21,15,Date.now(),{c:{eloAfter:995,eloDelta:-5,shieldUsed:true,shieldItemId:'shield'}});
  assert.equal(await scalar("select quantity from user_inventory where id='shield'"),0);
  assert.equal(await scalar("select elo from members where id='c'"),995);
  await db.query('delete from matches where id=$1',[id]);
  assert.equal(await scalar("select quantity from user_inventory where id='shield'"),1);
  assert.equal(await scalar("select elo from members where id='c'"),1000);
  assert.equal(await scalar("select coins from members where id='c'"),100);
});
await reset();
await test('Cập nhật sân cũ không thể hủy vé của trận mới',async()=>{
  const old=await court();
  const next=await court('court_1',['a','c'],['b','d']);
  await bet(next);
  const payload={id:'court_1',match_id:old,team1:['a','b'],team2:['c','d'],score1:1,score2:0,status:'in_progress',matchmaker_mode:'balanced',diff_elo:0};
  await assert.rejects(db.query('select club_save_court($1,$2)',[JSON.stringify(payload),old]),/Sân đã thay đổi/);
  assert.equal(await scalar("select status from bets where id='bet_00000001'"),'pending');
  payload.match_id=next;payload.team1=['a','c'];payload.team2=['b','d'];
  await db.query('select club_save_court($1,$2)',[JSON.stringify(payload),next]);
  assert.equal(await scalar("select match_id from live_court where id='court_1'"),next);
});
await test('Client không được tự sửa sổ hoặc trạng thái cược',async()=>{
  assert.equal(await scalar("select has_table_privilege('anon','public.bets','UPDATE')"),false);
  assert.equal(await scalar("select has_table_privilege('anon','public.coin_transactions','INSERT')"),false);
  assert.equal(await scalar("select has_function_privilege('anon','public.club_apply_coin(text,integer,text,text,text,text,text,boolean)','EXECUTE')"),false);
  assert.equal(await scalar("select has_function_privilege('anon','public.club_place_bet(text,text,text,text,text,integer,numeric)','EXECUTE')"),true);
});
await reset();
await test('Quà 20-10 lặp lại không ghi đè Elo, xu, khiên hoặc khung đã chọn',async()=>{
  await db.exec("alter table members add column gender text default 'male'; update members set gender='female',elo=1137,wins=8,phone='{\"activeFrame\":\"frame_gold\",\"activeEloShield\":true,\"pinCode\":\"5678\"}' where id='a'");
  await db.exec(fs.readFileSync(new URL('./supabase/migrations/20261024_safe_frame_gifts.sql',import.meta.url),'utf8'));
  await db.exec("select club_gift_october20();select club_gift_october20()");
  assert.deepEqual((await db.query("select elo,wins,coins from members where id='a'")).rows[0],{elo:1137,wins:8,coins:100});
  const meta=JSON.parse(await scalar("select phone from members where id='a'"));
  assert.equal(meta.activeFrame,'frame_gold');assert.equal(meta.activeEloShield,true);assert.equal(meta.pinCode,'5678');
  assert.equal(meta.inventory.filter(i=>i.itemId==='frame_ribbon_2010').length,1);
  assert.equal(await scalar("select count(*)::int from user_inventory where member_id='a' and item_id='frame_ribbon_2010'"),1);
  assert.equal(await scalar('select count(*)::int from coin_transactions'),0);
});
console.log(`${passed} wallet database tests passed.`);
} finally { await db.close(); }
