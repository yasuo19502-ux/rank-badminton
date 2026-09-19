/**
 * supabase.js - Dịch vụ kết nối Cloud Database Supabase & Đồng bộ Realtime (Pro Edition)
 */

import { createClient } from '@supabase/supabase-js';

const CONFIG_KEYS = {
  URL: 'cbb_supabase_url',
  KEY: 'cbb_supabase_key'
};

class SupabaseService {
  constructor() {
    this.client = null;
    this.realtimeChannel = null;
    this.initClient();
  }

  getConfig() {
    // 1. Kiểm tra từ biến môi trường Vite hoặc Next.js
    const envUrl = import.meta.env?.VITE_SUPABASE_URL || import.meta.env?.NEXT_PUBLIC_SUPABASE_URL;
    const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || import.meta.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (envUrl && envKey && !envUrl.includes('YOUR_SUPABASE')) {
      return { url: envUrl.trim(), key: envKey.trim(), source: 'env' };
    }

    // 2. Kiểm tra từ LocalStorage
    try {
      const localUrl = localStorage.getItem(CONFIG_KEYS.URL);
      const localKey = localStorage.getItem(CONFIG_KEYS.KEY);
      if (localUrl && localKey) {
        return { url: localUrl.trim(), key: localKey.trim(), source: 'local' };
      }
    } catch (e) {}

    return null;
  }

  isConfigured() {
    return this.client !== null;
  }

  initClient() {
    const config = this.getConfig();
    if (config && config.url && config.key) {
      try {
        this.client = createClient(config.url, config.key, {
          auth: { persistSession: false }
        });
        console.log(`[Supabase] Đã khởi tạo kết nối Cloud (${config.source}): ${config.url}`);
        return true;
      } catch (err) {
        console.error('[Supabase] Lỗi khởi tạo client:', err);
        this.client = null;
      }
    }
    return false;
  }

  saveConfig(url, key) {
    if (!url || !key) {
      localStorage.removeItem(CONFIG_KEYS.URL);
      localStorage.removeItem(CONFIG_KEYS.KEY);
      this.client = null;
      return false;
    }

    localStorage.setItem(CONFIG_KEYS.URL, url.trim());
    localStorage.setItem(CONFIG_KEYS.KEY, key.trim());
    return this.initClient();
  }

