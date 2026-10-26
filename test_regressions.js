// Kiểm thử luồng kết thúc trận thật; mọi dữ liệu và API đều giả lập, không truy cập mạng.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

globalThis.crypto ??= webcrypto;
const RealDate = Date;
let now = RealDate.parse('2026-10-23T13:00:00Z');
class TestDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = TestDate;
let cache = {};
globalThis.localStorage = {
  getItem: key => cache[key] ?? null,
  setItem: (key, value) => { cache[key] = String(value); },
  removeItem: key => { delete cache[key]; }
};
const { StorageService: storage, getLocalDateStr } = await import('./src/js/storage.js');
const { supabaseService: cloud } = await import('./src/js/supabase.js');
const { calculateDoublesElo, getTierByElo, getPlayerDetailedStats } = await import('./src/js/elo.js');
const { encodeMatchCourt, decodeMatchCourt, getMatchPlayerDelta } = await import('./src/js/match-record.js');
const originalCloud = Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(cloud))
  .filter(key => key !== 'constructor').map(key => [key, cloud[key]]));
const app = fs.readFileSync(new URL('./src/js/app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function finishMatch() {');
const finishSource = app.slice(start, app.indexOf('\n/**', start));
const state = { currentCourtId: 'court_1', currentUser: null, courtMatches: { court_1: {} } };
const context = vm.createContext({
  state, scoreSync:{flush:async()=>{}},renderScoreSyncStatus(){},loadInitialState(){},renderHistory(){},renderLeaderboard(){}, StorageService: storage, supabaseService: cloud,
  calculateDoublesElo, getTierByElo, getLocalDateStr,
  showToast() {}, renderCourt() {}, updateCourtTabStatusPills() {}, renderUserAuthHeader() {},
  SoundService: { playFanfare() {}, playLevelUp() {} }, confetti() {}, setTimeout() {}, Date: TestDate
});
vm.runInContext(finishSource, context);
const player = (id, more = {}) => ({ id, name: id, gender: 'male', elo: 1000, matchesPlayed: 30, wins: 15, losses: 15, streak: 0, coins: 100, activeEloShield: false, ...more });
function reset(members = ['a','b','c','d'].map(id => player(id))) {
  cache = {};
  Object.assign(cloud, originalCloud);
  cloud.client = null;
  cloud.memberWriteQueues.clear();
  cloud.isConfigured = () => false;
  now = RealDate.parse('2026-10-23T13:00:00Z');
  storage.saveLocalMembers(members);
  storage.saveLocalInventory([]);
  storage.saveLocalCoinTransactions([]);
  storage.saveLocalMatches([]);
  storage.saveLocalBets([]);
  storage.saveGuests([]);
}
function prepare(ids = ['a','b','c','d']) {
  const people = ids.map(id => storage.getMemberById(id));
  state.activeMatch = { team1: people.slice(0,2), team2: people.slice(2), courtNumber: 'Sân 1' };
  state.score1 = 21; state.score2 = 19; state.currentUser = null;
  state.courtMatches.court_1 = {};
}
async function play(ids) {
  prepare(ids);
  await vm.runInContext('finishMatch()', context);
  now += 1000;
  return storage.getMatches()[0];
}
function shield(quantity = 1) {
  storage.updateMember('c', { activeEloShield: true });
  storage.saveLocalInventory([{id:'shield1',memberId:'c',itemId:'elo_shield',itemType:'perk',quantity}]);
}
let passed = 0;
async function test(name, run) {
  reset();
  await run();
  passed++;
  console.log('PASS ' + name);
}

await test('Kết thúc trận không khiên: điểm và xu đúng', async () => {
  await play();
  assert.deepEqual(storage.getMembers().map(m=>m.elo),[1011,1011,989,989]);
  assert.deepEqual(storage.getMembers().map(m=>m.coins),[170,170,155,155]);
});
await test('Thẻ cuối tiêu hao và tắt; trận sau hết thẻ trừ đủ', async () => {
  shield(); await play();
  assert.equal(storage.getMemberById('c').activeEloShield,false);
  assert.equal(storage.getUserInventory('c')[0].quantity,0);
  assert.equal(storage.getMemberById('c').elo,995);
  const next=await play();
  assert.equal(storage.getMemberById('c').elo,995+next.deltaTeam2);
});
await test('Flag khiên cũ không tạo quyền lợi khi túi trống', async () => {
  shield(0); const match=await play();
  assert.equal(storage.getMemberById('c').elo,1000+match.deltaTeam2);
  assert.equal(storage.getMemberById('c').activeEloShield,false);
});
await test('Thắng không tiêu hao khiên', async () => {
  storage.updateMember('a',{activeEloShield:true});
  storage.saveLocalInventory([{id:'shieldA',memberId:'a',itemId:'elo_shield',itemType:'perk',quantity:1}]);
  await play();
  assert.equal(storage.getUserInventory('a')[0].quantity,1);
});
await test('Lịch sử dùng delta cá nhân; hoàn tác trả điểm và thẻ đúng', async () => {
  shield(); const match=await play();
  assert.equal(getPlayerDetailedStats('c',storage.getMembers(),[match]).personalMatches[0].eloDelta,-5);
  await storage.undoMatch(match.id);
  assert.equal(storage.getMemberById('c').elo,1000);
  assert.equal(storage.getUserInventory('c')[0].quantity,1);
  assert.equal(await storage.undoMatch(match.id),null);
  assert.equal(storage.getUserInventory('c')[0].quantity,1);
});
await test('Cloud chỉ gửi tỷ số; metadata do máy chủ trả về vẫn giải mã đúng', async () => {
  shield();const match={...(await play()),refereeId:'ref',refereeName:'Đỗ Long'};
  const row={id:match.id,timestamp:match.timestamp,court_number:encodeMatchCourt(match),team1:match.team1,team2:match.team2,score1:match.score1,score2:match.score2,elo_change:match.eloChange,is_deuce:false};
  cloud.isConfigured=()=>true;
  cloud.mutation=async(name,args)=>{assert.equal(name,'club_finish_match');assert.deepEqual(Object.keys(args).sort(),['p_match_id','p_score1','p_score2']);return row;};
  cloud.fetchAll=async()=>[row];await cloud.insertMatch(match);
  const loaded=(await cloud.fetchMatches())[0];assert.equal(loaded.refereeName,'Đỗ Long');assert.equal(loaded.courtNumber,'Sân 1');assert.deepEqual(loaded.playerResults,JSON.parse(JSON.stringify(match.playerResults)));
  cloud.isConfigured=()=>false;storage.saveLocalMatches([loaded]);await storage.undoMatch(loaded.id);assert.equal(storage.getMemberById('c').elo,1000);
});
await test('Hoàn tác trận trước giữ phần điểm của trận sau', async () => {
  shield(); const match=await play();
  storage.updateMember('c',{elo:1015});
  await storage.undoMatch(match.id);
  assert.equal(storage.getMemberById('c').elo,1020);
});
await test('Mua sau khi hết thẻ: 0 → 1', async () => {
  storage.updateMember('c',{coins:500}); shield(0);
  assert.equal(storage.buyShopItem('c','elo_shield').success,true);
  assert.equal(storage.getUserInventory('c')[0].quantity,1);
});
await test('Không ghi trực tiếp túi đồ; tải dữ liệu giữ đúng số lượng 0', async () => {
  cloud.isConfigured=()=>true;cloud.fetchAll=async()=>[{id:'empty',member_id:'c',item_id:'elo_shield',quantity:0}];
  await assert.rejects(cloud.upsertInventoryItem({id:'empty',quantity:1}),/máy chủ/);
  assert.equal((await cloud.fetchInventory())[0].quantity,0);
});
await test('Hoàn tác cloud ghi số dư mới, chỉ cập nhật người liên quan', async () => {
  storage.saveLocalMembers([...storage.getMembers(),player('unrelated')]);
  const match=await play();
  const server=new Map(storage.getMembers().map(m=>[m.id,structuredClone(m)]));
  const writes=[];
  cloud.isConfigured=()=>true;
  cloud.checkWalletVersion=async()=>3;
  cloud.deleteMatch=async()=>{for(const id of ['a','b','c','d'])server.get(id).coins=100;return true;};
  cloud.upsertMembers=async members=>{for(const m of members){writes.push(m.id);server.set(m.id,{...m,coins:server.get(m.id).coins});}return true;};
  cloud.fetchMembers=async()=>[...server.values()];
  cloud.fetchCoinTransactions=cloud.fetchBets=cloud.fetchInventory=async()=>[];
  cloud.fetchMatches=cloud.fetchSessions=async()=>[];
  cloud.fetchClubSettings=cloud.fetchLiveCourt=cloud.fetchAttendance=async()=>null;
  cloud.saveAttendance=async()=>true;
  await storage.undoMatch(match.id);
  assert.equal(storage.getMemberById('a').coins,100);
  assert.equal(server.get('a').coins,100);
  assert.equal(writes.includes('unrelated'),false);
});
await test('Trước 07:00 giờ Việt Nam chỉ thưởng ngày một lần', async () => {
  now=RealDate.parse('2026-10-22T18:00:00Z'); await play(); await play();
  assert.equal(storage.getCoinTransactions('a').filter(t=>t.type==='session_checkin').length,1);
});
await test('Hoàn tác trận duy nhất rồi chơi lại nhận đúng thưởng ngày', async () => {
  const match=await play(); await storage.undoMatch(match.id); await play();
  assert.equal(storage.getMemberById('a').coins,170);
});
await test('Hoàn tác ngày cũ không giảm số trận hôm nay', async () => {
  const match=await play();
  now=RealDate.parse('2026-10-24T13:00:00Z');
  storage.saveLocalAttendance({date:getLocalDateStr(),presentIds:[],gamesPlayedToday:{a:3}});
  await storage.undoMatch(match.id);
  assert.equal(storage.getAttendance().gamesPlayedToday.a,3);
});
await test('Sổ ghi biến động thực tế khi thu hồi bị chặn ở 0; từ chối NaN', async () => {
  storage.updateMember('a',{coins:10});
  const result=storage.addCoins('a',-50,'match_undo','test');
  assert.equal(result.transaction.amount,-10);
  assert.equal(result.balanceAfter,0);
  assert.equal(storage.addCoins('a',NaN,'invalid','test'),null);
});
await test('API và fallback lịch sử giữ delta 0; trận cũ giữ tỷ lệ 80%', async () => {
  cloud.isConfigured=()=>true;
  cloud.mutation=async()=>({id:'match_zs_zero',elo_change:0,court_number:'Sân 1'});
  const saved=await cloud.insertMatch({id:'match_zs_zero',score1:21,score2:19});assert.equal(saved.elo_change,0);
  const match={id:'match_zs_zero',team1:['a','b'],team2:['c','d'],score1:21,score2:19,eloChange:0};
  assert.equal(getMatchPlayerDelta(match,'c'),0);
  assert.equal(getMatchPlayerDelta({...match,id:'match_old',eloChange:11},'c'),-9);
  assert.equal(getMatchPlayerDelta({...match,eloChange:11},'c'),-11);
});
await test('Khách giữ Elo, số trận và streak sau lưu/hoàn tác', async () => {
  storage.saveGuests([player('guest_a',{isGuest:true})]);
  const match=await play(['a','b','c','guest_a']);
  assert.equal(storage.getMemberById('guest_a').elo,989);
  await storage.undoMatch(match.id);
  assert.equal(storage.getMemberById('guest_a').elo,1000);
  assert.equal(storage.getMemberById('guest_a').streak,0);
});
await test('Mua vật phẩm B không ghi đè hồ sơ A từ cache cũ', async () => {
  storage.saveLocalMembers(['a','b','c','d'].map(id=>player(id,{coins:500})));
  const server=new Map([['a',{elo:1200,coins:650}]]);
  cloud.isConfigured=()=>true;
  cloud.upsertMember=async m=>{server.set(m.id,structuredClone(m));return true;};
  cloud.upsertMembers=async ms=>{ms.forEach(m=>server.set(m.id,structuredClone(m)));return true;};
  cloud.walletAction=async(name,args)=>{assert.equal(name,'club_buy_item');assert.equal(args.p_member_id,'b');return {success:true,data:{balance_after:380}};};
  cloud.fetchMembers=async()=>[...storage.getMembers().filter(m=>m.id!=='a'),player('a',{elo:1200,coins:650})];
  cloud.fetchCoinTransactions=cloud.fetchBets=cloud.fetchInventory=async()=>[];
  await storage.buyShopItem('b','elo_shield');
  assert.deepEqual(server.get('a'),{elo:1200,coins:650});
});
await test('Kết thúc trận dùng Elo hiện tại thay cho snapshot đội hình cũ', async () => {
  prepare(); storage.updateMember('a',{elo:1400});
  await vm.runInContext('finishMatch()',context);
  assert.equal(storage.getMemberById('a').elo,1405);
});
await test('Sửa hồ sơ tương thích chỉ gửi trường hồ sơ và phiên bản, không gửi Elo/xu', async () => {
  const calls=[];cloud.isConfigured=()=>true;cloud.patchMember=async(id,patch,version)=>{calls.push({id,patch,version});return true;};
  await cloud.upsertMember(player('a',{coins:125,elo:1700,updatedAt:'v1'}));
  assert.equal(calls[0].version,'v1');assert.equal(calls[0].patch.elo,undefined);assert.equal(calls[0].patch.coins,undefined);assert.equal(calls[0].patch.matchesPlayed,undefined);
});
await test('Máy chủ cũ chưa nâng cấp bị chặn, không quay lại ghi xu bằng metadata',async()=>{
  cloud.isConfigured=()=>true;cloud.walletVersion=0;cloud.checkWalletVersion=async()=>2;
  const result=await cloud.walletAction('club_buy_item',{});assert.equal(result.success,false);
});
await test('Realtime đăng ký đủ xu, cược và inventory', async () => {
  const tables=[];
  const channel={on(_event,filter,_fn){tables.push(filter.table);return this;},subscribe(){return this;}};
  cloud.isConfigured=()=>true; cloud.realtimeChannel=null;
  cloud.client={channel:()=>channel};
  cloud.subscribeToChanges(()=>{});
  for(const table of ['coin_transactions','bets','user_inventory']) assert.ok(tables.includes(table));
});
await test('Cloud tắt khiên không bị flag local bật ghi đè; giữ inventory 0', async () => {
  shield(0);
  const remote=storage.getMembers().map(m=>({...m,activeEloShield:false}));
  cloud.isConfigured=()=>true;
  cloud.fetchMembers=async()=>remote;
  for(const key of ['fetchMatches','fetchSessions','fetchCoinTransactions','fetchBets']) cloud[key]=async()=>[];
  for(const key of ['fetchClubSettings','fetchLiveCourt','fetchAttendance']) cloud[key]=async()=>null;
  cloud.fetchInventory=async()=>[{id:'shield1',memberId:'c',itemId:'elo_shield',quantity:0}];
  assert.equal(await storage.syncFromCloud(),true);
  assert.equal(storage.getMemberById('c').activeEloShield,false);
  assert.equal(storage.getUserInventory('c')[0].quantity,0);
});
await test('Hoàn tác trận trả cược thắng/thua về vốn ban đầu', async () => {
  storage.saveLocalMembers([...storage.getMembers(),player('winner'),player('loser')]);
  storage.placeBet('court_1','winner','team1',20,1.9);
  storage.placeBet('court_1','loser','team2',20,1.9);
  const match=await play();
  assert.equal(storage.getMemberById('winner').coins,118);
  assert.equal(storage.getMemberById('loser').coins,80);
  await storage.undoMatch(match.id);
  assert.equal(storage.getMemberById('winner').coins,100);
  assert.equal(storage.getMemberById('loser').coins,100);
});
await test('Hoàn tác sau khi đồng bộ trận 0 Elo không tạo ra 16 điểm', async () => {
  storage.saveLocalMembers(['a','b','c','d'].map(id=>player(id,{elo:500})));
  const match=await play();
  const loaded={...match,deltaTeam1:undefined,deltaTeam2:undefined,playerResults:undefined,eloChange:0};
  storage.saveLocalMatches([loaded]);
  await storage.undoMatch(loaded.id);
  assert.deepEqual(storage.getMembers().map(m=>m.elo),[500,500,500,500]);
});
await test('Đọc metadata cũ và hỏng vẫn lấy đúng sân/trọng tài', async () => {
  assert.equal(decodeMatchCourt('Sân 2').courtNumber,'Sân 2');
  assert.equal(decodeMatchCourt('Sân 1|ref:ref|Đỗ Long|audit_v1:%bad').refereeName,'Đỗ Long');
  const match={courtNumber:'Sân 1',refereeName:'Đỗ Long',playerResults:{a:{eloDelta:0}},deltaTeam1:0,deltaTeam2:0};
  assert.equal(decodeMatchCourt(encodeMatchCourt(match)).playerResults.a.eloDelta,0);
});
await test('864 tổ hợp Elo cơ bản cân bằng và tôn trọng sàn', async () => {
  for(const e1 of [500,505,800,1000,1200,1500]) for(const e2 of [500,505,800,1000,1200,1500]) for(const n of [0,9,10,19,20,100]) for(const score of [[21,19],[21,10],[21,5],[19,21]]) {
    const a=[player('a',{elo:e1,matchesPlayed:n}),player('b',{elo:e1,matchesPlayed:n})];
    const b=[player('c',{elo:e2}),player('d',{elo:e2})];
    const result=calculateDoublesElo(a,b,...score);
    assert.equal(result.deltaTeam1+result.deltaTeam2,0);
    assert.ok(Number.isInteger(result.deltaTeam1));
    assert.ok(e1+result.deltaTeam1>=500 && e2+result.deltaTeam2>=500);
  }
});

await test('Cloud chốt trận dùng ID cố định, không tự cộng ví hay lưu lại hồ sơ',async()=>{
  prepare(); state.activeMatch.matchId='match_zs_cloud';
  const remote=storage.getMembers().map((m,i)=>({...m,coins:i<2?170:155,elo:i<2?1011:989}));
  cloud.isConfigured=()=>true; cloud.checkWalletVersion=async()=>3;
  let inserted;
  cloud.insertMatch=async m=>{inserted=structuredClone(m);return true;};
  cloud.upsertMember=()=>{throw Error('Không được lưu hồ sơ cũ sau khi server chốt trận');};
  cloud.fetchMembers=async()=>remote;
  cloud.fetchBets=cloud.fetchInventory=cloud.fetchCoinTransactions=async()=>[];
  cloud.fetchMatches=async()=>[{id:'match_zs_cloud'}];cloud.fetchSessions=async()=>[];cloud.fetchClubSettings=cloud.fetchLiveCourt=cloud.fetchAttendance=async()=>null;
  await vm.runInContext('finishMatch()',context);
  assert.equal(inserted.id,'match_zs_cloud');
  assert.equal(storage.getMatches()[0].id,'match_zs_cloud');
  assert.equal(storage.getMemberById('a').coins,170);
  assert.equal(storage.getCoinTransactions().length,0);
});
await test('Cloud từ chối lưu trận thì không báo lưu vào lịch sử hoặc ghi hồ sơ',async()=>{
  prepare(); state.activeMatch.matchId='match_zs_failed';
  const before=structuredClone(storage.getMembers());
  cloud.isConfigured=()=>true; cloud.checkWalletVersion=async()=>3;
  cloud.insertMatch=async()=>false;
  cloud.upsertMember=()=>{throw Error('Không được ghi hồ sơ khi trận chưa commit');};
  cloud.fetchMembers=async()=>before;
  cloud.fetchBets=cloud.fetchInventory=cloud.fetchCoinTransactions=cloud.fetchMatches=cloud.fetchSessions=async()=>[];
  cloud.fetchClubSettings=cloud.fetchLiveCourt=cloud.fetchAttendance=async()=>null;
  await vm.runInContext('finishMatch()',context);
  assert.equal(storage.getMatches().length,0);
  assert.equal(storage.getMemberById('a').elo,1000);
  assert.equal(storage.getMemberById('a').coins,100);
});
await test('Đặt cược mất mạng không trừ ví local và gửi lại cùng mã vé',async()=>{
  const calls=[];
  cloud.isConfigured=()=>true;
  cloud.walletAction=async(name,args)=>{calls.push(args);return {success:false,message:'network'};};
  const first=await storage.placeBet('court_1','a','team1',30,2,'match_zs_test');
  const second=await storage.placeBet('court_1','a','team1',30,2,'match_zs_test');
  assert.equal(first.success,false);assert.equal(second.success,false);
  assert.equal(calls[0].p_id,calls[1].p_id);
  assert.equal(storage.getMemberById('a').coins,100);
  assert.equal(storage.getCoinTransactions().length,0);
});

await test('Mở app online không tặng khung bằng cách ghi hồ sơ cũ',async()=>{
  storage.saveLocalMembers([player('a',{gender:'female',elo:800,coins:0})]);
  cloud.isConfigured=()=>true;
  let calls=0;
  cloud.giftOctober20Frames=async()=>{calls++;return {success:true,count:1};};
  cloud.upsertMember=()=>{throw Error('Không được gửi hồ sơ cache khi tặng khung');};
  await storage.giftOctober20Frames();
  assert.equal(calls,1);
  assert.equal(storage.getMemberById('a').elo,800);
  assert.equal(storage.getLocalInventory().length,0);
});

Object.assign(cloud,originalCloud); cloud.client=null;
globalThis.Date=RealDate;
console.log(`${passed} regression scenarios passed.`);
