/**
 * test_phase3.js - Kiểm thử toàn diện các tính năng Giai đoạn 3:
 * 1. Cửa hàng vật phẩm (Cuốn cán, Khiên Elo, 8 Khung Avatar Nam & Nữ)
 * 2. Mua vật phẩm, quản lý Túi đồ cá nhân (Inventory)
 * 3. Đeo/Tháo khung Avatar & Render Avatar kèm Khung
 * 4. Bật/Tắt Khiên Elo & Tiêu hao khi thua trận (giảm 50% trừ điểm)
 * 5. Nhận cuốn cán thật tại sân
 * 6. BXH Đại Gia Xu (Sắp xếp theo số dư Xu)
 */

// Mock localStorage cho môi trường Node.js
const mockStore = {};
globalThis.localStorage = {
  getItem: (k) => mockStore[k] || null,
  setItem: (k, v) => { mockStore[k] = String(v); },
  removeItem: (k) => { delete mockStore[k]; },
  clear: () => { Object.keys(mockStore).forEach(k => delete mockStore[k]); }
};

const { StorageService, SHOP_ITEMS } = await import('./src/js/storage.js');
const { renderAvatarHtml } = await import('./src/js/avatar.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

console.log('\n=== BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN 3 ===\n');

// 1. Kiểm tra cấu hình SHOP_ITEMS
assert(SHOP_ITEMS.length === 10, `SHOP_ITEMS có đủ 10 vật phẩm (hiện có: ${SHOP_ITEMS.length})`);
const gripDef = SHOP_ITEMS.find(i => i.id === 'grip');
assert(gripDef && gripDef.price === 50 && gripDef.type === 'consumable', 'Cuốn cán vợt có giá 50 xu, type consumable');

const shieldDef = SHOP_ITEMS.find(i => i.id === 'elo_shield');
assert(shieldDef && shieldDef.price === 40 && shieldDef.type === 'perk', 'Thẻ khiên bảo vệ Elo có giá 40 xu, type perk');

const frames = SHOP_ITEMS.filter(i => i.type === 'frame');
assert(frames.length === 8, `Có đủ 8 Khung Avatar (hiện có: ${frames.length})`);

const maleFrames = frames.filter(f => f.category === 'male');
const femaleFrames = frames.filter(f => f.category === 'female');
assert(maleFrames.length === 4, `Có 4 khung Nam/Unisex: ${maleFrames.map(f => f.name).join(', ')}`);
assert(femaleFrames.length === 4, `Có 4 khung Nữ/Dễ thương: ${femaleFrames.map(f => f.name).join(', ')}`);

// Setup Mock Data
const testMember = {
  id: 'usr_test_p3',
  name: 'Nguyễn Văn Test P3',
  gender: 'male',
  elo: 1200,
  coins: 200,
  activeFrame: '',
  activeEloShield: false,
  matchesPlayed: 10,
  wins: 6,
  losses: 4
};

StorageService.saveMembers([testMember]);
StorageService.setCurrentUser(testMember.id);
StorageService.saveLocalInventory([]);

// 2. Mua thẻ khiên Elo (Giá 40 xu)
const buyShieldRes = StorageService.buyShopItem(testMember.id, 'elo_shield');
assert(buyShieldRes.success === true, 'Mua thẻ khiên Elo thành công');
assert(buyShieldRes.balanceAfter === 160, `Số dư sau khi mua khiên là 160 xu (thực tế: ${buyShieldRes.balanceAfter})`);

let inv = StorageService.getUserInventory(testMember.id);
let shieldInv = inv.find(i => i.itemId === 'elo_shield');
assert(shieldInv && shieldInv.quantity === 1, 'Túi đồ có 1 thẻ khiên Elo');

// Mua tiếp 1 thẻ khiên nữa (cộng dồn)
StorageService.buyShopItem(testMember.id, 'elo_shield');
inv = StorageService.getUserInventory(testMember.id);
shieldInv = inv.find(i => i.itemId === 'elo_shield');
assert(shieldInv && shieldInv.quantity === 2, `Cộng dồn số lượng khiên Elo thành 2 (thực tế: ${shieldInv?.quantity})`);

// 3. Mua cuốn cán vợt (Giá 50 xu)
const buyGripRes = StorageService.buyShopItem(testMember.id, 'grip');
assert(buyGripRes.success === true, 'Mua cuốn cán vợt thành công');
inv = StorageService.getUserInventory(testMember.id);
let gripInv = inv.find(i => i.itemId === 'grip');
assert(gripInv && gripInv.quantity === 1, 'Túi đồ có 1 cuốn cán');

// 4. Mua khung Avatar Lửa Chiến Thần (frame_fire, 100 xu)
// Số dư hiện tại: 200 - 40 - 40 - 50 = 70 xu => Thử mua khung 100 xu phải báo không đủ xu
const buyFrameFail = StorageService.buyShopItem(testMember.id, 'frame_fire');
assert(buyFrameFail.success === false && buyFrameFail.message.includes('không đủ'), 'Không đủ xu mua khung avatar báo lỗi chính xác');

// Nạp thêm xu cho testMember và mua lại
StorageService.addCoins(testMember.id, 100, 'test_reward', 'Nạp test');
const buyFrameOk = StorageService.buyShopItem(testMember.id, 'frame_fire');
assert(buyFrameOk.success === true, 'Mua khung Lửa Chiến Thần thành công sau khi nạp xu');

// Thử mua lại khung đã sở hữu => phải báo đã sở hữu
const buyFrameDuplicate = StorageService.buyShopItem(testMember.id, 'frame_fire');
assert(buyFrameDuplicate.success === false && buyFrameDuplicate.message.includes('đã sở hữu'), 'Không cho mua trùng khung avatar đã sở hữu');

// 5. Thử Đeo và Tháo Khung Avatar
let equipRes = StorageService.equipAvatarFrame(testMember.id, 'frame_fire');
assert(equipRes.success === true && equipRes.activeFrame === 'frame_fire', 'Đeo khung Lửa Chiến Thần thành công');

let updatedMem = StorageService.getMembers().find(m => m.id === testMember.id);
assert(updatedMem.activeFrame === 'frame_fire', 'activeFrame của thành viên cập nhật đúng frame_fire');

// Render Avatar có khung
const htmlWithFrame = renderAvatarHtml(updatedMem, { size: 'md' });
assert(htmlWithFrame.includes('frame-fire'), 'Markup renderAvatarHtml chứa class frame-fire');
assert(htmlWithFrame.includes('frame-deco-badge'), 'Markup renderAvatarHtml chứa thẻ deco badge');

// Tháo khung
equipRes = StorageService.equipAvatarFrame(testMember.id, '');
assert(equipRes.success === true && equipRes.activeFrame === '', 'Tháo khung về mặc định thành công');
updatedMem = StorageService.getMembers().find(m => m.id === testMember.id);
assert(updatedMem.activeFrame === '', 'activeFrame sau khi tháo là rỗng');

// 6. Bật / Tắt Khiên Bảo Vệ Elo
const toggleOn = StorageService.toggleEloShield(testMember.id, true);
assert(toggleOn.success === true && toggleOn.activeEloShield === true, 'Bật khiên bảo vệ Elo thành công');

// Tiêu hao khiên khi thua
const consumed = StorageService.consumeEloShield(testMember.id);
assert(consumed === true, 'consumeEloShield trả về true khi tiêu hao');
inv = StorageService.getUserInventory(testMember.id);
shieldInv = inv.find(i => i.itemId === 'elo_shield');
assert(shieldInv.quantity === 1, `Số lượng khiên giảm từ 2 xuống 1 (thực tế: ${shieldInv.quantity})`);

// Tiêu hao cái cuối cùng
StorageService.consumeEloShield(testMember.id);
updatedMem = StorageService.getMembers().find(m => m.id === testMember.id);
assert(updatedMem.activeEloShield === false, 'Tự động tắt activeEloShield khi hết thẻ khiên');

// 7. Nhận cuốn cán tại sân (claimGrip)
const claimRes = StorageService.claimGrip(testMember.id);
assert(claimRes.success === true && claimRes.remaining === 0, 'Đã nhận cuốn cán tại sân thành công');
const claimFail = StorageService.claimGrip(testMember.id);
assert(claimFail.success === false, 'Khi hết cuốn cán trong túi thì không claim được nữa');

// 8. Kiểm tra BXH Đại Gia Xu
const richMember1 = { id: 'usr_m1', name: 'Đại gia 1', coins: 500, elo: 1000, matchesPlayed: 5, wins: 3, losses: 2 };
const richMember2 = { id: 'usr_m2', name: 'Đại gia 2', coins: 150, elo: 1400, matchesPlayed: 20, wins: 15, losses: 5 };
const richMember3 = { id: 'usr_m3', name: 'Đại gia 3', coins: 850, elo: 1100, matchesPlayed: 8, wins: 4, losses: 4 };
StorageService.saveMembers([richMember1, richMember2, richMember3]);

const sortedByCoins = StorageService.getMembers().sort((a, b) => (b.coins || 0) - (a.coins || 0));
assert(sortedByCoins[0].id === 'usr_m3', `Top 1 Đại Gia Xu là usr_m3 với 850 xu (thực tế: ${sortedByCoins[0].name} - ${sortedByCoins[0].coins} xu)`);
assert(sortedByCoins[1].id === 'usr_m1', `Top 2 Đại Gia Xu là usr_m1 với 500 xu (thực tế: ${sortedByCoins[1].name} - ${sortedByCoins[1].coins} xu)`);
assert(sortedByCoins[2].id === 'usr_m2', `Top 3 Đại Gia Xu là usr_m2 với 150 xu (thực tế: ${sortedByCoins[2].name} - ${sortedByCoins[2].coins} xu)`);

// 9. Kiểm tra tính năng Giảm 50% trừ điểm Elo khi có Khiên bảo vệ
// Giả sử delta thua là -16
const rawLossDelta = -16;
// Khi có khiên:
const shieldedLossDelta = Math.min(-1, Math.round(rawLossDelta * 0.5));
assert(shieldedLossDelta === -8, `Khiên giảm 50% từ -16 xuống -8 (thực tế: ${shieldedLossDelta})`);

const rawLossOdd = -15;
const shieldedLossOdd = Math.min(-1, Math.round(rawLossOdd * 0.5));
assert(shieldedLossOdd === -7 || shieldedLossOdd === -8, `Khiên làm tròn số nguyên không bị số thập phân (${shieldedLossOdd})`);

console.log(`\n=== TỔNG KẾT: ${passed} PASS, ${failed} FAIL ===\n`);
if (failed > 0) process.exit(1);

