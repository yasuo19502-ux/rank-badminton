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
  SETTINGS: 'cbb_thai_thinh_settings_v2'
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
      const [cloudMembers, cloudMatches, cloudSessions, cloudSettings, liveCourt1, liveCourt2] = await Promise.all([
        supabaseService.fetchMembers(),
        supabaseService.fetchMatches(),
        supabaseService.fetchSessions(),
        supabaseService.fetchClubSettings(),
        supabaseService.fetchLiveCourt('court_1'),
        supabaseService.fetchLiveCourt('court_2')
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
        if (cleaned.length !== parsed.length) {
          this.saveLocalMembers(cleaned);
          return cleaned;
        }
        return parsed;
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
      joinedDate: getLocalDateStr()
    };
    members.push(newMember);
    this.saveLocalMembers(members);

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

  deleteMatch(id) {
    let matches = this.getMatches();
    const matchToDelete = matches.find(m => m.id === id);
    if (!matchToDelete) return null;

    matches = matches.filter(m => m.id !== id);
    this.saveLocalMatches(matches);

    if (supabaseService.isConfigured()) {
      supabaseService.deleteMatch(id);
    }
    return matchToDelete;
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
    this.saveLocalMembers([]);
    this.saveLocalMatches([]);
    this.saveLocalSessions([]);
    this.saveLocalAttendance({
      date: getLocalDateStr(),
      presentIds: [],
      gamesPlayedToday: {}
    });
    return [];
  }
};