  async testConnection(url, key) {
    try {
      const testClient = createClient(url.trim(), key.trim(), {
        auth: { persistSession: false }
      });
      const { data, error } = await testClient.from('members').select('id').limit(1);
      if (error) throw error;
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message || 'Không thể kết nối đến Supabase' };
    }
  }

  // --- API THÀNH VIÊN (MEMBERS) ---
  async fetchMembers() {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('members')
        .select('*')
        .order('elo', { ascending: false });

      if (error) throw error;

      return data.map(m => {
        let meta = {};
        if (m.phone && typeof m.phone === 'string' && m.phone.startsWith('{')) {
          try {
            meta = JSON.parse(m.phone);
          } catch (e) {}
        }

        return {
          id: m.id,
          name: m.name,
          nickname: m.nickname || '',
          gender: m.gender || 'male',
          frequency: m.frequency || 'regular',
          elo: m.elo || 1000,
          matchesPlayed: m.matches_played || 0,
          wins: m.wins || 0,
          losses: m.losses || 0,
          streak: m.streak || 0,
          avatar: m.avatar || '',
          joinedDate: m.joined_date || '',
          pinCode: m.pin_code || meta.pinCode || '',
          coins: m.coins !== undefined && m.coins !== null ? Number(m.coins) : (meta.coins !== undefined ? Number(meta.coins) : 100),
          role: m.role || meta.role || 'member',
          activeFrame: m.active_frame || meta.activeFrame || '',
          activeEloShield: m.active_elo_shield !== undefined ? !!m.active_elo_shield : !!meta.activeEloShield,
          _metaInventory: Array.isArray(meta.inventory) ? meta.inventory : []
        };
      });
    } catch (err) {
      console.error('[Supabase] Lỗi fetchMembers:', err);
      return null;
    }
  }

  _buildMemberPayload(member, inv = null) {
    let userInv = [];
    if (inv && Array.isArray(inv)) {
      userInv = inv.filter(i => i.memberId === member.id);
    } else {
      try {
        const raw = localStorage.getItem('cbb_thai_thinh_inventory_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            userInv = parsed.filter(i => i.memberId === member.id);
          }
        }
      } catch (e) {}
    }

    const meta = {
      activeFrame: member.activeFrame || '',
      activeEloShield: !!member.activeEloShield,
      coins: member.coins !== undefined ? Number(member.coins) : 100,
      role: member.role || 'member',
      pinCode: member.pinCode || '',
      inventory: userInv
    };

    return {
      id: member.id,
      name: member.name,
      nickname: member.nickname || '',
      gender: member.gender || 'male',
      frequency: member.frequency || 'regular',
      elo: Math.round(Number(member.elo) || 1000),
      matches_played: Number(member.matchesPlayed !== undefined ? member.matchesPlayed : member.matches_played) || 0,
      wins: Number(member.wins !== undefined ? member.wins : (member.wins || 0)) || 0,
      losses: Number(member.losses !== undefined ? member.losses : (member.losses || 0)) || 0,
      streak: Number(member.streak !== undefined ? member.streak : (member.streak || 0)) || 0,
      avatar: member.avatar || '',
      phone: JSON.stringify(meta),
      pin_code: member.pinCode || '',
      coins: member.coins !== undefined ? Number(member.coins) : 100,
      role: member.role || 'member',
      active_frame: member.activeFrame || '',
      active_elo_shield: !!member.activeEloShield,
      joined_date: member.joinedDate || (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })(),
      updated_at: new Date().toISOString()
    };
  }

  async upsertMember(member, inv = null) {
    if (!this.isConfigured()) return false;
    try {
      const payload = this._buildMemberPayload(member, inv);
      let { error } = await this.client
        .from('members')
        .upsert(payload);

      // Nếu database Supabase chưa chạy script thêm cột mới
      if (error && (error.message?.includes('pin_code') || error.message?.includes('coins') || error.message?.includes('role') || error.message?.includes('active_frame') || error.message?.includes('active_elo_shield'))) {
        delete payload.pin_code;
        delete payload.coins;
        delete payload.role;
        delete payload.active_frame;
        delete payload.active_elo_shield;
        const res = await this.client.from('members').upsert(payload);
        error = res.error;
      }

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi upsertMember:', err);
      return false;
    }
  }

  async upsertMembers(members, inv = null) {
    if (!this.isConfigured() || !Array.isArray(members) || members.length === 0) return false;
    try {
      const payloads = members.map(m => this._buildMemberPayload(m, inv));
      let { error } = await this.client
        .from('members')
        .upsert(payloads);

      if (error && (error.message?.includes('pin_code') || error.message?.includes('coins') || error.message?.includes('role') || error.message?.includes('active_frame') || error.message?.includes('active_elo_shield'))) {
        payloads.forEach(payload => {
          delete payload.pin_code;
          delete payload.coins;
          delete payload.role;
          delete payload.active_frame;
          delete payload.active_elo_shield;
        });
        const res = await this.client.from('members').upsert(payloads);
        error = res.error;
      }

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi batch upsertMembers:', err);
      return false;
    }
  }

  async deleteMember(id) {
    if (!this.isConfigured()) return false;
    try {
      const { error } = await this.client
        .from('members')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi deleteMember:', err);
      return false;
    }
  }

  // --- API LỊCH BUỔI ĐÁNH & SÂN ĐẤU (SESSIONS) ---
  async fetchSessions() {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('sessions')
        .select('*')
        .order('date', { ascending: false });

      if (error) throw error;

      return data.map(s => ({
        id: s.id,
        title: s.title || '',
        date: s.date,
        startTime: s.start_time || '',
        endTime: s.end_time || '',
        venueName: s.venue_name || '',
        venueAddress: s.venue_address || '',
        courtNumbers: s.court_numbers || '',
        feeNote: s.fee_note || '',
        rsvps: s.rsvps || {}
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchSessions:', err);
      return null;
    }
  }

  async upsertSession(session) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: session.id,
        title: session.title || '',
        date: session.date,
        start_time: session.startTime || '',
        end_time: session.endTime || '',
        venue_name: session.venueName || '',
        venue_address: session.venueAddress || '',
        court_numbers: session.courtNumbers || '',
        fee_note: session.feeNote || '',
        rsvps: session.rsvps || {}
      };

      const { error } = await this.client
        .from('sessions')
        .upsert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi upsertSession:', err);
      return false;
    }
  }

  async deleteSession(sessionId) {
    if (!this.isConfigured()) return false;
    try {
      const { error } = await this.client
        .from('sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi deleteSession:', err);
      return false;
    }
  }

  // --- API LỊCH SỬ TRẬN ĐẤU (MATCHES) ---
  async fetchMatches() {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('matches')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) throw error;

      return data.map(m => ({
        id: m.id,
        timestamp: Number(m.timestamp),
        courtNumber: m.court_number || '',
        team1: m.team1,
        team2: m.team2,
        score1: m.score1,
        score2: m.score2,
        eloChange: m.elo_change,
        isDeuce: m.is_deuce
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchMatches:', err);
      return null;
    }
  }

  async insertMatch(match) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: match.id,
        timestamp: match.timestamp,
        court_number: match.courtNumber || '',
        team1: match.team1,
        team2: match.team2,
        score1: match.score1,
        score2: match.score2,
        elo_change: match.eloChange || 16,
        is_deuce: !!match.isDeuce
      };

      const { error } = await this.client
        .from('matches')
        .insert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi insertMatch:', err);
      return false;
    }
  }

  async deleteMatch(id) {
    if (!this.isConfigured()) return false;
    try {
      const { error } = await this.client
        .from('matches')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi deleteMatch:', err);
      return false;
    }
  }

  // --- API ĐIỂM DANH (ATTENDANCE) ---
  async fetchAttendance(dateStr) {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('attendance')
        .select('*')
        .eq('date', dateStr)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const rawGames = data.games_played_today || {};
      const guests = Array.isArray(rawGames._guest_profiles) ? rawGames._guest_profiles : [];
      const cleanGamesPlayed = { ...rawGames };
      delete cleanGamesPlayed._guest_profiles;

      return {
        date: data.date,
        presentIds: data.present_ids || [],
        gamesPlayedToday: cleanGamesPlayed,
        guests
      };
    } catch (err) {
      console.error('[Supabase] Lỗi fetchAttendance:', err);
      return null;
    }
  }

  async saveAttendance(attendance) {
    if (!this.isConfigured()) return false;
    try {
      const rawGames = { ...(attendance.gamesPlayedToday || {}) };
      if (Array.isArray(attendance.guests)) {
        rawGames._guest_profiles = attendance.guests;
      }

      const payload = {
        date: attendance.date,
        present_ids: attendance.presentIds || [],
        games_played_today: rawGames,
        updated_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from('attendance')
        .upsert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi saveAttendance:', err);
      return false;
    }
  }

  // --- API TRẬN ĐẤU ĐANG DIỄN RA TRÊN SÂN (LIVE_COURT) ---
  async fetchLiveCourt(courtId = 'current_court') {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('live_court')
        .select('*')
        .eq('id', courtId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        courtNumber: data.court_number || 'Sân 1',
        team1Ids: data.team1 || [],
        team2Ids: data.team2 || [],
        score1: data.score1 || 0,
        score2: data.score2 || 0,
        mode: data.matchmaker_mode || 'balanced',
        status: data.status || 'in_progress',
        diffElo: data.diff_elo || 0,
        updatedAt: data.updated_at
      };
    } catch (err) {
      console.error('[Supabase] Lỗi fetchLiveCourt:', err);
      return null;
    }
  }

  async saveLiveCourt(match, courtId = 'current_court') {
    if (!this.isConfigured()) return false;
    try {
      const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
      let payload;

      const mapSlotToId = (p) => {
        if (!p) return '';
        return typeof p === 'object' ? (p.id || '') : String(p);
      };

      const rawT1 = Array.isArray(match?.team1) 
        ? match.team1.map(mapSlotToId) 
        : (Array.isArray(match?.team1Ids) ? match.team1Ids.map(mapSlotToId) : []);

      const rawT2 = Array.isArray(match?.team2) 
        ? match.team2.map(mapSlotToId) 
        : (Array.isArray(match?.team2Ids) ? match.team2Ids.map(mapSlotToId) : []);

      const hasValidT1 = rawT1.some(id => id && id.trim() !== '');
      const hasValidT2 = rawT2.some(id => id && id.trim() !== '');
      const hasAnyPlayer = hasValidT1 || hasValidT2;

      const isIdle = !match || !hasAnyPlayer;

      if (isIdle) {
        payload = {
          id: courtId,
          court_number: match?.courtNumber || courtName,
          team1: [],
          team2: [],
          score1: 0,
          score2: 0,
          matchmaker_mode: match?.mode || match?.matchmakerMode || 'balanced',
          status: 'idle',
          diff_elo: 0,
          updated_at: new Date().toISOString()
        };
      } else {
        const score1 = Number(match.score1) || 0;
        const score2 = Number(match.score2) || 0;
        let matchStatus = match.status || match.matchStatus;
        if (score1 > 0 || score2 > 0) {
          matchStatus = 'in_progress';
        } else if (!matchStatus || matchStatus === 'idle') {
          const totalValid = rawT1.filter(Boolean).length + rawT2.filter(Boolean).length;
          matchStatus = totalValid === 4 ? 'ready' : 'idle';
        }

        payload = {
          id: courtId,
          court_number: match.courtNumber || courtName,
          team1: rawT1,
          team2: rawT2,
          score1,
          score2,
          matchmaker_mode: match.mode || match.matchmakerMode || 'balanced',
          status: matchStatus,
          diff_elo: Number(match.diffElo) || 0,
          updated_at: new Date().toISOString()
        };
      }

      const { error } = await this.client
        .from('live_court')
        .upsert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi saveLiveCourt:', err);
      return false;
    }
  }

  // --- API CẤU HÌNH & THÔNG BÁO CLB (CLUB_SETTINGS) ---
  async fetchClubSettings() {
    if (!this.isConfigured()) return null;
    try {
      const { data, error } = await this.client
        .from('club_settings')
        .select('*')
        .eq('id', 'thai_thinh')
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        clubName: data.club_name || 'CLB Cầu Lông Thái Thịnh',
        announcement: data.announcement || '',
        defaultVenue: data.default_venue || '',
        defaultAddress: data.default_address || '',
        kFactor: data.k_factor || 32,
        updatedAt: data.updated_at
      };
    } catch (err) {
      console.error('[Supabase] Lỗi fetchClubSettings:', err);
      return null;
    }
  }

  async saveClubSettings(settings) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: 'thai_thinh',
        club_name: settings.clubName || 'CLB Cầu Lông Thái Thịnh',
        announcement: settings.announcement || '',
        default_venue: settings.defaultVenue || '',
        default_address: settings.defaultAddress || '',
        k_factor: Number(settings.kFactor) || 32,
        updated_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from('club_settings')
        .upsert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi saveClubSettings:', err);
      return false;
    }
  }

  // --- API GIAO DỊCH XU (COIN_TRANSACTIONS - GIAI ĐOẠN 1) ---
  async fetchCoinTransactions(memberId = null) {
    if (!this.isConfigured()) return null;
    try {
      let query = this.client
        .from('coin_transactions')
        .select('*')
        .order('created_at', { ascending: false });

      if (memberId) {
        query = query.eq('member_id', memberId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data.map(tx => ({
        id: tx.id,
        memberId: tx.member_id,
        amount: tx.amount,
        balanceAfter: tx.balance_after,
        type: tx.type,
        description: tx.description || '',
        createdAt: tx.created_at
      }));
    } catch (err) {
      return null;
    }
  }

  async insertCoinTransaction(tx) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: tx.id,
        member_id: tx.memberId,
        amount: tx.amount,
        balance_after: tx.balanceAfter,
        type: tx.type,
        description: tx.description || '',
        created_at: tx.createdAt || new Date().toISOString()
      };

      const { error } = await this.client
        .from('coin_transactions')
        .insert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      return false;
    }
  }

  async deleteCoinTransactionsByType(type) {
    if (!this.isConfigured()) return false;
    try {
      const { error } = await this.client
        .from('coin_transactions')
        .delete()
        .eq('type', type);
      if (error) throw error;
      return true;
    } catch (err) {
      return false;
    }
  }

  // --- API DỰ ĐOÁN & CƯỢC VUI (BETS - GIAI ĐOẠN 2) ---
  async fetchBets(courtId = null) {
    if (!this.isConfigured()) return null;
    try {
      let query = this.client
        .from('bets')
        .select('*')
        .order('created_at', { ascending: false });

      if (courtId) {
        query = query.eq('court_id', courtId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data.map(b => ({
        id: b.id,
        courtId: b.court_id,
        matchId: b.match_id || '',
        memberId: b.member_id,
        predictedTeam: b.predicted_team,
        amount: Number(b.amount) || 10,
        odds: Number(b.odds) || 1.9,
        potentialPayout: Number(b.potential_payout) || 19,
        status: b.status || 'pending',
        createdAt: b.created_at
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchBets:', err);
      return null;
    }
  }

  async insertBet(bet) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: bet.id,
        court_id: bet.courtId,
        match_id: bet.matchId || null,
        member_id: bet.memberId,
        predicted_team: bet.predictedTeam,
        amount: Number(bet.amount),
        odds: Number(bet.odds),
        potential_payout: Number(bet.potentialPayout),
        status: bet.status || 'pending',
        created_at: bet.createdAt || new Date().toISOString()
      };

      const { error } = await this.client
        .from('bets')
        .insert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi insertBet:', err);
      return false;
    }
  }

  async updateBet(betId, updates) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {};
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.matchId !== undefined) payload.match_id = updates.matchId;

      const { error } = await this.client
        .from('bets')
        .update(payload)
        .eq('id', betId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi updateBet:', err);
      return false;
    }
  }

  // --- API TÚI ĐỒ & VẬT PHẨM (USER_INVENTORY - GIAI ĐOẠN 3) ---
  async fetchInventory(memberId = null) {
    if (!this.isConfigured()) return null;
    try {
      let query = this.client
        .from('user_inventory')
        .select('*');

      if (memberId) {
        query = query.eq('member_id', memberId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data.map(item => ({
        id: item.id,
        memberId: item.member_id,
        itemId: item.item_id,
        itemType: item.item_type,
        quantity: Number(item.quantity) || 1,
        status: item.status || 'available',
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchInventory:', err);
      return null;
    }
  }

  async upsertInventoryItem(item) {
    if (!this.isConfigured()) return false;
    try {
      const payload = {
        id: item.id,
        member_id: item.memberId,
        item_id: item.itemId,
        item_type: item.itemType,
        quantity: Number(item.quantity) || 1,
        status: item.status || 'available',
        updated_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from('user_inventory')
        .upsert(payload);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi upsertInventoryItem:', err);
      return false;
    }
  }

  async deleteInventoryItem(id) {
    if (!this.isConfigured()) return false;
    try {
      const { error } = await this.client
        .from('user_inventory')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Supabase] Lỗi deleteInventoryItem:', err);
      return false;
    }
  }

  // --- REALTIME SUBSCRIPTIONS (TỰ ĐỘNG ĐỒNG BỘ CÁC BẢNG DỮ LIỆU) ---
  subscribeToChanges(onChangeCallback) {
    if (!this.isConfigured()) return;
    this.lastOnChangeCallback = onChangeCallback;

    if (this.realtimeChannel) {
      try {
        this.client.removeChannel(this.realtimeChannel);
      } catch (e) {}
    }

    this.realtimeChannel = this.client
      .channel('thai-thinh-realtime-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (payload) => {
        onChangeCallback('members', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) => {
        onChangeCallback('sessions', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        onChangeCallback('matches', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, (payload) => {
        onChangeCallback('attendance', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_court' }, (payload) => {
        onChangeCallback('live_court', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_settings' }, (payload) => {
        onChangeCallback('club_settings', payload);
      })
      .subscribe((status) => {
        console.log('[Supabase Realtime] Trạng thái kênh đồng bộ realtime:', status);
      });
  }

  ensureRealtimeSubscription() {
    if (!this.isConfigured() || !this.lastOnChangeCallback) return;
    const channelState = this.realtimeChannel?.state;
    if (!this.realtimeChannel || channelState === 'closed' || channelState === 'errored') {
      console.log('[Supabase Realtime] Tự động kết nối lại kênh Realtime sau trạng thái:', channelState);
      this.subscribeToChanges(this.lastOnChangeCallback);
    }
  }
}

export const supabaseService = new SupabaseService();
