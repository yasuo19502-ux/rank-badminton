/**
 * storage.js - Quản lý dữ liệu LocalStorage & Đồng bộ Hybrid Supabase Cloud (Pro Edition)
 */

import { supabaseService } from './supabase.js';

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
  BETS: 'cbb_thai_thinh_bets_v1'
};

// Dọn dẹp cache dữ liệu mẫu cũ nếu còn tồn tại trong trình duyệt
try {
  ['cbb_thai_thinh_members_v1', 'cbb_thai_thinh_matches_v1', 'cbb_thai_thinh_sessions_v1', 'cbb_thai_thinh_attendance_v1', 'cbb_thai_thinh_active_match_v1', 'cbb_thai_thinh_settings_v1'].forEach(k => localStorage.removeItem(k));
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
      const [cloudMembers, cloudMatches, cloudSessions, cloudSettings, liveCourt1, liveCourt2, cloudCoinTx, cloudBets] = await Promise.all([
        supabaseService.fetchMembers(),
        supabaseService.fetchMatches(),
        supabaseService.fetchSessions(),
        supabaseService.fetchClubSettings(),
        supabaseService.fetchLiveCourt('court_1'),
        supabaseService.fetchLiveCourt('court_2'),
        supabaseService.fetchCoinTransactions(),
        supabaseService.fetchBets()
      ]);

      if (cloudMembers && cloudMembers.length > 0) {
        this.saveLocalMembers(cloudMembers);
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

      const todayStr = getLocalDateStr();
      const cloudAttendance = await supabaseService.fetchAttendance(todayStr);
      if (cloudAttendance) {
        this.saveLocalAttendance(cloudAttendance);
      }

      // Khôi phục activeMatch từ Sân 1 và Sân 2 lên web
      const currentMembers = this.getMembers();
      const memberMap = new Map(currentMembers.map(m => [m.id, m]));

      const restoreCourt = (liveCourt, courtId, defaultCourtName) => {
        if (liveCourt && liveCourt.team1Ids && liveCourt.team1Ids.length > 0) {
          const team1 = liveCourt.team1Ids.map(id => memberMap.get(id)).filter(Boolean);
          const team2 = liveCourt.team2Ids.map(id => memberMap.get(id)).filter(Boolean);

          if (team1.length > 0 && team2.length > 0) {
            const reconstructedMatch = {
              courtNumber: liveCourt.courtNumber || defaultCourtName,
              team1,
              team2,
              score1: liveCourt.score1 || 0,
              score2: liveCourt.score2 || 0,
              mode: liveCourt.mode || 'balanced',
              status: liveCourt.status || 'in_progress',
              diffElo: liveCourt.diffElo || 0
            };
            this.saveLocalActiveMatch(reconstructedMatch, courtId);
          }
        }
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
      members.forEach(m => supabaseService.upsertMember(m));
    }
  },

  getMemberById(id) {
    const members = this.getMembers();
    return members.find(m => m.id === id) || null;
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
        supabaseService.upsertMember(members[index]);
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
   */
  undoMatch(id) {
    let matches = this.getMatches();
    const matchToDelete = matches.find(m => m.id === id);
    if (!matchToDelete) return null;

    const members = this.getMembers();
    const memberMap = new Map(members.map(m => [m.id, m]));

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
      }
    });

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
          .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

        playerRemainingMatches.forEach(m => {
          const isTeam1 = m.team1 && m.team1.includes(playerId);
          const won = isTeam1 ? (m.score1 > m.score2) : (m.score2 > m.score1);
          if (won) {
            streak = streak > 0 ? streak + 1 : 1;
          } else {
            streak = streak < 0 ? streak - 1 : -1;
          }
        });
        mem.streak = streak;
      }
    });

    // Lưu lại danh sách members (tự động sync sang Supabase)
    this.saveMembers(members);

    // Giảm số trận hôm nay trong điểm danh nếu có
    this.decrementGamePlayedToday(allInvolvedIds);

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

    // Xóa trên Supabase Cloud
    if (supabaseService.isConfigured()) {
      supabaseService.deleteMatch(id);
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
      gamesPlayedToday: {}
    };
    this.saveLocalAttendance(defaultAttendance);
    return defaultAttendance;
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
      const key = courtId === 'court_2' ? STORAGE_KEYS.ACTIVE_MATCH_2 : STORAGE_KEYS.ACTIVE_MATCH_1;
      const data = localStorage.getItem(key);
      if (data) return JSON.parse(data);

      // Fallback cho key v2 cũ nếu đang ở sân 1
      if (courtId === 'court_1') {
        const legacy = localStorage.getItem('cbb_thai_thinh_active_match_v2');
        if (legacy) return JSON.parse(legacy);
      }
    } catch (e) {}
    return null;
  },

  saveLocalActiveMatch(match, courtId = 'court_1') {
    try {
      const key = courtId === 'court_2' ? STORAGE_KEYS.ACTIVE_MATCH_2 : STORAGE_KEYS.ACTIVE_MATCH_1;
      if (match) {
        localStorage.setItem(key, JSON.stringify(match));
      } else {
        localStorage.removeItem(key);
      }
    } catch (e) {}
  },

  saveActiveMatch(match, courtId = 'court_1') {
    this.saveLocalActiveMatch(match, courtId);
    if (supabaseService.isConfigured()) {
      supabaseService.saveLiveCourt(match, courtId);
    }
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
  }
};
