/**
 * supabase.js - Dịch vụ kết nối Cloud Database Supabase & Đồng bộ Realtime (Pro Edition)
 */

import { createClient } from '@supabase/supabase-js';
import { encodeMatchCourt, decodeMatchCourt } from './match-record.js';

const CONFIG_KEYS = {
  URL: 'cbb_supabase_url',
  KEY: 'cbb_supabase_key'
};

class SupabaseService {
  constructor() {
    this.client = null;
    this.realtimeChannel = null;
    this.memberWriteQueues = new Map();
    this.courtWriteQueues = new Map();
    this.walletVersion = 0;
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

  getSessionToken() { return localStorage.getItem('cbb_club_session_v3') || ''; }
  saveSession(data) {
    if (data?.token) localStorage.setItem('cbb_club_session_v3',data.token);
  }
  async login(memberId,pin) {
    const {data,error}=await this.client.rpc('club_login',{p_member_id:memberId,p_pin:pin});
    if(error) return {success:false,message:'Chưa xác minh được đăng nhập. Vui lòng thử lại.'};
    if(data.success) this.saveSession(data);
    return data;
  }
  async logout() {
    try { await this.client?.rpc('club_logout'); } finally { localStorage.removeItem('cbb_club_session_v3'); }
  }
  async fetchAll(table,sort='id',ascending=true) {
    const rows=[];
    for(let offset=0;;offset+=200){
      let q=this.client.from(table).select('*').order(sort,{ascending});
      if(sort!=='id') q=q.order('id',{ascending:true});
      const {data,error}=await q.range(offset,offset+199);
      if(error)throw error;
      rows.push(...data);if(data.length<200)return rows;
    }
  }
  async mutation(name,args) {
    const r=await this.walletAction(name,args);
    if(!r.success)throw new Error(r.message);
    return r.data;
  }
  async patchMember(id,patch,expected) {
    await this.mutation('club_patch_member',{p_member_id:id,p_patch:patch,p_expected_updated_at:expected||null});
    return true;
  }
  async createMember(payload) {
    const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const key='cbb_registration_request';
    let pending;try{pending=JSON.parse(localStorage.getItem(key)||'null');}catch{}
    if(pending?.fingerprint!==fingerprint)pending={fingerprint,id:'register_'+crypto.randomUUID()};
    localStorage.setItem(key,JSON.stringify(pending));
    const {data,error}=await this.client.rpc('club_create_member',{p_payload:{...payload,requestId:pending.id}});
    if(error){if(['P0001','23505','28000','42501','22023'].includes(error.code))localStorage.removeItem(key);throw new Error(error.message);}
    if(!data?.success||!data.memberId)throw new Error('Chưa xác nhận được đăng ký. Vui lòng thử lại.');
    localStorage.removeItem(key);this.saveSession(data);return data;
  }
  async score(id,matchId,action,values,requestId) {
    const previous=this.courtWriteQueues.get(id)||Promise.resolve();
    const write=previous.catch(()=>{}).then(async()=>{
      const args={p_id:requestId,p_court_id:id,p_match_id:matchId,p_action:action,p_values:values};
      let result=await this.walletAction('club_score',args);
      if(!result.success&&!result.definite)result=await this.walletAction('club_score',args);
      if(!result.success)throw Object.assign(new Error(result.message),{definite:!!result.definite});return result.data;
    });
    this.courtWriteQueues.set(id,write);
    try{return await write;}finally{if(this.courtWriteQueues.get(id)===write)this.courtWriteQueues.delete(id);}
  }
  async attendanceAction(action,payload) {
    return this.mutation('club_attendance_action',{p_id:'att_'+crypto.randomUUID(),p_action:action,p_payload:payload});
  }
  async rsvp(sessionId,memberId,status) {
    return this.mutation('club_rsvp',{p_session_id:sessionId,p_member_id:memberId,p_status:status});
  }

  async checkWalletVersion() {
    if (!this.isConfigured()) return 0;
    const { data, error } = await this.client.rpc('club_wallet_version');
    this.walletVersion = error ? 0 : Number(data);
    return this.walletVersion;
  }

  async giftOctober20Frames() {
    // Existing gifts/choices are preserved. Opening the application is read-only.
    return {success:true,count:0};
  }

  async walletAction(name, args) {
    if (this.walletVersion !== 3 && await this.checkWalletVersion() !== 3) {
      return { success: false, message: 'Hệ thống xu đang được nâng cấp. Vui lòng thử lại sau.' };
    }
    try {
      const { data, error } = await this.client.rpc(name, args);
      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      if(error.code==='28000'){
        localStorage.removeItem('cbb_club_session_v3');
        localStorage.removeItem('cbb_thai_thinh_current_user_id_v1');
        if(typeof window!=='undefined')window.dispatchEvent(new Event('club:auth-required'));
      }
      return { success: false, definite: ['P0001','23505','28000','42501'].includes(error.code), message: error.message || 'Chưa lưu được giao dịch. Vui lòng kiểm tra mạng và thử lại.' };
    }
  }

  initClient() {
    const config = this.getConfig();
    if (config && config.url && config.key) {
      try {
        this.client = createClient(config.url, config.key, {
          auth: { persistSession: false },
          global:{fetch:(url,init={})=>{
            const headers=new Headers(init.headers);
            const token=this.getSessionToken();if(token)headers.set('x-club-session',token);
            return fetch(url,{...init,headers});
          }}
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
      const { data, error } = await testClient.rpc('club_members_public');
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
      const { data, error } = await this.client.rpc('club_members_public');

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
          pinCode: '',
          hasPin:!!m.has_pin,
          updatedAt:m.updated_at,
          coins: m.coins !== undefined && m.coins !== null ? Number(m.coins) : (meta.coins !== undefined ? Number(meta.coins) : 100),
          role: m.id === 'mem_1789569517045' ? 'admin' : 'member',
          activeFrame: m.active_frame ?? meta.activeFrame ?? '',
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

    const isLong = member.id === 'mem_1789569517045' || (member.name && member.name.toLowerCase().includes('đỗ long'));
    const meta = {
      activeFrame: member.activeFrame || '',
      activeEloShield: !!member.activeEloShield,
      coins: member.coins !== undefined ? Number(member.coins) : 100,
      role: isLong ? 'admin' : 'member',
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

  async upsertMember(member) {
    // Compatibility for explicit profile edits only; never upload statistics.
    const patch=Object.fromEntries(['name','nickname','gender','frequency','avatar'].filter(k=>member[k]!==undefined).map(k=>[k,member[k]]));
    return this.patchMember(member.id,patch,member.updatedAt);
  }

  async upsertMembers() { throw new Error('Không được ghi toàn bộ hồ sơ từ bộ nhớ cũ.'); }

  async deleteMember(id) { return this.mutation('club_delete_member',{p_member_id:id}); }

  async fetchSessions() {
    if (!this.isConfigured()) return null;
    try {
      const data=await this.fetchAll('sessions','date',false);

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
        rsvps: s.rsvps || {},
        updatedAt:s.updated_at
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchSessions:', err);
      return null;
    }
  }

  async upsertSession(session) {
    const payload={id:session.id,title:session.title||'',date:session.date,start_time:session.startTime||'',end_time:session.endTime||'',venue_name:session.venueName||'',venue_address:session.venueAddress||'',court_numbers:session.courtNumbers||'',fee_note:session.feeNote||''};
    return this.mutation('club_save_session',{p_payload:payload,p_expected_updated_at:session.updatedAt||null});
  }

  async deleteSession(id) { return this.mutation('club_delete_session',{p_session_id:id}); }

  async fetchMatches() {
    if (!this.isConfigured()) return null;
    try {
      const data=await this.fetchAll('matches','timestamp',false);

      return data.map(m => {
        return {
          id: m.id,
          timestamp: Number(m.timestamp),
          ...decodeMatchCourt(m.court_number || ''),
          team1: m.team1,
          team2: m.team2,
          score1: m.score1,
          score2: m.score2,
          eloChange: m.elo_change,
          isDeuce: m.is_deuce
        };
      });
    } catch (err) {
      console.error('[Supabase] Lỗi fetchMatches:', err);
      return null;
    }
  }

  async insertMatch(match) {
    const data=await this.mutation('club_finish_match',{p_match_id:match.id,p_score1:match.score1,p_score2:match.score2});
    if(!data?.id||data.id!==match.id)throw new Error('Chưa xác nhận được kết quả trận. Vui lòng tải lại để kiểm tra.');
    return {...data,...decodeMatchCourt(data.court_number||'')};
  }

  async deleteMatch(id) { return this.mutation('club_undo_match',{p_match_id:id}); }

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

  async saveAttendance() { throw new Error('Điểm danh phải cập nhật theo từng thao tác đã xác nhận.'); }

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
        matchId: data.match_id,
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

  async saveLiveCourt(match, courtId = 'current_court', expectedId = null) {
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

      if (match?.matchId) payload.match_id = match.matchId;
      const previous = this.courtWriteQueues.get(courtId) || Promise.resolve();
      const write = previous.catch(()=>{}).then(()=>this.walletAction('club_save_court',{p_payload:payload,p_expected_id:expectedId}));
      this.courtWriteQueues.set(courtId,write);
      let result;
      try { result = await write; }
      finally { if (this.courtWriteQueues.get(courtId) === write) this.courtWriteQueues.delete(courtId); }
      if (!result.success) throw new Error(result.message);
      const data = result.data;
      if (match && data?.match_id) {
        match.matchId=data.match_id;match.score1=data.score1;match.score2=data.score2;
        match.status=data.status;match.matchStatus=data.status;
      }
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
    return this.mutation('club_save_settings',{p_payload:{club_name:settings.clubName,announcement:settings.announcement,default_venue:settings.defaultVenue,default_address:settings.defaultAddress,k_factor:settings.kFactor}});
  }

  async fetchCoinTransactions(memberId = null) {
    if (!this.isConfigured()) return null;
    try {
      const data=(await this.fetchAll('coin_transactions','created_at',false)).filter(tx=>!memberId||tx.member_id===memberId);

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

  async insertCoinTransaction() { return false; }

  async deleteCoinTransactionsByType() { return false; }

  async fetchBets(courtId = null) {
    if (!this.isConfigured()) return null;
    try {
      const data=(await this.fetchAll('bets','created_at',false)).filter(b=>!courtId||b.court_id===courtId);

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

  async insertBet() { return false; }

  async updateBet() { return false; }

  async fetchInventory(memberId = null) {
    if (!this.isConfigured()) return null;
    try {
      const data=(await this.fetchAll('user_inventory')).filter(i=>!memberId||i.member_id===memberId);

      return data.map(item => ({
        id: item.id,
        memberId: item.member_id,
        itemId: item.item_id,
        itemType: item.item_type,
        quantity: Math.max(0, Number(item.quantity ?? 1) || 0),
        status: item.status || 'available',
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }));
    } catch (err) {
      console.error('[Supabase] Lỗi fetchInventory:', err);
      return null;
    }
  }

  async upsertInventoryItem() { throw new Error('Vật phẩm phải được cập nhật bằng thao tác máy chủ.'); }

  async deleteInventoryItem() { return false; }

  subscribeToChanges(onChangeCallback) {
    if (!this.isConfigured()) return;
    this.lastOnChangeCallback = onChangeCallback;
    // Public member RPC omits credentials. Member rows are deliberately not
    // broadcast because legacy phone metadata contains private PINs.
    if(typeof document!=='undefined'){
      clearInterval(this.profilePoll);
      this.profilePoll=setInterval(()=>{if(document.visibilityState==='visible')onChangeCallback('members',{});},15000);
    }

    if (this.realtimeChannel) {
      try {
        this.client.removeChannel(this.realtimeChannel);
      } catch (e) {}
    }

    this.realtimeChannel = this.client
      .channel('thai-thinh-realtime-channel')
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coin_transactions' }, (payload) => {
        onChangeCallback('coin_transactions', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, (payload) => {
        onChangeCallback('bets', payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_inventory' }, (payload) => {
        onChangeCallback('user_inventory', payload);
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
