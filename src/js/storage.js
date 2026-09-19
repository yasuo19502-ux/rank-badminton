/**
 * storage.js - Quản lý dữ liệu LocalStorage & Đồng bộ Hybrid Supabase Cloud (Pro Edition)
 */

import { supabaseService } from './supabase.js';
import { calculateDoublesElo } from './elo.js';

const STORAGE_KEYS = {
  MEMBERS: 'cbb_thai_thinh_members_v2',
  MATCHES: 'cbb_thai_thinh_matches_v2',
  SESSIONS: 'cbb_thai_thinh_sessions_v2',
  ATTENDANCE: 'cbb_thai_thinh_attendance_v2',
  ACTIVE_MATCH_1: 'cbb_thai_thinh_active_match_court_1',
  ACTIVE_MATCH_2: 'cbb_thai_thinh_active_match_court_2',
  SETTINGS: 'cbb_thai_thinh_settings_v2',
  CURRENT_USER_ID: 'cbb_thai_thinh_current_user_id_v1',
  COIN_TRANSACTIONS: 'cbb_thai_thinh_coin_transactions_v1',
  BETS: 'cbb_thai_thinh_bets_v1',
  INVENTORY: 'cbb_thai_thinh_inventory_v1',
  GUESTS: 'cbb_thai_thinh_guests_v1'
};

export const SHOP_ITEMS = [
  // 1. Đồ thật tại sân
  {
    id: 'grip',
    name: 'Cuốn Cán Vợt Chống Trơn',
    price: 150,
    icon: '🏸',
    type: 'consumable',
    category: 'real',
    rarity: 'rare',
    badge: 'Đồ Thật Tại Sân',
    tierBadge: 'Vật Phẩm Sân',
    description: 'Cuốn cán cầu lông xịn êm tay, thấm hút mồ hôi tối ưu. Tích xu đổi nhận trực tiếp tại sân thi đấu.'
  },
  // 2. Thẻ trận đấu
  {
    id: 'elo_shield',
    name: 'Thẻ Khiên Bảo Vệ Elo',
    price: 120,
    icon: '🛡️',
    type: 'perk',
    category: 'perk',
    rarity: 'rare',
    badge: 'Đặc Quyền Trận',
    tierBadge: 'Bảo Hiểm Elo',
    description: 'Bật trước trận: Nếu thua chỉ bị trừ 50% Elo! Nếu thắng vẫn nhận đủ 100% Elo và không mất thẻ.'
  },
  // 3. Khung Avatar Tinh Anh (Rare - Thiết kế ngầu, sắc nét)
  {
    id: 'frame_carbon',
    name: 'Khung Titan Hắc Báo',
    price: 500,
    icon: '🖤',
    type: 'frame',
    category: 'male',
    rarity: 'rare',
    badge: 'Nam / Unisex',
    tierBadge: 'Tinh Anh 🖤',
    description: 'Đúc từ kim loại của những cây vợt từng trải qua trăm trận thư hùng. Biểu tượng của sát thủ thầm lặng: không ồn ào phô trương nhưng một khi vung vợt là dứt điểm đoạt mạng.'
  },
  {
    id: 'frame_rainbow',
    name: 'Khung Cầu Vồng Năng Lượng',
    price: 600,
    icon: '🌈',
    type: 'frame',
    category: 'female',
    rarity: 'rare',
    badge: 'Nữ / Dễ thương',
    tierBadge: 'Tinh Anh 🌈',
    description: 'Kết tinh từ nụ cười rạng rỡ và ngọn lửa đam mê không bao giờ tắt. Người mang khung này luôn thắp sáng cả sân đấu, kéo tinh thần đồng đội đứng dậy sau mọi pha cầu hỏng.'
  },
  {
    id: 'frame_sakura',
    name: 'Khung Hoa Anh Đào Tuyết',
    price: 700,
    icon: '🌸',
    type: 'frame',
    category: 'female',
    rarity: 'rare',
    badge: 'Nữ / Dễ thương',
    tierBadge: 'Tinh Anh 🌸',
    description: 'Tượng trưng cho những pha bỏ nhỏ thanh thoát êm như cánh hoa rơi. Vẻ ngoài mềm mại, uyển chuyển nhưng ẩn chứa những đường cầu gài góc hiểm hóc khôn lường.'
  },
  {
    id: 'frame_moon',
    name: 'Khung Nguyệt Dạ Thỏ Ngọc',
    price: 800,
    icon: '🌙',
    type: 'frame',
    category: 'female',
    rarity: 'rare',
    badge: 'Nữ / Dễ thương',
    tierBadge: 'Tinh Anh 🌙',
    description: 'Dành riêng cho những tay vợt bền bỉ nán lại dưới ánh đèn đêm muộn. Bộ pháp di chuyển thoắt ẩn thoắt hiện, điều cầu biến ảo và khó lường như ánh trăng rằm.'
  },
  // 4. Khung Avatar Thần Thoại / Huyền Thoại VIP (Legendary - Animation Xoay 360°, Hào Quang Nổi Bật)
  {
    id: 'frame_neon',
    name: 'Khung Tia Chớp Cyberpunk',
    price: 1100,
    icon: '⚡',
    type: 'frame',
    category: 'male',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Nam / Unisex',
    tierBadge: 'Huyền Thoại VIP ⚡',
    description: 'Đại diện cho tốc độ và phản xạ vượt ngoài giới hạn thể chất. Khi tia chớp vừa lóe lên, quả cầu đã cắm sàn trước khi đối thủ kịp nhận ra điều gì vừa xảy ra.'
  },
  {
    id: 'frame_water',
    name: 'Khung Thủy Triều Đại Dương',
    price: 1300,
    icon: '🌊',
    type: 'frame',
    category: 'female',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Unisex / Mát lạnh',
    tierBadge: 'Thần Thoại VIP 🌊',
    description: 'Hiện thân của trường phái lấy nhu thắng cương. Dù đối thủ có smash bão táp đến đâu, dòng nước cuộn trào cũng nuốt trọn mọi đòn đánh rồi êm ru phản công kết liễu.'
  },
  {
    id: 'frame_fire',
    name: 'Khung Hỏa Phụng Chiến Thần',
    price: 1500,
    icon: '🔥',
    type: 'frame',
    category: 'male',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Nam / Unisex',
    tierBadge: 'Thần Thoại VIP 🔥',
    description: 'Tái sinh từ những pha lội ngược dòng nghẹt thở. Ngọn lửa thi đấu càng bị dồn vào nghịch cảnh càng bùng cháy dữ dội, thiêu rụi hoàn toàn ý chí của đối phương.'
  },
  {
    id: 'frame_diamond',
    name: 'Khung Kim Cương Tinh Thể',
    price: 1650,
    icon: '💎',
    type: 'frame',
    category: 'female',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Nữ / Dễ thương',
    tierBadge: 'Thần Thoại VIP 💎',
    description: 'Đúc kết từ hàng nghìn giờ mồ hôi mài giũa không ngừng trên sàn đấu. Bản lĩnh kiên cố không tì vết, tỏa sáng rực rỡ và vững vàng trước mọi sức ép ở những điểm số quyết định.'
  },
  {
    id: 'frame_gold',
    name: 'Khung Rồng Vàng Hoàng Gia',
    price: 1800,
    icon: '👑',
    type: 'frame',
    category: 'male',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Nam / Unisex',
    tierBadge: 'Vô Địch Tối Thượng 👑',
    description: 'Mang khí chất quân vương áp đảo toàn bộ sân đấu. Mỗi sải bước đều toát lên uy quyền của kẻ thống trị, khiến đối thủ chùn chân rén vợt từ trước khi giao cầu.'
  },
  {
    id: 'frame_glory_wings',
    name: 'Khung Thần Thoại Thách Đấu',
    price: 2000,
    icon: '⚜️',
    type: 'frame',
    category: 'male',
    rarity: 'legendary',
    hasAnimation: true,
    badge: 'Nam / Unisex',
    tierBadge: 'Thần Thoại Thách Đấu ⚜️',
    description: 'Bảo vật tối thượng của CLB Thái Thịnh. Đôi cánh hoàng kim nâng đỡ những cú nhảy đập đỉnh cao, chỉ trao tay những nhà vô địch khắc tên mình vào lịch sử giải đấu.'
  }
];

// Dọn dẹp cache dữ liệu mẫu cũ nếu còn tồn tại trong trình duyệt
try {
  ['cbb_thai_thinh_members_v1', 'cbb_thai_thinh_matches_v1', 'cbb_thai_thinh_sessions_v1', 'cbb_thai_thinh_attendance_v1', 'cbb_thai_thinh_active_match_v1', 'cbb_thai_thinh_active_match_v2', 'cbb_thai_thinh_settings_v1'].forEach(k => localStorage.removeItem(k));
} catch (e) {}

// Khởi tạo danh sách rỗng 100% để người dùng tự thêm thành viên thật
export const INITIAL_MEMBERS = [];
export const INITIAL_MATCHES = [];
export const INITIAL_SESSIONS = [];

/**
 * Trả về chuỗi ngày YYYY-MM-DD theo giờ ĐỊA PHƯƠNG (Việt Nam UTC+7) thay vì UTC
 */
export function getLocalDateStr(d = new Date()) {
  const date = typeof d === 'string' ? new Date(d) : (d || new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const StorageService = {
  // Đồng bộ đám mây Supabase
  async syncFromCloud() {
    if (!supabaseService.isConfigured()) return false;

    try {
      console.log('[Sync] Bắt đầu đồng bộ từ Supabase Cloud...');
      const [cloudMembers, cloudMatches, cloudSessions, cloudSettings, liveCourt1, liveCourt2, cloudCoinTx, cloudBets, cloudInv] = await Promise.all([
        supabaseService.fetchMembers(),
        supabaseService.fetchMatches(),
        supabaseService.fetchSessions(),
        supabaseService.fetchClubSettings(),
        supabaseService.fetchLiveCourt('court_1'),
        supabaseService.fetchLiveCourt('court_2'),
        supabaseService.fetchCoinTransactions(),
        supabaseService.fetchBets(),
        supabaseService.fetchInventory()
      ]);

      if (cloudMembers && cloudMembers.length > 0) {
        // 1. Đồng bộ Túi đồ (Inventory) từ Cloud
        const currentInv = this.getLocalInventory();
        const invMap = new Map();
        currentInv.forEach(i => {
          const key = i.id || `${i.memberId}_${i.itemId}`;
          invMap.set(key, i);
        });

        cloudMembers.forEach(m => {
          if (Array.isArray(m._metaInventory)) {
            m._metaInventory.forEach(item => {
              const key = item.id || `${item.memberId}_${item.itemId}`;
              if (!invMap.has(key)) {
                invMap.set(key, item);
              } else {
                const existing = invMap.get(key);
                invMap.set(key, { ...existing, ...item });
              }
            });
          }
        });
        this.saveLocalInventory(Array.from(invMap.values()));

        // 2. Đồng bộ thành viên: Bảo toàn activeFrame & activeEloShield
        const localMembers = this.getMembers();
        const localMap = new Map(localMembers.map(m => [m.id, m]));
        let needsCloudUpdate = false;

        const mergedMembers = cloudMembers.map(cm => {
          const lm = localMap.get(cm.id);
          const activeFrame = cm.activeFrame || lm?.activeFrame || '';
          const activeEloShield = cm.activeEloShield || lm?.activeEloShield || false;
          if (lm?.activeFrame && !cm.activeFrame) {
            needsCloudUpdate = true;
          }
          return {
            ...cm,
            activeFrame,
            activeEloShield
          };
        });

        this.saveLocalMembers(mergedMembers);

        if (needsCloudUpdate) {
          const inv = this.getLocalInventory();
          supabaseService.upsertMembers(mergedMembers, inv);
        }
      }
      if (cloudMatches) {
        this.saveLocalMatches(cloudMatches);
      }
      if (cloudSessions && cloudSessions.length > 0) {
        this.saveLocalSessions(cloudSessions);
      }
      if (cloudSettings) {
        this.saveLocalSettings(cloudSettings);
      }
      if (cloudCoinTx && cloudCoinTx.length > 0) {
        this.saveLocalCoinTransactions(cloudCoinTx);
      }
      if (cloudBets) {
        this.saveLocalBets(cloudBets);
      }
      if (cloudInv) {
        this.saveLocalInventory(cloudInv);
      }

      const todayStr = getLocalDateStr();
      const cloudAttendance = await supabaseService.fetchAttendance(todayStr);
      if (cloudAttendance) {
        // Hợp nhất danh sách khách giao lưu giữa Cloud và Local để đồng bộ tức thì đa thiết bị
        const localGuests = this.getGuests();
        const guestMap = new Map();
        (cloudAttendance.guests || []).forEach(g => guestMap.set(g.id, g));
        localGuests.forEach(g => {
          if (!guestMap.has(g.id)) guestMap.set(g.id, g);
        });
        const mergedGuests = Array.from(guestMap.values());
        this.saveGuests(mergedGuests);
        cloudAttendance.guests = mergedGuests;

        if (Array.isArray(cloudAttendance.presentIds)) {
          mergedGuests.forEach(g => {
            if (!cloudAttendance.presentIds.includes(g.id)) {
              cloudAttendance.presentIds.push(g.id);
            }
          });
        }
        this.saveLocalAttendance(cloudAttendance);
      }

      // Khôi phục activeMatch từ Sân 1 và Sân 2 lên web (Bao gồm cả thành viên & khách giao lưu)
      const currentMembers = this.getMembers();
      const currentGuests = this.getGuests();
      const allPeople = [...currentMembers, ...currentGuests];
      const personMap = new Map(allPeople.map(m => [m.id, m]));

      const restoreCourt = (liveCourt, courtId, defaultCourtName) => {
        if (!liveCourt) {
          return;
        }

        const rawT1 = liveCourt.team1Ids || [];
        const rawT2 = liveCourt.team2Ids || [];
        const slotT1 = [
          rawT1[0] ? personMap.get(rawT1[0]) || null : null,
          rawT1[1] ? personMap.get(rawT1[1]) || null : null
        ];
        const slotT2 = [
          rawT2[0] ? personMap.get(rawT2[0]) || null : null,
          rawT2[1] ? personMap.get(rawT2[1]) || null : null
        ];
        const hasAnyPlayer = slotT1.some(Boolean) || slotT2.some(Boolean);

        if (!hasAnyPlayer || liveCourt.status === 'idle') {
          const empty = {
            courtNumber: liveCourt.courtNumber || defaultCourtName,
            team1: [null, null],
            team2: [null, null],
            score1: 0,
            score2: 0,
            status: 'idle',
            matchStatus: 'idle',
            diffElo: 0
          };
          this.saveLocalActiveMatch(empty, courtId);
          return;
        }

        const validT1 = slotT1.filter(Boolean);
        const validT2 = slotT2.filter(Boolean);
        const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
        const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;

        const s1 = Number(liveCourt.score1) || 0;
        const s2 = Number(liveCourt.score2) || 0;
        let calculatedStatus = liveCourt.status;
        if (s1 > 0 || s2 > 0) {
          calculatedStatus = 'in_progress';
        } else if (!calculatedStatus || calculatedStatus === 'idle') {
          calculatedStatus = (validT1.length + validT2.length === 4) ? 'ready' : 'idle';
        }

        const reconstructedMatch = {
          courtNumber: liveCourt.courtNumber || defaultCourtName,
          team1: slotT1,
          team2: slotT2,
          score1: s1,
          score2: s2,
          mode: liveCourt.mode || 'balanced',
          status: calculatedStatus,
          matchStatus: calculatedStatus,
          diffElo: Number(liveCourt.diffElo) || Math.abs(elo1 - elo2)
        };
        this.saveLocalActiveMatch(reconstructedMatch, courtId);
      };

      restoreCourt(liveCourt1, 'court_1', 'Sân 1');
      restoreCourt(liveCourt2, 'court_2', 'Sân 2');

      console.log('[Sync] Đồng bộ Supabase 2 sân hoàn tất thành công!');
      return true;
    } catch (e) {
      console.error('[Sync] Lỗi đồng bộ đám mây:', e);
      return false;
    }
  },

  // --- MEMBERS ---
  getMembers() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.MEMBERS);
      if (data) {
        const parsed = JSON.parse(data);
        // Lọc bỏ triệt để các ID mẫu mem_1 -> mem_16 nếu còn sót trong cache
        const cleaned = parsed.filter(m => !m.id || !m.id.match(/^mem_[0-9]{1,2}$/));
        const normalized = cleaned.map(m => ({
          ...m,
          coins: m.coins !== undefined && m.coins !== null ? Number(m.coins) : 100,
          role: m.role || 'member',
          pinCode: m.pinCode || ''
        }));
        if (cleaned.length !== parsed.length) {
          this.saveLocalMembers(normalized);
        }
        return normalized;
      }
    } catch (e) {}
    this.saveLocalMembers(INITIAL_MEMBERS);
    return INITIAL_MEMBERS;
  },

  saveLocalMembers(members) {
    try {
      localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(members));
    } catch (e) {}
  },

  saveMembers(members) {
    this.saveLocalMembers(members);
    if (supabaseService.isConfigured()) {
      const inv = this.getLocalInventory();
      supabaseService.upsertMembers(members, inv);
    }
  },

  getMemberById(id) {
    if (!id) return null;
    const members = this.getMembers();
    const found = members.find(m => m.id === id);
    if (found) return found;
    // Kiểm tra trong danh sách khách vãng lai nếu có
    const guests = this.getGuests();
    return guests.find(g => g.id === id) || null;
  },

  addMember(memberData) {
    const members = this.getMembers();
    const initialCoins = memberData.coins !== undefined ? Number(memberData.coins) : 100;
    const newMember = {
      id: 'mem_' + Date.now(),
      name: memberData.name.trim(),
      nickname: memberData.nickname ? memberData.nickname.trim() : '',
      gender: memberData.gender || 'male',
      frequency: memberData.frequency || 'regular',
      elo: Number(memberData.elo) || 1000,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      avatar: memberData.avatar || '',
      joinedDate: getLocalDateStr(),
      pinCode: memberData.pinCode ? String(memberData.pinCode).trim() : '',
      coins: initialCoins,
      role: memberData.role || 'member'
    };
    members.push(newMember);
    this.saveLocalMembers(members);

    // Ghi nhận giao dịch tặng xu tân thủ
    this.recordCoinTx(newMember.id, initialCoins, initialCoins, 'welcome', 'Chào mừng gia nhập CLB Cầu Lông Thái Thịnh!');

    if (supabaseService.isConfigured()) {
      supabaseService.upsertMember(newMember);
    }
    return newMember;
  },

  updateMember(id, updateData) {
    const members = this.getMembers();
    const index = members.findIndex(m => m.id === id);
    if (index !== -1) {
      members[index] = { ...members[index], ...updateData };
      this.saveLocalMembers(members);

      if (supabaseService.isConfigured()) {
        const inv = this.getLocalInventory();
        supabaseService.upsertMember(members[index], inv);
      }
      return members[index];
    }
    return null;
  },

  deleteMember(id) {
    let members = this.getMembers();
    members = members.filter(m => m.id !== id);
    this.saveLocalMembers(members);

    // Dọn khỏi attendance nếu có
    try {
      const att = this.getAttendance();
      if (att && att.presentIds) {
        att.presentIds = att.presentIds.filter(pid => pid !== id);
        this.saveAttendance(att);
      }
    } catch (e) {}

    if (supabaseService.isConfigured()) {
      supabaseService.deleteMember(id);
    }
  },

  // --- SESSIONS (LỊCH BUỔI ĐÁNH & SÂN ĐẤU) ---
  getSessions() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SESSIONS);
      if (data) return JSON.parse(data);
    } catch (e) {}
    this.saveLocalSessions(INITIAL_SESSIONS);
    return INITIAL_SESSIONS;
  },

  saveLocalSessions(sessions) {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    } catch (e) {}
  },

  saveSessions(sessions) {
    this.saveLocalSessions(sessions);
    if (supabaseService.isConfigured()) {
      sessions.forEach(s => supabaseService.upsertSession(s));
    }
  },

  addSession(sessionData) {
    const sessions = this.getSessions();
    const newSession = {
      id: 'session_' + Date.now(),
      title: (sessionData.title || '').trim(),
      date: sessionData.date || getLocalDateStr(),
      startTime: (sessionData.startTime || '').trim(),
      endTime: (sessionData.endTime || '').trim(),
      venueName: (sessionData.venueName || '').trim(),
      venueAddress: (sessionData.venueAddress || '').trim(),
      courtNumbers: (sessionData.courtNumbers || '').trim(),
      feeNote: (sessionData.feeNote || '').trim(),
      rsvps: sessionData.rsvps || {}
    };
    sessions.unshift(newSession);
    this.saveLocalSessions(sessions);

    if (supabaseService.isConfigured()) {
      supabaseService.upsertSession(newSession);
    }
    return newSession;
  },

  updateSession(id, updateData) {
    const sessions = this.getSessions();
    const index = sessions.findIndex(s => s.id === id);
    if (index !== -1) {
      sessions[index] = { ...sessions[index], ...updateData };
      this.saveLocalSessions(sessions);

      if (supabaseService.isConfigured()) {
        supabaseService.upsertSession(sessions[index]);
      }
      return sessions[index];
    }
    return null;
  },

  deleteSession(id) {
    let sessions = this.getSessions();
    sessions = sessions.filter(s => s.id !== id);
    this.saveLocalSessions(sessions);

    if (supabaseService.isConfigured()) {
      supabaseService.deleteSession(id);
    }
  },

  rsvpSession(sessionId, memberId, status = 'attending') {
    const sessions = this.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      if (!session.rsvps) session.rsvps = {};
      session.rsvps[memberId] = status;
      this.saveLocalSessions(sessions);

      if (supabaseService.isConfigured()) {
        supabaseService.upsertSession(session);
      }
      return session;
    }
    return null;
  },

  // --- MATCHES ---
  getMatches() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.MATCHES);
      if (data) return JSON.parse(data);
    } catch (e) {}
    this.saveLocalMatches(INITIAL_MATCHES);
    return INITIAL_MATCHES;
  },

  saveLocalMatches(matches) {
    try {
      localStorage.setItem(STORAGE_KEYS.MATCHES, JSON.stringify(matches));
    } catch (e) {}
  },

  addMatch(matchData) {
    const matches = this.getMatches();
    const newMatch = {
      id: 'match_' + Date.now(),
      timestamp: Date.now(),
      courtNumber: matchData.courtNumber || 'Sân 1',
      ...matchData
    };
    matches.unshift(newMatch);
    this.saveLocalMatches(matches);

    if (supabaseService.isConfigured()) {
      supabaseService.insertMatch(newMatch);
    }
    return newMatch;
  },

  /**
   * Hoàn tác trận đấu: Khôi phục lại Elo, số trận, số thắng/thua, streak và số trận hôm nay
   * Áp dụng đầy đủ cho cả thành viên chính thức và khách giao lưu
   */
  async undoMatch(id) {
    let matches = this.getMatches();
    const matchToDelete = matches.find(m => m.id === id);
    if (!matchToDelete) return null;

    const members = this.getMembers();
    const memberMap = new Map(members.map(m => [m.id, m]));
    const guests = this.getGuests();
    let guestsChanged = false;

    // Xác định điểm Elo biến động của từng đội trong trận này
    const score1 = Number(matchToDelete.score1) || 0;
    const score2 = Number(matchToDelete.score2) || 0;
    const team1Won = score1 > score2;

    let delta1 = 0;
    let delta2 = 0;
    if (matchToDelete.deltaTeam1 !== undefined && matchToDelete.deltaTeam2 !== undefined) {
      delta1 = Number(matchToDelete.deltaTeam1);
      delta2 = Number(matchToDelete.deltaTeam2);
    } else {
      const eloChange = Number(matchToDelete.eloChange) || 16;
      const lossPenalty = Math.max(1, Math.round(eloChange * 0.8));
      delta1 = team1Won ? eloChange : -lossPenalty;
      delta2 = team1Won ? -lossPenalty : eloChange;
    }

    // Hoàn trả thông số cho Team 1
    const t1Ids = matchToDelete.team1 || [];
    t1Ids.forEach(playerId => {
      const mem = memberMap.get(playerId);
      if (mem) {
        mem.elo = Math.max(500, (mem.elo || 1000) - delta1);
        mem.matchesPlayed = Math.max(0, (mem.matchesPlayed || 1) - 1);
        if (team1Won) {
          mem.wins = Math.max(0, (mem.wins || 1) - 1);
        } else {
          mem.losses = Math.max(0, (mem.losses || 1) - 1);
        }
      } else if (String(playerId).startsWith('guest_')) {
        const guest = guests.find(g => g.id === playerId);
        if (guest) {
          guest.elo = Math.max(500, (guest.elo || 1000) - delta1);
          guest.matchesPlayed = Math.max(0, (guest.matchesPlayed || 1) - 1);
          if (team1Won) {
            guest.wins = Math.max(0, (guest.wins || 1) - 1);
          } else {
            guest.losses = Math.max(0, (guest.losses || 1) - 1);
          }
          guestsChanged = true;
        }
      }
    });

    // Hoàn trả thông số cho Team 2
    const t2Ids = matchToDelete.team2 || [];
    t2Ids.forEach(playerId => {
      const mem = memberMap.get(playerId);
      if (mem) {
        mem.elo = Math.max(500, (mem.elo || 1000) - delta2);
        mem.matchesPlayed = Math.max(0, (mem.matchesPlayed || 1) - 1);
        if (!team1Won) {
          mem.wins = Math.max(0, (mem.wins || 1) - 1);
        } else {
          mem.losses = Math.max(0, (mem.losses || 1) - 1);
        }
      } else if (String(playerId).startsWith('guest_')) {
        const guest = guests.find(g => g.id === playerId);
        if (guest) {
          guest.elo = Math.max(500, (guest.elo || 1000) - delta2);
          guest.matchesPlayed = Math.max(0, (guest.matchesPlayed || 1) - 1);
          if (!team1Won) {
            guest.wins = Math.max(0, (guest.wins || 1) - 1);
          } else {
            guest.losses = Math.max(0, (guest.losses || 1) - 1);
          }
          guestsChanged = true;
        }
      }
    });

    if (guestsChanged) {
      this.saveGuests(guests);
    }

    // Xóa trận đấu khỏi danh sách matches
    matches = matches.filter(m => m.id !== id);
    this.saveLocalMatches(matches);

    // Tính toán lại streak chuẩn xác từ các trận đấu còn lại
    const allInvolvedIds = [...t1Ids, ...t2Ids];
    allInvolvedIds.forEach(playerId => {
      const mem = memberMap.get(playerId);
      if (mem) {
        let streak = 0;
        const playerRemainingMatches = matches
          .filter(m => (m.team1 && m.team1.includes(playerId)) || (m.team2 && m.team2.includes(playerId)))
          .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

        playerRemainingMatches.forEach(m => {
          const isTeam1 = m.team1 && m.team1.includes(playerId);
          const won = isTeam1 ? (Number(m.score1) > Number(m.score2)) : (Number(m.score2) > Number(m.score1));
          if (won) {
            streak = streak > 0 ? streak + 1 : 1;
          } else {
            streak = streak < 0 ? streak - 1 : -1;
          }
        });
        mem.streak = streak;
      }
    });

    // Lưu lại danh sách members (cả local và batch sync lên Supabase)
    this.saveMembers(members);

    // Giảm số trận hôm nay trong điểm danh nếu có
    this.decrementGamePlayedToday(allInvolvedIds);

    // Hoàn tác xu thi đấu (+20 Xu thắng / +5 Xu thua) & xu điểm danh (+50 Xu)
    let matchDateStr = '';
    if (matchToDelete.timestamp) {
      try {
        const tsNum = Number(matchToDelete.timestamp);
        if (!isNaN(tsNum) && tsNum > 0) {
          matchDateStr = new Date(tsNum).toISOString().split('T')[0];
        } else {
          matchDateStr = String(matchToDelete.timestamp).split('T')[0];
        }
      } catch (e) {
        matchDateStr = getLocalDateStr();
      }
    }

    const winIds = team1Won ? t1Ids : t2Ids;
    const loseIds = team1Won ? t2Ids : t1Ids;

    winIds.forEach(pId => {
      if (pId && !String(pId).startsWith('guest_')) {
        this.addCoins(pId, -20, 'match_undo', 'Hoàn tác trận đấu: Thu hồi 20 Xu thắng trận');
      }
    });

    loseIds.forEach(pId => {
      if (pId && !String(pId).startsWith('guest_')) {
        this.addCoins(pId, -5, 'match_undo', 'Hoàn tác trận đấu: Thu hồi 5 Xu hoàn thành trận');
      }
    });

    // Thu hồi xu điểm danh (+50 Xu) nếu trận này là trận duy nhất của người chơi trong ngày đó
    allInvolvedIds.forEach(pId => {
      if (pId && !String(pId).startsWith('guest_') && matchDateStr) {
        const hasOtherMatchOnDay = matches.some(m => {
          let mDate = '';
          if (m.timestamp) {
            const tsNum = Number(m.timestamp);
            mDate = (!isNaN(tsNum) && tsNum > 0) ? new Date(tsNum).toISOString().split('T')[0] : String(m.timestamp).split('T')[0];
          }
          const inT1 = m.team1 && m.team1.includes(pId);
          const inT2 = m.team2 && m.team2.includes(pId);
          return mDate === matchDateStr && (inT1 || inT2);
        });

        if (!hasOtherMatchOnDay) {
          const txs = this.getCoinTransactions(pId);
          const hasDailyCheckin = txs.some(t => t.type === 'session_checkin' && t.createdAt?.startsWith(matchDateStr));
          if (hasDailyCheckin) {
            this.addCoins(pId, -50, 'session_checkin_undo', `Hoàn tác trận đấu: Thu hồi 50 Xu điểm danh ngày ${matchDateStr}`);
          }
        }
      }
    });

    // Hoàn tác các vé cược gắn với trận đấu này nếu có
    const allBets = this.getLocalBets();
    allBets.forEach(bet => {
      if (bet.matchId === id) {
        if (bet.status === 'won') {
          const netWin = bet.potentialPayout - bet.amount;
          if (netWin > 0) {
            this.addCoins(bet.memberId, -netWin, 'bet_refund', `Hoàn tác trận đấu: Điều chỉnh lại tiền cược`);
          }
        } else if (bet.status === 'lost') {
          this.addCoins(bet.memberId, bet.amount, 'bet_refund', `Hoàn tác trận đấu: Hoàn lại ${bet.amount} Xu cược`);
        }
        bet.status = 'refunded';
        if (supabaseService.isConfigured()) {
          supabaseService.updateBet(bet.id, { status: 'refunded' });
        }
      }
    });
    this.saveLocalBets(allBets);

    // Xóa trên Supabase Cloud & Batch update members
    if (supabaseService.isConfigured()) {
      await supabaseService.deleteMatch(id);
      await supabaseService.upsertMembers(members);
    }

    return matchToDelete;
  },

  deleteMatch(id) {
    return this.undoMatch(id);
  },

  resetAllMemberStats() {
    const members = this.getMembers();
    members.forEach(m => {
      m.elo = 1000;
      m.matchesPlayed = 0;
      m.wins = 0;
      m.losses = 0;
      m.streak = 0;
    });
    this.saveMembers(members);
    return members;
  },

  // --- ATTENDANCE ---
  getAttendance() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ATTENDANCE);
      if (data) {
        const parsed = JSON.parse(data);
        const todayStr = getLocalDateStr();
        if (parsed.date === todayStr) {
          if (!Array.isArray(parsed.guests)) parsed.guests = [];
          return parsed;
        }
      }
    } catch (e) {}

    const todayStr = getLocalDateStr();
    const members = this.getMembers();
    const defaultPresentIds = members
      .filter(m => m.frequency === 'regular')
      .map(m => m.id);

    const defaultAttendance = {
      date: todayStr,
      presentIds: defaultPresentIds,
      gamesPlayedToday: {},
      guests: []
    };
    this.saveLocalAttendance(defaultAttendance);
    return defaultAttendance;
  },

  // --- GUEST MANAGEMENT (KHÁCH VÃNG LAI) ---
  getGuests() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.GUESTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}

    const attendance = this.getAttendance();
    return Array.isArray(attendance.guests) ? attendance.guests : [];
  },

  saveGuests(guests) {
    try {
      localStorage.setItem(STORAGE_KEYS.GUESTS, JSON.stringify(guests));
    } catch (e) {}
    const attendance = this.getAttendance();
    attendance.guests = guests;
    this.saveLocalAttendance(attendance);
  },

  addGuest(guestData) {
    const guests = this.getGuests();
    const attendance = this.getAttendance();
    if (!Array.isArray(attendance.presentIds)) attendance.presentIds = [];

    const newGuest = {
      id: 'guest_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: (guestData.name || 'Khách').trim(),
      gender: guestData.gender || 'male',
      elo: Number(guestData.elo) || 1000,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      streak: 0,
      isGuest: true,
      role: 'guest',
      avatar: guestData.avatar || '',
      createdAt: new Date().toISOString()
    };

    guests.push(newGuest);
    if (!attendance.presentIds.includes(newGuest.id)) {
      attendance.presentIds.push(newGuest.id);
    }

    this.saveGuests(guests);
    this.saveAttendance(attendance);
    return newGuest;
  },

  removeGuest(guestId) {
    let guests = this.getGuests();
    guests = guests.filter(g => g.id !== guestId);
    this.saveGuests(guests);

    const attendance = this.getAttendance();
    if (attendance.guests) {
      attendance.guests = attendance.guests.filter(g => g.id !== guestId);
    }
    if (attendance.presentIds) {
      attendance.presentIds = attendance.presentIds.filter(id => id !== guestId);
    }
    if (attendance.gamesPlayedToday && attendance.gamesPlayedToday[guestId]) {
      delete attendance.gamesPlayedToday[guestId];
    }
    this.saveAttendance(attendance);
    return attendance;
  },

  updateGuestElo(guestId, delta, won) {
    const attendance = this.getAttendance();
    if (!attendance.guests) return;
    const guest = attendance.guests.find(g => g.id === guestId);
    if (guest) {
      guest.elo = Math.max(500, (guest.elo || 1000) + delta);
      guest.matchesPlayed = (guest.matchesPlayed || 0) + 1;
      if (won) {
        guest.wins = (guest.wins || 0) + 1;
        guest.streak = guest.streak > 0 ? guest.streak + 1 : 1;
      } else {
        guest.losses = (guest.losses || 0) + 1;
        guest.streak = guest.streak < 0 ? guest.streak - 1 : -1;
      }
      this.saveAttendance(attendance);
    }
  },

  saveLocalAttendance(attendance) {
    try {
      localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(attendance));
    } catch (e) {}
  },

  saveAttendance(attendance) {
    this.saveLocalAttendance(attendance);
    if (supabaseService.isConfigured()) {
      supabaseService.saveAttendance(attendance);
    }
  },

  toggleAttendance(memberId) {
    const attendance = this.getAttendance();
    const index = attendance.presentIds.indexOf(memberId);
    if (index === -1) {
      attendance.presentIds.push(memberId);
    } else {
      attendance.presentIds.splice(index, 1);
    }
    this.saveAttendance(attendance);
    return attendance;
  },

  setAttendanceList(memberIds) {
    const attendance = this.getAttendance();
    attendance.presentIds = Array.from(new Set(memberIds));
    this.saveAttendance(attendance);
    return attendance;
  },

  recordGamePlayedToday(playerIds) {
    const attendance = this.getAttendance();
    if (!attendance.gamesPlayedToday) attendance.gamesPlayedToday = {};
    playerIds.forEach(id => {
      attendance.gamesPlayedToday[id] = (attendance.gamesPlayedToday[id] || 0) + 1;
    });
    this.saveAttendance(attendance);
    return attendance;
  },

  decrementGamePlayedToday(playerIds) {
    const attendance = this.getAttendance();
    if (!attendance.gamesPlayedToday) attendance.gamesPlayedToday = {};
    playerIds.forEach(id => {
      if (attendance.gamesPlayedToday[id]) {
        attendance.gamesPlayedToday[id] = Math.max(0, attendance.gamesPlayedToday[id] - 1);
      }
    });
    this.saveAttendance(attendance);
    return attendance;
  },

  // Active Match (Trận đấu đang diễn ra trên sân 1 hoặc sân 2)
  getActiveMatch(courtId = 'court_1') {
    try {
      localStorage.removeItem('cbb_thai_thinh_active_match_v2');
      const key = courtId === 'court_2' ? STORAGE_KEYS.ACTIVE_MATCH_2 : STORAGE_KEYS.ACTIVE_MATCH_1;
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.team1) && Array.isArray(parsed.team2)) {
          return parsed;
        }
      }
    } catch (e) {}
    return {
      courtNumber: courtId === 'court_2' ? 'Sân 2' : 'Sân 1',
      team1: [null, null],
      team2: [null, null],
      score1: 0,
      score2: 0,
      status: 'idle',
      matchStatus: 'idle',
      diffElo: 0
    };
  },

  saveLocalActiveMatch(match, courtId = 'court_1') {
    try {
      localStorage.removeItem('cbb_thai_thinh_active_match_v2');
      const key = courtId === 'court_2' ? STORAGE_KEYS.ACTIVE_MATCH_2 : STORAGE_KEYS.ACTIVE_MATCH_1;
      if (match) {
        localStorage.setItem(key, JSON.stringify(match));
      } else {
        localStorage.setItem(key, JSON.stringify({
          courtNumber: courtId === 'court_2' ? 'Sân 2' : 'Sân 1',
          team1: [null, null],
          team2: [null, null],
          score1: 0,
          score2: 0,
          status: 'idle',
          matchStatus: 'idle',
          diffElo: 0
        }));
      }
    } catch (e) {}
  },

  async saveActiveMatch(match, courtId = 'court_1') {
    this.saveLocalActiveMatch(match, courtId);
    if (supabaseService.isConfigured()) {
      return await supabaseService.saveLiveCourt(match, courtId);
    }
    return true;
  },

  // Club Settings (Cấu hình và thông báo CLB)
  getClubSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) return JSON.parse(data);
    } catch (e) {}
    return {
      clubName: 'CLB Cầu Lông Thái Thịnh',
      announcement: '',
      defaultVenue: 'Sân Cầu Lông Thái Thịnh',
      defaultAddress: 'Số 123 Thái Thịnh, Đống Đa, Hà Nội',
      kFactor: 32
    };
  },

  saveLocalSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {}
  },

  saveClubSettings(settings) {
    this.saveLocalSettings(settings);
    if (supabaseService.isConfigured()) {
      supabaseService.saveClubSettings(settings);
    }
  },

  // Export & Import
  exportAllData() {
    return JSON.stringify({
      version: '2.0',
      exportedAt: new Date().toISOString(),
      members: this.getMembers(),
      matches: this.getMatches(),
      sessions: this.getSessions(),
      attendance: this.getAttendance()
    }, null, 2);
  },

  importAllData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.members && Array.isArray(data.members)) {
        this.saveMembers(data.members);
      }
      if (data.matches && Array.isArray(data.matches)) {
        this.saveLocalMatches(data.matches);
      }
      if (data.sessions && Array.isArray(data.sessions)) {
        this.saveSessions(data.sessions);
      }
      if (data.attendance) {
        this.saveAttendance(data.attendance);
      }
      return true;
    } catch (e) {
      console.error('Lỗi import dữ liệu:', e);
      return false;
    }
  },

  resetAllData() {
    localStorage.removeItem(STORAGE_KEYS.MEMBERS);
    localStorage.removeItem(STORAGE_KEYS.MATCHES);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.ATTENDANCE);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_MATCH);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    localStorage.removeItem(STORAGE_KEYS.COIN_TRANSACTIONS);
    this.saveLocalMembers([]);
    this.saveLocalMatches([]);
    this.saveLocalSessions([]);
    this.saveLocalAttendance({
      date: getLocalDateStr(),
      presentIds: [],
      gamesPlayedToday: {}
    });
    return [];
  },

  // --- QUẢN LÝ TÀI KHOẢN & PHIÊN ĐĂNG NHẬP (USER AUTH) ---
  getCurrentUserId() {
    try {
      return localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID) || null;
    } catch (e) {
      return null;
    }
  },

  getCurrentUser() {
    const userId = this.getCurrentUserId();
    if (!userId) return null;
    return this.getMemberById(userId);
  },

  setCurrentUser(memberId) {
    try {
      if (memberId) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, memberId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
      }
    } catch (e) {}
  },

  clearCurrentUser() {
    this.setCurrentUser(null);
  },

  verifyPin(memberId, inputPin) {
    const mem = this.getMemberById(memberId);
    if (!mem) return { success: false, message: 'Không tìm thấy thành viên' };

    const cleanInput = String(inputPin).trim();
    // Nếu chưa từng đặt PIN, chấp nhận mã PIN người dùng vừa nhập và lưu làm PIN mới
    if (!mem.pinCode) {
      this.setUserPin(memberId, cleanInput);
      return { success: true, isNewPin: true, member: mem };
    }

    if (String(mem.pinCode).trim() === cleanInput) {
      return { success: true, isNewPin: false, member: mem };
    }

    return { success: false, message: 'Mã PIN 4 số không chính xác!' };
  },

  setUserPin(memberId, newPin) {
    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (mem) {
      mem.pinCode = String(newPin).trim();
      this.saveMembers(members);
      return true;
    }
    return false;
  },

  // --- QUẢN LÝ VÍ XU & GIAO DỊCH (COINS & WALLET) ---
  getLocalCoinTransactions() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.COIN_TRANSACTIONS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveLocalCoinTransactions(transactions) {
    try {
      localStorage.setItem(STORAGE_KEYS.COIN_TRANSACTIONS, JSON.stringify(transactions));
    } catch (e) {}
  },

  getCoinTransactions(memberId = null) {
    const txs = this.getLocalCoinTransactions();
    if (memberId) {
      return txs.filter(t => t.memberId === memberId);
    }
    return txs;
  },

  recordCoinTx(memberId, amount, balanceAfter, type, description) {
    const tx = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      memberId,
      amount: Number(amount),
      balanceAfter: Number(balanceAfter),
      type: type || 'system',
      description: description || '',
      createdAt: new Date().toISOString()
    };

    const txs = this.getLocalCoinTransactions();
    txs.unshift(tx);
    this.saveLocalCoinTransactions(txs);

    if (supabaseService.isConfigured()) {
      supabaseService.insertCoinTransaction(tx);
    }
    return tx;
  },

  addCoins(memberId, amount, type, description) {
    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem) return null;

    const currentCoins = Number(mem.coins !== undefined ? mem.coins : 100);
    const balanceAfter = Math.max(0, currentCoins + Number(amount));
    mem.coins = balanceAfter;
    this.saveMembers(members);

    const tx = this.recordCoinTx(memberId, amount, balanceAfter, type, description);
    return { success: true, balanceAfter, transaction: tx };
  },

  revertAllCheckinCoins() {
    try {
      // 1. Xóa các giao dịch session_checkin cũ khỏi sổ giao dịch
      let txs = this.getLocalCoinTransactions();
      const beforeCount = txs.length;
      txs = txs.filter(t => t.type !== 'session_checkin');
      if (txs.length !== beforeCount) {
        this.saveLocalCoinTransactions(txs);
      }

      // 2. Đặt lại số dư của tất cả thành viên về 100 mặc định nếu chưa chi tiêu mua đồ
      const members = this.getMembers();
      let changed = false;
      const inv = this.getLocalInventory();
      members.forEach(m => {
        const hasPurchases = inv.some(item => item.userId === m.id);
        if (!hasPurchases && m.coins !== 100) {
          m.coins = 100;
          changed = true;
        }
      });
      if (changed) {
        this.saveMembers(members);
      }

      // 3. Dọn dẹp giao dịch session_checkin trên Supabase Cloud nếu đã kết nối
      if (supabaseService.isConfigured()) {
        supabaseService.deleteCoinTransactionsByType('session_checkin').catch(() => {});
      }
    } catch (e) {
      console.warn('Lỗi hoàn tác xu điểm danh:', e);
    }
  },

  // --- KIỂM TRA LỊCH BUỔI ĐÁNH HỢP LỆ (SESSION CHECK) ---
  hasScheduledSessionToday(targetDate = null) {
    const dateToCheck = targetDate || getLocalDateStr();
    const sessions = this.getSessions();
    return sessions.some(s => s.date === dateToCheck);
  },

  getScheduledSessionToday(targetDate = null) {
    const dateToCheck = targetDate || getLocalDateStr();
    const sessions = this.getSessions();
    return sessions.find(s => s.date === dateToCheck) || null;
  },

  // --- QUẢN LÝ DỰ ĐOÁN & CƯỢC VUI (BETS - GIAI ĐOẠN 2) ---
  getLocalBets() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BETS);
      if (data) {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  saveLocalBets(bets) {
    try {
      localStorage.setItem(STORAGE_KEYS.BETS, JSON.stringify(bets));
    } catch (e) {}
  },

  getBets(courtId = null, status = null) {
    let bets = this.getLocalBets();
    if (courtId) {
      bets = bets.filter(b => b.courtId === courtId);
    }
    if (status) {
      bets = bets.filter(b => b.status === status);
    }
    return bets;
  },

  getUserActiveBet(courtId, memberId) {
    if (!courtId || !memberId) return null;
    const bets = this.getBets(courtId, 'pending');
    return bets.find(b => b.memberId === memberId) || null;
  },

  placeBet(courtId, memberId, predictedTeam, amount, odds) {
    const numAmount = Number(amount);
    if (![10, 20, 30].includes(numAmount)) {
      return { success: false, message: 'Mức cược không hợp lệ (chỉ chấp nhận 10, 20 hoặc 30 xu)!' };
    }

    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem) {
      return { success: false, message: 'Không tìm thấy tài khoản thành viên!' };
    }

    const userCoins = Number(mem.coins !== undefined ? mem.coins : 100);
    if (userCoins < numAmount) {
      return { success: false, message: `Số dư không đủ! Bạn có ${userCoins} Xu, cần ${numAmount} Xu.` };
    }

    // Kiểm tra xem đã đặt cược trận này chưa
    const existingBet = this.getUserActiveBet(courtId, memberId);
    if (existingBet) {
      return { success: false, message: 'Bạn đã đặt cược cho trận này rồi!' };
    }

    const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
    const teamName = predictedTeam === 'team1' ? 'Đội 1' : 'Đội 2';

    // Trừ xu ví ngay khi chốt cược
    const deductRes = this.addCoins(
      memberId,
      -numAmount,
      'bet_placed',
      `Đặt cược ${numAmount} Xu cho ${teamName} (${courtName}, Kèo ${odds}x)`
    );

    if (!deductRes || !deductRes.success) {
      return { success: false, message: 'Lỗi khi trừ xu đặt cược!' };
    }

    const potentialPayout = Math.round(numAmount * Number(odds));
    const bet = {
      id: 'bet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      courtId,
      matchId: '',
      memberId,
      predictedTeam,
      amount: numAmount,
      odds: Number(odds),
      potentialPayout,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    const allBets = this.getLocalBets();
    allBets.unshift(bet);
    this.saveLocalBets(allBets);

    if (supabaseService.isConfigured()) {
      supabaseService.insertBet(bet);
    }

    return { success: true, bet, balanceAfter: deductRes.balanceAfter };
  },

  settleMatchBets(courtId, winningTeam, matchId = '') {
    const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
    const allBets = this.getLocalBets();
    const wonBets = [];
    const lostBets = [];

    allBets.forEach(bet => {
      if (bet.courtId === courtId && bet.status === 'pending') {
        bet.matchId = matchId || bet.matchId || '';
        if (bet.predictedTeam === winningTeam) {
          bet.status = 'won';
          wonBets.push(bet);
          // Cộng tiền thưởng (hoàn cược + tiền thắng)
          this.addCoins(
            bet.memberId,
            bet.potentialPayout,
            'bet_win',
            `Thắng cược trận ${courtName}: +${bet.potentialPayout} Xu (Tỷ lệ ${bet.odds}x)`
          );
        } else {
          bet.status = 'lost';
          lostBets.push(bet);
        }

        if (supabaseService.isConfigured()) {
          supabaseService.updateBet(bet.id, { status: bet.status, matchId: bet.matchId });
        }
      }
    });

    this.saveLocalBets(allBets);
    return { wonBets, lostBets };
  },

  refundMatchBets(courtId, reason = 'Trận đấu bị hủy hoặc làm lại') {
    const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
    const allBets = this.getLocalBets();
    const refundedBets = [];

    allBets.forEach(bet => {
      if (bet.courtId === courtId && bet.status === 'pending') {
        bet.status = 'refunded';
        refundedBets.push(bet);
        // Hoàn trả 100% xu đã cược
        this.addCoins(
          bet.memberId,
          bet.amount,
          'bet_refund',
          `Hoàn cược ${courtName} (+${bet.amount} Xu): ${reason}`
        );

        if (supabaseService.isConfigured()) {
          supabaseService.updateBet(bet.id, { status: 'refunded' });
        }
      }
    });

    this.saveLocalBets(allBets);
    return refundedBets;
  },

  // --- TÚI ĐỒ & CỬA HÀNG VẬT PHẨM (GIAI ĐOẠN 3) ---
  getLocalInventory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.INVENTORY);
      if (data) {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  saveLocalInventory(inventory) {
    try {
      localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventory));
    } catch (e) {}
  },

  getUserInventory(memberId) {
    if (!memberId) return [];
    const all = this.getLocalInventory();
    return all.filter(item => item.memberId === memberId);
  },

  buyShopItem(memberId, itemId) {
    const itemDef = SHOP_ITEMS.find(i => i.id === itemId);
    if (!itemDef) {
      return { success: false, message: 'Vật phẩm không tồn tại!' };
    }

    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem) {
      return { success: false, message: 'Không tìm thấy thông tin thành viên!' };
    }

    // Nếu là khung avatar, kiểm tra xem đã sở hữu chưa
    if (itemDef.type === 'frame') {
      const userInv = this.getUserInventory(memberId);
      const alreadyOwned = userInv.some(i => i.itemId === itemId);
      if (alreadyOwned) {
        return { success: false, message: 'Bạn đã sở hữu khung Avatar này rồi!' };
      }
    }

    const currentCoins = Number(mem.coins !== undefined ? mem.coins : 100);
    if (currentCoins < itemDef.price) {
      return { success: false, message: `Số dư không đủ! Bạn có ${currentCoins} Xu, vật phẩm giá ${itemDef.price} Xu.` };
    }

    // Trừ xu
    const deductRes = this.addCoins(
      memberId,
      -itemDef.price,
      'shop_purchase',
      `Mua vật phẩm Cửa hàng: ${itemDef.name} (-${itemDef.price} Xu)`
    );

    if (!deductRes || !deductRes.success) {
      return { success: false, message: 'Lỗi khi trừ xu thanh toán!' };
    }

    // Thêm vào inventory
    const allInv = this.getLocalInventory();
    const existingConsumable = allInv.find(i => i.memberId === memberId && i.itemId === itemId && i.itemType !== 'frame');

    let inventoryItem = null;
    if (existingConsumable) {
      existingConsumable.quantity = (existingConsumable.quantity || 1) + 1;
      existingConsumable.updatedAt = new Date().toISOString();
      inventoryItem = existingConsumable;
    } else {
      inventoryItem = {
        id: 'inv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        memberId,
        itemId: itemDef.id,
        itemType: itemDef.type,
        quantity: 1,
        status: 'available',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      allInv.unshift(inventoryItem);
    }

    this.saveLocalInventory(allInv);

    if (supabaseService.isConfigured()) {
      supabaseService.upsertInventoryItem(inventoryItem);
      const members = this.getMembers();
      supabaseService.upsertMembers(members, allInv);
    }

    return { success: true, item: itemDef, balanceAfter: deductRes.balanceAfter };
  },

  equipAvatarFrame(memberId, frameId) {
    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem) return { success: false, message: 'Không tìm thấy thành viên' };

    // Nếu frameId là rỗng thì tháo khung
    if (!frameId) {
      mem.activeFrame = '';
      this.saveMembers(members);
      return { success: true, activeFrame: '' };
    }

    // Kiểm tra xem đã sở hữu khung này chưa
    const userInv = this.getUserInventory(memberId);
    const hasFrame = userInv.some(i => i.itemId === frameId);
    if (!hasFrame) {
      return { success: false, message: 'Bạn chưa sở hữu khung Avatar này!' };
    }

    mem.activeFrame = frameId;
    this.saveMembers(members);
    return { success: true, activeFrame: frameId };
  },

  toggleEloShield(memberId, enabled = null) {
    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem) return { success: false, message: 'Không tìm thấy thành viên' };

    const userInv = this.getUserInventory(memberId);
    const shieldItem = userInv.find(i => i.itemId === 'elo_shield' && i.quantity > 0);

    const targetState = enabled !== null ? enabled : !mem.activeEloShield;

    if (targetState && (!shieldItem || shieldItem.quantity <= 0)) {
      return { success: false, message: 'Bạn chưa có Thẻ Khiên Bảo Vệ Elo nào! Hãy mua trong Cửa hàng.' };
    }

    mem.activeEloShield = targetState;
    this.saveMembers(members);
    return { success: true, activeEloShield: targetState, remainingShields: shieldItem?.quantity || 0 };
  },

  consumeEloShield(memberId) {
    const members = this.getMembers();
    const mem = members.find(m => m.id === memberId);
    if (!mem || !mem.activeEloShield) return false;

    const allInv = this.getLocalInventory();
    const shieldItem = allInv.find(i => i.memberId === memberId && i.itemId === 'elo_shield' && i.quantity > 0);
    if (!shieldItem) {
      mem.activeEloShield = false;
      this.saveMembers(members);
      return false;
    }

    shieldItem.quantity -= 1;
    shieldItem.updatedAt = new Date().toISOString();
    if (shieldItem.quantity <= 0) {
      mem.activeEloShield = false;
    }

    this.saveMembers(members);
    this.saveLocalInventory(allInv);

    if (supabaseService.isConfigured()) {
      supabaseService.upsertInventoryItem(shieldItem);
    }
    return true;
  },

  claimGrip(memberId) {
    const allInv = this.getLocalInventory();
    const gripItem = allInv.find(i => i.memberId === memberId && i.itemId === 'grip' && i.quantity > 0);
    if (!gripItem) {
      return { success: false, message: 'Bạn không có cuốn cán nào để nhận!' };
    }

    gripItem.quantity -= 1;
    gripItem.updatedAt = new Date().toISOString();
    this.saveLocalInventory(allInv);

    if (supabaseService.isConfigured()) {
      supabaseService.upsertInventoryItem(gripItem);
    }
    return { success: true, remaining: gripItem.quantity };
  }
};
