import confetti from 'canvas-confetti';
import { StorageService, getLocalDateStr, SHOP_ITEMS } from './storage.js';
import { calculateDoublesElo, calculateBadges, getTierByElo, getNextTier, getPlayerDetailedStats, calculateBettingOdds, TIERS } from './elo.js';
import { processImageFile, generateDefaultAvatar, getAvatarUrl, renderAvatarHtml } from './avatar.js';
import { MatchmakerService } from './matchmaker.js';
import { SoundService } from './sound.js';
import { supabaseService } from './supabase.js';

window.StorageService = StorageService;
window.getLocalDateStr = getLocalDateStr;

// Khai báo sớm appOpenAddGuestModal để luôn sẵn sàng trên toàn window
window.appOpenAddGuestModal = function() {
  try {
    const modal = document.getElementById('modal-add-guest');
    if (!modal) {
      console.warn('Không tìm thấy #modal-add-guest trong DOM');
      return;
    }
    const nameInput = document.getElementById('field-guest-name');
    const genderInput = document.getElementById('field-guest-gender');
    const eloInput = document.getElementById('field-guest-elo');
    if (nameInput) nameInput.value = '';
    if (genderInput) genderInput.value = 'male';
    if (eloInput) eloInput.value = '1000';
    modal.classList.add('open');
    if (SoundService && SoundService.playClick) SoundService.playClick();
    if (nameInput) setTimeout(() => nameInput.focus(), 150);
  } catch (err) {
    console.error('Lỗi mở modal thêm khách:', err);
  }
};

// Trạng thái ứng dụng (Application State)
const state = {
  currentTab: 'court',
  currentCourtId: 'court_1', // 'court_1' | 'court_2'
  betting: {
    selectedTeam: 'team1', // 'team1' | 'team2'
    selectedAmount: 20 // 10 | 20 | 30
  },
  courtMatches: {
    court_1: {
      activeMatch: { team1: [null, null], team2: [null, null] },
      score1: 0,
      score2: 0,
      mode: 'balanced',
      matchStatus: 'idle',
      scoreHistory: [],
      isSwappedSides: false
    },
    court_2: {
      activeMatch: { team1: [null, null], team2: [null, null] },
      score1: 0,
      score2: 0,
      mode: 'balanced',
      matchStatus: 'idle',
      scoreHistory: [],
      isSwappedSides: false
    }
  },
  get activeMatch() {
    return this.courtMatches[this.currentCourtId]?.activeMatch || null;
  },
  set activeMatch(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].activeMatch = val;
    }
  },
  get score1() {
    return this.courtMatches[this.currentCourtId]?.score1 ?? 0;
  },
  set score1(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].score1 = val;
    }
  },
  get score2() {
    return this.courtMatches[this.currentCourtId]?.score2 ?? 0;
  },
  set score2(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].score2 = val;
    }
  },
  get matchmakerMode() {
    return this.courtMatches[this.currentCourtId]?.mode || 'balanced';
  },
  set matchmakerMode(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].mode = val;
    }
  },
  get matchStatus() {
    return this.courtMatches[this.currentCourtId]?.matchStatus || 'idle';
  },
  set matchStatus(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].matchStatus = val;
    }
  },
  get isSwappedSides() {
    return this.courtMatches[this.currentCourtId]?.isSwappedSides || false;
  },
  set isSwappedSides(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].isSwappedSides = val;
    }
  },
  get scoreHistory() {
    if (!this.courtMatches[this.currentCourtId].scoreHistory) {
      this.courtMatches[this.currentCourtId].scoreHistory = [];
    }
    return this.courtMatches[this.currentCourtId].scoreHistory;
  },
  set scoreHistory(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].scoreHistory = val;
    }
  },
  leaderboardSort: 'elo',
  leaderboardGender: 'all', // 'all' | 'male' | 'female'
  searchQuery: '',
  editingMemberId: null,
  editingSessionId: null,
  tempAvatarBase64: null,
  calendarViewMode: 'grid', // 'grid' | 'list'
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0 - 11
  calendarSelectedDate: getLocalDateStr(),
  currentUser: null
};

let debouncedSyncLiveScore = () => {};

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initTheme();
  setupEventListeners();
  loadInitialState();
  state.currentUser = StorageService.getCurrentUser();
  renderUserAuthHeader();
  const urlTab = new URLSearchParams(window.location.search).get('tab') || window.location.hash.replace('#', '');
  if (['court', 'sessions', 'leaderboard', 'attendance', 'members', 'history'].includes(urlTab)) {
    switchTab(urlTab);
  } else {
    switchTab('court');
  }
  updateSessionStatusBadge();
  initCloudSyncAndRealtime();
}

/**
 * Khởi tạo giao diện Sáng / Tối
 */
function initTheme() {
  const savedTheme = localStorage.getItem('cbb_thai_thinh_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButton(savedTheme);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('btn-toggle-theme');
  if (btn) {
    if (theme === 'dark') {
      btn.innerHTML = '☀️';
      btn.title = 'Chuyển sang giao diện Sáng';
    } else {
      btn.innerHTML = '🌙';
      btn.title = 'Chuyển sang giao diện Tối';
    }
  }
}

/**
 * Nạp trạng thái ban đầu từ Storage cho 2 Sân (Sân 1 & Sân 2)
 */
function loadInitialState() {
  const initCourt = (courtId, courtName) => {
    const saved = StorageService.getActiveMatch(courtId);
    const hasAny = saved && (
      (Array.isArray(saved.team1) && saved.team1.some(Boolean)) ||
      (Array.isArray(saved.team2) && saved.team2.some(Boolean))
    );
    if (saved && hasAny) {
      const s1 = Number(saved.score1) || 0;
      const s2 = Number(saved.score2) || 0;
      const validTotal = (saved.team1?.filter(Boolean).length || 0) + (saved.team2?.filter(Boolean).length || 0);
      let st = saved.matchStatus || saved.status;
      if (s1 > 0 || s2 > 0) st = 'in_progress';
      else if (!st || st === 'idle') st = validTotal === 4 ? 'ready' : 'idle';

      state.courtMatches[courtId].activeMatch = {
        courtNumber: saved.courtNumber || courtName,
        team1: Array.isArray(saved.team1) ? saved.team1 : [null, null],
        team2: Array.isArray(saved.team2) ? saved.team2 : [null, null],
        score1: s1,
        score2: s2,
        mode: saved.mode || 'balanced',
        status: st,
        matchStatus: st,
        diffElo: Number(saved.diffElo) || 0,
        isSwappedSides: !!saved.isSwappedSides
      };
      state.courtMatches[courtId].score1 = s1;
      state.courtMatches[courtId].score2 = s2;
      state.courtMatches[courtId].mode = saved.mode || 'balanced';
      state.courtMatches[courtId].matchStatus = st;
      state.courtMatches[courtId].isSwappedSides = !!saved.isSwappedSides;
      state.courtMatches[courtId].scoreHistory = [];
    } else {
      state.courtMatches[courtId].activeMatch = {
        courtNumber: courtName,
        team1: [null, null],
        team2: [null, null],
        score1: 0,
        score2: 0,
        status: 'idle',
        matchStatus: 'idle',
        diffElo: 0,
        isSwappedSides: false
      };
      state.courtMatches[courtId].score1 = 0;
      state.courtMatches[courtId].score2 = 0;
      state.courtMatches[courtId].matchStatus = 'idle';
      state.courtMatches[courtId].scoreHistory = [];
    }
  };

  initCourt('court_1', 'Sân 1');
  initCourt('court_2', 'Sân 2');
  updateCourtTabStatusPills();
}

function updateCourtTabStatusPills() {
  const p1 = document.getElementById('court-1-status-text');
  const p2 = document.getElementById('court-2-status-text');
  const m1 = state.courtMatches.court_1.activeMatch;
  const m2 = state.courtMatches.court_2.activeMatch;
  const s1_1 = Number(state.courtMatches.court_1.score1) || 0;
  const s1_2 = Number(state.courtMatches.court_1.score2) || 0;
  const s2_1 = Number(state.courtMatches.court_2.score1) || 0;
  const s2_2 = Number(state.courtMatches.court_2.score2) || 0;

  const hasP1 = m1 && ((Array.isArray(m1.team1) && m1.team1.some(Boolean)) || (Array.isArray(m1.team2) && m1.team2.some(Boolean)));
  const hasP2 = m2 && ((Array.isArray(m2.team1) && m2.team1.some(Boolean)) || (Array.isArray(m2.team2) && m2.team2.some(Boolean)));

  if (p1) {
    if (hasP1) {
      p1.innerHTML = `<strong style="font-size: 0.95rem; font-weight: 800; letter-spacing: 0.5px;">${s1_1} - ${s1_2}</strong>`;
      p1.style.color = 'var(--volt)';
    } else {
      p1.textContent = 'Đang trống';
      p1.style.color = 'var(--text-dim)';
    }
  }

  if (p2) {
    if (hasP2) {
      p2.innerHTML = `<strong style="font-size: 0.95rem; font-weight: 800; letter-spacing: 0.5px;">${s2_1} - ${s2_2}</strong>`;
      p2.style.color = 'var(--cyan)';
    } else {
      p2.textContent = 'Đang trống';
      p2.style.color = 'var(--text-dim)';
    }
  }
}

function switchCourt(courtId) {
  state.currentCourtId = courtId;
  document.querySelectorAll('.court-switch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.courtId === courtId);
  });

  // Cập nhật net badge
  const netBadge = document.querySelector('.net-badge');
  if (netBadge) {
    netBadge.textContent = courtId === 'court_2' ? 'LƯỚI THÁI THỊNH - SÂN 2' : 'LƯỚI THÁI THỊNH - SÂN 1';
  }

  // Cập nhật chế độ ghép cặp mode-btn theo sân hiện tại
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.matchmakerMode);
  });

  renderCourt();
  updateScoreboardDisplay();
  renderEloPrediction();
  updateCourtTabStatusPills();
}

/**
 * Thiết lập các bộ lắng nghe sự kiện (Event Listeners)
 */
function setupEventListeners() {
  // 1. Chuyển Tab (Desktop & Mobile)
  document.querySelectorAll('.nav-tab-btn, .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = btn.dataset.tab;
      if (tab) {
        SoundService.playClick();
        switchTab(tab);
      }
    });
  });

  // 1b. Chuyển Sân Song Song (Sân 1 <-> Sân 2)
  document.querySelectorAll('.court-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const courtId = btn.dataset.courtId;
      if (courtId && courtId !== state.currentCourtId) {
        SoundService.playClick();
        switchCourt(courtId);
      }
    });
  });

  // 1c. Nút Ghép Cả 2 Sân (8 Người)
  const btnSpinBoth = document.getElementById('btn-spin-dual-courts');
  if (btnSpinBoth) {
    btnSpinBoth.addEventListener('click', spinBothCourts);
  }

  // 1d. Nút Mở Quỹ Cầu Lông MoMo / VietQR
  const btnOpenFund = document.getElementById('btn-open-club-fund');
  const modalFund = document.getElementById('modal-club-fund');
  if (btnOpenFund && modalFund) {
    btnOpenFund.addEventListener('click', () => {
      SoundService.playClick();
      modalFund.classList.add('open');
    });
  }

  // 1e. Nút Sao Chép trong Quỹ CLB
  document.querySelectorAll('.btn-copy-fund').forEach(btn => {
    btn.addEventListener('click', () => {
      const copyVal = btn.dataset.copy;
      if (copyVal) {
        navigator.clipboard.writeText(copyVal).then(() => {
          const orig = btn.innerHTML;
          btn.innerHTML = '✅';
          setTimeout(() => { btn.innerHTML = orig; }, 1500);
          showToast(`Đã sao chép: ${copyVal}`);
        }).catch(() => {
          showToast(`Sao chép: ${copyVal}`);
        });
      }
    });
  });

  // 2. Chuyển chế độ Xếp Cặp (Mode Selector)
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.matchmakerMode = btn.dataset.mode;
      SoundService.playClick();
      showToast(`Chế độ xếp: ${btn.textContent.trim()}`);
    });
  });

  // 3. Nút Tạo Trận Mới
  const btnGenMatch = document.getElementById('btn-generate-match');
  if (btnGenMatch) {
    btnGenMatch.addEventListener('click', () => {
      generateNewMatch(true);
    });
  }

  // 4. Nút Đổi Kèo / Hoán đổi
  const btnSwap = document.getElementById('btn-swap-teams');
  if (btnSwap) {
    btnSwap.addEventListener('click', () => {
      if (state.activeMatch && state.activeMatch.team1 && state.activeMatch.team2) {
        if (state.activeMatch.team1.some(p => !p) || state.activeMatch.team2.some(p => !p)) {
          showToast('Cần chọn đủ 4 VĐV để hoán đổi người giữa 2 đội!', 'info');
          return;
        }
        StorageService.refundMatchBets(state.currentCourtId, 'Đổi đội hình thi đấu');
        const swapped = MatchmakerService.swapPlayers(state.activeMatch.team1, state.activeMatch.team2, 0, 0);
        state.activeMatch.team1 = swapped.team1;
        state.activeMatch.team2 = swapped.team2;
        state.activeMatch.diffElo = swapped.diffElo;
        StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
        SoundService.playClick();
        renderCourt();
        updateCourtTabStatusPills();
        showToast('Đã đổi người giữa 2 đội! Các vé cược cũ đã được hoàn lại.');
      }
    });
  }

  // 5. Điều chỉnh Tỷ số & Bấm điểm Trong Sân (Realtime)
  let syncScoreTimeout = null;
  debouncedSyncLiveScore = () => {
    if (!state.activeMatch) return;
    state.activeMatch.score1 = state.score1;
    state.activeMatch.score2 = state.score2;
    state.activeMatch.matchStatus = state.matchStatus;
    state.activeMatch.isSwappedSides = state.isSwappedSides;
    StorageService.saveLocalActiveMatch(state.activeMatch, state.currentCourtId);
    updateCourtTabStatusPills();

    if (syncScoreTimeout) clearTimeout(syncScoreTimeout);
    syncScoreTimeout = setTimeout(() => {
      StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
    }, 250);
  };

  const recordScoreChange = (newS1, newS2, pulseTeam = null) => {
    if (!state.scoreHistory) state.scoreHistory = [];
    state.scoreHistory.push({ score1: state.score1, score2: state.score2 });
    if (state.scoreHistory.length > 20) state.scoreHistory.shift();

    state.score1 = Math.max(0, Math.min(30, newS1));
    state.score2 = Math.max(0, Math.min(30, newS2));

    if (state.matchStatus === 'ready') {
      state.matchStatus = 'in_progress';
      if (state.activeMatch) state.activeMatch.matchStatus = 'in_progress';
    }

    if (pulseTeam === 'team1') {
      const l1 = document.getElementById('score-team1-val');
      if (l1) {
        l1.classList.add('score-pulse');
        setTimeout(() => l1.classList.remove('score-pulse'), 180);
      }
    } else if (pulseTeam === 'team2') {
      const l2 = document.getElementById('score-team2-val');
      if (l2) {
        l2.classList.add('score-pulse');
        setTimeout(() => l2.classList.remove('score-pulse'), 180);
      }
    }

    updateScoreboardDisplay();
    renderEloPrediction();
    renderBettingWidget();
    debouncedSyncLiveScore();
  };

  // Nút Dọn Sân
  const btnClearCourt = document.getElementById('btn-clear-court');
  if (btnClearCourt) {
    btnClearCourt.addEventListener('click', () => {
      window.appClearCourt();
    });
  }

  // Nút Đổi Sân
  const btnSwapSides = document.getElementById('btn-swap-court-sides');
  if (btnSwapSides) {
    btnSwapSides.addEventListener('click', () => {
      window.appSwapCourtSides();
    });
  }

  // Nút Hoàn Tác Điểm
  const btnUndo = document.getElementById('btn-undo-score');
  if (btnUndo) {
    btnUndo.addEventListener('click', () => {
      window.appUndoScore();
    });
  }

  // Nút Bắt Đầu Trận Đấu Giữa Sân
  const btnStartMatch = document.getElementById('btn-start-match');
  if (btnStartMatch) {
    btnStartMatch.addEventListener('click', () => {
      window.appStartMatch();
    });
  }

  // Chạm trực tiếp vào hộp số để +1 điểm
  const zoneT1 = document.getElementById('zone-score-t1');
  if (zoneT1) {
    zoneT1.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'score-team1-val') return;
      SoundService.playSmash();
      recordScoreChange(state.score1 + 1, state.score2, 'team1');
    });
  }

  const zoneT2 = document.getElementById('zone-score-t2');
  if (zoneT2) {
    zoneT2.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'score-team2-val') return;
      SoundService.playSmash();
      recordScoreChange(state.score1, state.score2 + 1, 'team2');
    });
  }

  // Bấm vào con số để nhập điểm bằng bàn phím
  const led1 = document.getElementById('score-team1-val');
  if (led1) {
    led1.addEventListener('click', (e) => {
      e.stopPropagation();
      window.appPromptManualScore(true);
    });
  }

  const led2 = document.getElementById('score-team2-val');
  if (led2) {
    led2.addEventListener('click', (e) => {
      e.stopPropagation();
      window.appPromptManualScore(false);
    });
  }

  const setupScoreButton = (id, delta, isTeam1) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (delta > 0) SoundService.playSmash();
      else SoundService.playClick();
      if (isTeam1) {
        recordScoreChange(state.score1 + delta, state.score2, delta > 0 ? 'team1' : null);
      } else {
        recordScoreChange(state.score1, state.score2 + delta, delta > 0 ? 'team2' : null);
      }
    });
  };

  setupScoreButton('btn-t1-minus', -1, true);
  setupScoreButton('btn-t1-plus', 1, true);
  setupScoreButton('btn-t2-minus', -1, false);
  setupScoreButton('btn-t2-plus', 1, false);

  // Preset Tỷ số
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const s1 = parseInt(chip.dataset.s1, 10);
      const s2 = parseInt(chip.dataset.s2, 10);
      SoundService.playClick();
      recordScoreChange(s1, s2);
    });
  });

  // 6. Nút Xác Nhận Kết Quả Trận Đấu
  const btnFinish = document.getElementById('btn-finish-match');
  if (btnFinish) {
    btnFinish.addEventListener('click', finishMatch);
  }

  // 7. Tab Bảng Xếp Hạng Gender Filter (Toàn CLB, Nam ♂, Nữ ♀)
  document.querySelectorAll('.lb-gender-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-gender-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.leaderboardGender = btn.dataset.gender || 'all';
      SoundService.playClick();
      renderLeaderboard();
    });
  });

  // 7b. Tab Bảng Xếp Hạng Sub-tabs
  document.querySelectorAll('.lb-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.leaderboardSort = btn.dataset.lbsort;
      SoundService.playClick();
      renderLeaderboard();
    });
  });

  // 8a. Thêm Khách Giao Lưu (Hỗ trợ nút ở Điểm Danh và Thành Viên)
  ['btn-open-add-guest', 'btn-open-add-guest-members'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.appOpenAddGuestModal();
      });
    }
  });

  // Ủy quyền sự kiện click toàn trang cho mọi nút mở modal thêm khách
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('#btn-open-add-guest, #btn-open-add-guest-members, .btn-open-add-guest, [data-action="open-add-guest"]');
    if (trigger) {
      e.preventDefault();
      window.appOpenAddGuestModal();
    }
  });

  // 8b. Điểm danh Quick Actions
  const btnReg = document.getElementById('btn-checkin-regulars');
  if (btnReg) {
    btnReg.addEventListener('click', () => {
      const att = StorageService.getAttendance();
      const members = StorageService.getMembers();
      att.presentIds = members.filter(m => m.frequency === 'regular').map(m => m.id);
      StorageService.saveAttendance(att);
      SoundService.playClick();
      renderAttendance();
      updateSessionStatusBadge();
      renderCourtBench();
      showToast('Đã chọn 8 thành viên nòng cốt!');
    });
  }

  const btnAll = document.getElementById('btn-checkin-all');
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      const att = StorageService.getAttendance();
      const members = StorageService.getMembers();
      att.presentIds = members.map(m => m.id);
      StorageService.saveAttendance(att);
      SoundService.playClick();
      renderAttendance();
      updateSessionStatusBadge();
      renderCourtBench();
      showToast('Đã điểm danh tất cả thành viên!');
    });
  }

  const btnNone = document.getElementById('btn-checkin-none');
  if (btnNone) {
    btnNone.addEventListener('click', () => {
      const att = StorageService.getAttendance();
      att.presentIds = [];
      StorageService.saveAttendance(att);
      SoundService.playClick();
      renderAttendance();
      updateSessionStatusBadge();
      renderCourtBench();
      showToast('Đã bỏ chọn tất cả!');
    });
  }

  // 9. Tìm kiếm thành viên
  const searchInput = document.getElementById('member-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderMembers();
    });
  }

  // 10. Mở Modal Thêm Thành Viên
  const btnAddMem = document.getElementById('btn-open-add-member');
  if (btnAddMem) {
    btnAddMem.addEventListener('click', () => {
      openMemberModal();
    });
  }

  // Đóng Modal khi bấm nút X hoặc Hủy
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Đóng Modal khi click ra ngoài vùng backdrop (trừ khi đang quay spinner)
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'modal-spinner' && state.isSpinning) return;
        closeAllModals();
      }
    });
  });

  // Hỗ trợ đóng Modal nhanh bằng phím Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.isSpinning) return;
      closeAllModals();
    }
  });

  // Xử lý Form Thêm/Sửa Thành Viên
  const formMember = document.getElementById('form-member');
  if (formMember) {
    formMember.addEventListener('submit', handleMemberFormSubmit);
  }

  // Xử lý Đăng nhập bằng mã PIN
  const btnSubmitAuthPin = document.getElementById('btn-submit-auth-pin');
  if (btnSubmitAuthPin) {
    btnSubmitAuthPin.addEventListener('click', () => window.appSubmitAuthPin());
  }

  const inputAuthPin = document.getElementById('input-auth-pin');
  if (inputAuthPin) {
    inputAuthPin.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.appSubmitAuthPin();
      }
    });
  }

  // Mở Modal Thêm Buổi Đánh
  const btnAddSession = document.getElementById('btn-open-add-session');
  if (btnAddSession) {
    btnAddSession.addEventListener('click', () => {
      openSessionModal(null, state.calendarSelectedDate);
    });
  }

  // Chuyển đổi chế độ xem Lịch Lưới / Danh Sách
  const btnToggleCalView = document.getElementById('btn-toggle-calendar-view');
  if (btnToggleCalView) {
    btnToggleCalView.addEventListener('click', () => {
      state.calendarViewMode = state.calendarViewMode === 'grid' ? 'list' : 'grid';
      const icon = document.getElementById('calendar-view-icon');
      const text = document.getElementById('calendar-view-text');
      if (icon) icon.textContent = state.calendarViewMode === 'grid' ? '📋' : '📅';
      if (text) text.textContent = state.calendarViewMode === 'grid' ? 'Dạng Danh Sách' : 'Dạng Lịch Lưới';
      renderSessions();
    });
  }

  // Điều hướng Tháng Lịch
  const btnCalPrev = document.getElementById('btn-cal-prev');
  if (btnCalPrev) {
    btnCalPrev.addEventListener('click', () => {
      state.calendarMonth--;
      if (state.calendarMonth < 0) {
        state.calendarMonth = 11;
        state.calendarYear--;
      }
      renderSessions();
    });
  }

  const btnCalNext = document.getElementById('btn-cal-next');
  if (btnCalNext) {
    btnCalNext.addEventListener('click', () => {
      state.calendarMonth++;
      if (state.calendarMonth > 11) {
        state.calendarMonth = 0;
        state.calendarYear++;
      }
      renderSessions();
    });
  }

  const btnCalToday = document.getElementById('btn-cal-today');
  if (btnCalToday) {
    btnCalToday.addEventListener('click', () => {
      const now = new Date();
      state.calendarYear = now.getFullYear();
      state.calendarMonth = now.getMonth();
      state.calendarSelectedDate = getLocalDateStr(now);
      renderSessions();
    });
  }

  // Xử lý Form Thêm Buổi Đánh
  const formSession = document.getElementById('form-session');
  if (formSession) {
    formSession.addEventListener('submit', handleSessionFormSubmit);
  }

  // Upload Avatar trong Modal
  const dropzone = document.getElementById('avatar-dropzone');
  const fileInput = document.getElementById('input-avatar-file');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const base64 = await processImageFile(file);
          state.tempAvatarBase64 = base64;
          const previewImg = document.getElementById('preview-avatar-img');
          if (previewImg) previewImg.src = base64;
          showToast('Đã tải và xử lý ảnh đại diện!');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  }

  // Toggle Light / Dark Theme
  const btnTheme = document.getElementById('btn-toggle-theme');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('cbb_thai_thinh_theme', newTheme);
      updateThemeButton(newTheme);
      SoundService.playClick();
      showToast(newTheme === 'light' ? '☀️ Đã bật giao diện Sáng' : '🌙 Đã bật giao diện Tối');
    });
  }

  // Toggle Mute Sound
  const btnSound = document.getElementById('btn-toggle-sound');
  if (btnSound) {
    btnSound.addEventListener('click', () => {
      const muted = SoundService.toggleMute();
      btnSound.textContent = muted ? '🔇' : '🔊';
      showToast(muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh');
    });
  }

  // Backup Data Modal
  const btnBackup = document.getElementById('btn-open-backup');
  if (btnBackup) {
    btnBackup.addEventListener('click', () => {
      document.getElementById('modal-backup').classList.add('open');
    });
  }

  // Export JSON
  const btnExport = document.getElementById('btn-export-json');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const json = StorageService.exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CLB_ThaiThinh_Backup_${getLocalDateStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Đã tải xuống file sao lưu!');
    });
  }

  // Import JSON
  const inputImport = document.getElementById('input-import-json');
  if (inputImport) {
    inputImport.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const success = StorageService.importAllData(ev.target.result);
          if (success) {
            closeAllModals();
            loadInitialState();
            switchTab(state.currentTab);
            showToast('Khôi phục dữ liệu thành công!');
          } else {
            showToast('File JSON không hợp lệ!', 'error');
          }
        };
        reader.readAsText(file);
      }
    });
  }



  // Reset to empty clean slate
  const btnReset = document.getElementById('btn-reset-default');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      const ok = await showConfirmModal({
        title: 'Xóa Toàn Bộ Dữ Liệu?',
        message: 'Bạn có chắc chắn muốn xóa sạch thành viên, lịch sử trận và điểm danh để làm mới 100% không? Thao tác này không thể hoàn tác!',
        confirmText: 'Xóa Sạch 100%',
        icon: '🗑️',
        isDanger: true
      });
      if (ok) {
        StorageService.resetAllData();
        closeAllModals();
        loadInitialState();
        switchTab(state.currentTab);
        showToast('Đã làm sạch toàn bộ dữ liệu!');
      }
    });
  }

  // --- CÀI ĐẶT & TIỆN ÍCH CLB (SETTINGS MODAL) ---
  const btnSettings = document.getElementById('btn-open-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      const soundLabel = document.getElementById('settings-sound-label');
      if (soundLabel) {
        soundLabel.textContent = SoundService.isMuted() ? 'Tắt 🔇' : 'Bật 🔊';
      }
      document.getElementById('modal-club-settings').classList.add('open');
    });
  }

  const btnSettingsSound = document.getElementById('btn-settings-sound-toggle');
  if (btnSettingsSound) {
    btnSettingsSound.addEventListener('click', () => {
      const muted = SoundService.toggleMute();
      const soundLabel = document.getElementById('settings-sound-label');
      if (soundLabel) {
        soundLabel.textContent = muted ? 'Tắt 🔇' : 'Bật 🔊';
      }
      if (!muted) SoundService.playSmash();
      showToast(muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh');
    });
  }

  // Hàm mở modal cấu hình Supabase
  function openSupabaseConfigModal() {
    const config = supabaseService.getConfig();
    const inputUrl = document.getElementById('input-supabase-url');
    const inputKey = document.getElementById('input-supabase-key');
    const testResult = document.getElementById('supabase-test-result');

    if (config) {
      if (inputUrl) inputUrl.value = config.url;
      if (inputKey) inputKey.value = config.key;
    }
    if (testResult) {
      testResult.style.display = 'none';
      testResult.innerHTML = '';
    }

    document.getElementById('modal-supabase-config')?.classList.add('open');
  }

  const btnSettingsCloud = document.getElementById('btn-settings-open-cloud');
  if (btnSettingsCloud) {
    btnSettingsCloud.addEventListener('click', () => {
      closeAllModals();
      openSupabaseConfigModal();
    });
  }

  const btnSettingsExport = document.getElementById('btn-settings-export');
  if (btnSettingsExport) {
    btnSettingsExport.addEventListener('click', () => {
      const json = StorageService.exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CLB_ThaiThinh_Backup_${getLocalDateStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Đã tải xuống file sao lưu!');
    });
  }

  const inputSettingsImport = document.getElementById('input-settings-import-json');
  if (inputSettingsImport) {
    inputSettingsImport.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const success = StorageService.importAllData(ev.target.result);
          if (success) {
            closeAllModals();
            loadInitialState();
            switchTab(state.currentTab);
            showToast('Khôi phục dữ liệu thành công!');
          } else {
            showToast('File JSON không hợp lệ!', 'error');
          }
        };
        reader.readAsText(file);
      }
    });
  }

  const btnSettingsReset = document.getElementById('btn-settings-reset');
  if (btnSettingsReset) {
    btnSettingsReset.addEventListener('click', async () => {
      const ok = await showConfirmModal({
        title: 'Xóa Toàn Bộ Dữ Liệu?',
        message: 'Bạn có chắc chắn muốn xóa sạch thành viên, lịch sử trận và điểm danh để làm mới 100% không? Thao tác này không thể hoàn tác!',
        confirmText: 'Xóa Sạch 100%',
        icon: '🗑️',
        isDanger: true
      });
      if (ok) {
        StorageService.resetAllData();
        closeAllModals();
        loadInitialState();
        switchTab(state.currentTab);
        showToast('Đã làm sạch toàn bộ dữ liệu!');
      }
    });
  }

  // --- TÙY CHỈNH / ĐỔI CẦU THỦ TRÊN SÂN EVENTS ---
  const inputSearchSwap = document.getElementById('input-search-swap-player');
  if (inputSearchSwap) {
    inputSearchSwap.addEventListener('input', (e) => {
      renderSwapPlayerList(e.target.value);
    });
  }

  const btnCloseSwap = document.getElementById('btn-close-swap-modal');
  if (btnCloseSwap) {
    btnCloseSwap.addEventListener('click', () => {
      document.getElementById('modal-swap-court-player')?.classList.remove('open');
      state.swapTarget = null;
    });
  }

  // --- SUPABASE CLOUD EVENTS ---
  const btnCloudStatus = document.getElementById('btn-cloud-status');
  if (btnCloudStatus) {
    btnCloudStatus.addEventListener('click', openSupabaseConfigModal);
  }

  // Kiểm tra kết nối Supabase
  const btnTestCloud = document.getElementById('btn-test-supabase');
  if (btnTestCloud) {
    btnTestCloud.addEventListener('click', async () => {
      const url = document.getElementById('input-supabase-url').value.trim();
      const key = document.getElementById('input-supabase-key').value.trim();
      const testResult = document.getElementById('supabase-test-result');

      if (!url || !key) {
        testResult.style.display = 'block';
        testResult.style.color = 'var(--coral)';
        testResult.textContent = 'Vui lòng nhập đầy đủ URL và Anon Key';
        return;
      }

      btnTestCloud.textContent = 'Đang kiểm tra...';
      btnTestCloud.disabled = true;

      const result = await supabaseService.testConnection(url, key);
      btnTestCloud.textContent = 'Kiểm Tra';
      btnTestCloud.disabled = false;

      testResult.style.display = 'block';
      if (result.success) {
        testResult.style.color = 'var(--volt)';
        testResult.textContent = '✅ Kết nối Supabase thành công! Bảng dữ liệu đã sẵn sàng.';
      } else {
        testResult.style.color = 'var(--coral)';
        testResult.textContent = `❌ Lỗi: ${result.message}`;
      }
    });
  }

  // Lưu cấu hình Supabase & Đồng bộ
  const btnSaveCloud = document.getElementById('btn-save-supabase');
  if (btnSaveCloud) {
    btnSaveCloud.addEventListener('click', async () => {
      const url = document.getElementById('input-supabase-url').value.trim();
      const key = document.getElementById('input-supabase-key').value.trim();

      if (!url || !key) {
        showToast('Vui lòng điền đầy đủ URL và Key', 'error');
        return;
      }

      btnSaveCloud.textContent = 'Đang kết nối...';
      btnSaveCloud.disabled = true;

      supabaseService.saveConfig(url, key);
      const synced = await StorageService.syncFromCloud();

      btnSaveCloud.textContent = 'Lưu & Kết Nối';
      btnSaveCloud.disabled = false;

      closeAllModals();
      updateCloudStatusIndicator();
      initCloudSyncAndRealtime();
      switchTab(state.currentTab);

      if (synced) {
        showToast('🟢 Đã kết nối Supabase Cloud & Đồng bộ dữ liệu thành công!');
      } else {
        showToast('Đã lưu cấu hình Supabase Cloud!');
      }
    });
  }

  // Ngắt kết nối Supabase (Dùng Local)
  const btnDisconnectCloud = document.getElementById('btn-disconnect-supabase');
  if (btnDisconnectCloud) {
    btnDisconnectCloud.addEventListener('click', () => {
      supabaseService.saveConfig('', '');
      updateCloudStatusIndicator();
      closeAllModals();
      showToast('Đã ngắt kết nối Supabase. Ứng dụng chuyển sang chế độ lưu cục bộ.');
    });
  }
}

/**
 * Chuyển đổi giữa các màn hình Tab
 */
function switchTab(tabId) {
  state.currentTab = tabId;

  // Cập nhật nút Desktop
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Cập nhật nút Mobile
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Ẩn/Hiện Tab Content
  document.querySelectorAll('.tab-view').forEach(view => {
    view.style.display = view.id === `tab-${tabId}` ? 'block' : 'none';
  });

  // Gọi hàm render tương ứng
  switch (tabId) {
    case 'court':
      renderCourt();
      break;
    case 'sessions':
      renderSessions();
      break;
    case 'leaderboard':
      renderLeaderboard();
      break;
    case 'attendance':
      renderAttendance();
      break;
    case 'members':
      renderMembers();
      break;
    case 'history':
      renderHistory();
      break;
  }
}
window.switchTab = switchTab;

/**
 * =========================================================================
 * 1. RENDER SÂN ĐẤU (COURT & MATCHMAKER)
 * =========================================================================
 */
function renderCourt() {
  updateSessionStatusBadge();

  const team1Grid = document.getElementById('team1-players-grid');
  const team2Grid = document.getElementById('team2-players-grid');
  const t1AvgLabel = document.getElementById('team1-avg-elo');
  const t2AvgLabel = document.getElementById('team2-avg-elo');
  const emptyOverlay = document.getElementById('court-empty-overlay');
  const startOverlay = document.getElementById('court-center-start-overlay');
  const sideLeft = document.getElementById('court-side-left');
  const sideRight = document.getElementById('court-side-right');
  const venueLabel = document.getElementById('court-venue-label');
  const netBadge = document.getElementById('court-net-badge');
  const statusBadge = document.getElementById('court-match-status-badge');

  const courtName = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  if (venueLabel) {
    venueLabel.innerHTML = `<span class="court-venue-short">${courtName.toUpperCase()}</span><span class="court-venue-full"> - LƯỚI THÁI THỊNH</span>`;
  }
  if (netBadge) netBadge.textContent = `LƯỚI THÁI THỊNH - ${courtName.toUpperCase()}`;

  // Đổi bên sân hiển thị Trái / Phải
  if (sideLeft && sideRight) {
    sideLeft.style.gridRow = '1';
    sideRight.style.gridRow = '1';
    if (state.isSwappedSides) {
      sideLeft.style.gridColumn = '3';
      sideRight.style.gridColumn = '1';
    } else {
      sideLeft.style.gridColumn = '1';
      sideRight.style.gridColumn = '3';
    }
  }

  // Đảm bảo cấu trúc match luôn có 2 đội, mỗi đội 2 slot [slot0, slot1]
  if (!state.activeMatch) {
    state.activeMatch = { team1: [null, null], team2: [null, null] };
  }
  if (!Array.isArray(state.activeMatch.team1)) state.activeMatch.team1 = [null, null];
  if (!Array.isArray(state.activeMatch.team2)) state.activeMatch.team2 = [null, null];
  while (state.activeMatch.team1.length < 2) state.activeMatch.team1.push(null);
  while (state.activeMatch.team2.length < 2) state.activeMatch.team2.push(null);

  // Ẩn vĩnh viễn các overlay che sân theo yêu cầu người dùng
  if (emptyOverlay) emptyOverlay.style.display = 'none';
  if (startOverlay) startOverlay.style.display = 'none';
  if (sideLeft) sideLeft.style.opacity = '1';
  if (sideRight) sideRight.style.opacity = '1';

  // Lấy dữ liệu mới nhất từ storage đề phòng thành viên hoặc khách vừa được sửa điểm
  const allPeople = [...StorageService.getMembers(), ...StorageService.getGuests()];
  const personMap = new Map(allPeople.map(p => [p.id, p]));
  const t1 = state.activeMatch.team1.map(p => p ? (personMap.get(p.id) || p) : null);
  const t2 = state.activeMatch.team2.map(p => p ? (personMap.get(p.id) || p) : null);

  // Render Team 1 (2 slots)
  if (team1Grid) {
    team1Grid.innerHTML = t1.map((p, idx) => renderCourtPlayerCard(p, 'team1', idx)).join('');
  }
  const validT1 = t1.filter(Boolean);
  const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
  if (t1AvgLabel) t1AvgLabel.innerHTML = `<span class="elo-tb-prefix">Elo TB: </span><span class="elo-tb-val">${elo1}</span>`;

  // Render Team 2 (2 slots)
  if (team2Grid) {
    team2Grid.innerHTML = t2.map((p, idx) => renderCourtPlayerCard(p, 'team2', idx)).join('');
  }
  const validT2 = t2.filter(Boolean);
  const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;
  if (t2AvgLabel) t2AvgLabel.innerHTML = `<span class="elo-tb-prefix">Elo TB: </span><span class="elo-tb-val">${elo2}</span>`;

  // Quản lý trạng thái thi đấu & badge
  const totalPlayers = validT1.length + validT2.length;
  if (statusBadge) {
    if (state.score1 > 0 || state.score2 > 0) {
      statusBadge.className = 'court-status-tag live';
      statusBadge.textContent = 'Đang đấu';
      state.matchStatus = 'in_progress';
    } else if (totalPlayers === 4) {
      statusBadge.className = 'court-status-tag ready';
      statusBadge.textContent = 'Sẵn sàng';
      state.matchStatus = 'ready';
    } else if (totalPlayers > 0) {
      statusBadge.className = 'court-status-tag ready';
      statusBadge.textContent = `${totalPlayers}/4 VĐV`;
      state.matchStatus = 'idle';
    } else {
      statusBadge.className = 'court-status-tag empty';
      statusBadge.textContent = 'Đang trống';
      state.matchStatus = 'idle';
    }
  }

  updateScoreboardDisplay();
  renderEloPrediction();
  renderBettingWidget();
  renderCourtBench();
}

function updateScoreboardDisplay() {
  const t1Val = document.getElementById('score-team1-val');
  const t2Val = document.getElementById('score-team2-val');
  if (t1Val) t1Val.textContent = state.score1;
  if (t2Val) t2Val.textContent = state.score2;

  // Làm nổi bật nút hoàn tất trận nếu có đội chạm 21 điểm
  const btnFinish = document.getElementById('btn-finish-match');
  if (btnFinish) {
    const isGamePoint = (state.score1 >= 21 || state.score2 >= 21) && Math.abs(state.score1 - state.score2) >= 2;
    if (isGamePoint) {
      btnFinish.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.7)';
      btnFinish.style.animation = 'startPulse 1.8s infinite';
    } else {
      btnFinish.style.boxShadow = '';
      btnFinish.style.animation = '';
    }
  }
}

/**
 * Render Băng Ghế Chờ Avatar 1-Chạm (Live Bench Pool)
 * Tách 2 dòng: Nam (♂) và Nữ (♀) đã điểm danh hôm nay
 * Chỉ hiển thị Avatar kèm khung viền/hiệu ứng của VĐV
 */
function renderCourtBench() {
  const maleContainer = document.getElementById('bench-male-avatars');
  const femaleContainer = document.getElementById('bench-female-avatars');
  if (!maleContainer || !femaleContainer) return;

  const attendance = StorageService.getAttendance();
  const presentIds = attendance.presentIds || [];
  const allMembers = StorageService.getMembers();
  const guests = StorageService.getGuests();

  // Lọc danh sách người có mặt hôm nay (Thành viên chính thức + Khách giao lưu)
  const presentOfficial = allMembers.filter(m => presentIds.includes(m.id));
  const presentGuests = guests.filter(g => presentIds.includes(g.id));
  const presentMembers = [...presentOfficial, ...presentGuests];

  // Lấy ID của những người đang thực sự trên Sân 1 và Sân 2
  const c1Match = state.courtMatches?.court_1?.activeMatch;
  const c2Match = state.courtMatches?.court_2?.activeMatch;

  const onCourt1Ids = [
    ...(c1Match?.team1?.filter(Boolean).map(p => p.id) || []),
    ...(c1Match?.team2?.filter(Boolean).map(p => p.id) || [])
  ];

  const onCourt2Ids = [
    ...(c2Match?.team1?.filter(Boolean).map(p => p.id) || []),
    ...(c2Match?.team2?.filter(Boolean).map(p => p.id) || [])
  ];

  const males = presentMembers.filter(m => m.gender === 'male');
  const females = presentMembers.filter(m => m.gender === 'female');

  const renderBenchAvatarBtn = (member) => {
    const isCourt1 = onCourt1Ids.includes(member.id);
    const isCourt2 = onCourt2Ids.includes(member.id);
    const isOnCourt = isCourt1 || isCourt2;
    const isThisCourt = (isCourt1 && state.currentCourtId === 'court_1') || (isCourt2 && state.currentCourtId === 'court_2');
    const courtLabel = isCourt1 ? 'S1' : (isCourt2 ? 'S2' : '');
    const isGuestTag = member.isGuest ? ' [Khách]' : '';
    const titleText = isThisCourt
      ? `${member.name}${isGuestTag} (${member.elo} Elo) — Đang trên sân này (Chạm để gỡ về hàng chờ)`
      : `${member.name}${isGuestTag} (${member.elo} Elo)${isOnCourt ? ` — Đang ở ${courtLabel}` : ' — Chạm để tự động vào sân'}`;

    return `
      <button type="button" 
        class="bench-avatar-btn ${isOnCourt ? 'is-on-court' : ''} ${member.isGuest ? 'is-guest-bench-btn' : ''}" 
        onclick="window.appBenchSelectPlayer('${member.id}')"
        title="${titleText}"
      >
        ${renderAvatarHtml(member, { size: 'sm' })}
        ${isOnCourt ? `<span class="bench-on-court-tag ${isCourt2 ? 'court-2' : ''}">${courtLabel}</span>` : ''}
      </button>
    `;
  };

  if (males.length === 0) {
    maleContainer.innerHTML = '<span class="bench-empty-hint">Chưa có nam điểm danh</span>';
  } else {
    maleContainer.innerHTML = males.map(renderBenchAvatarBtn).join('');
  }

  if (females.length === 0) {
    femaleContainer.innerHTML = '<span class="bench-empty-hint">Chưa có nữ điểm danh</span>';
  } else {
    femaleContainer.innerHTML = females.map(renderBenchAvatarBtn).join('');
  }
}

/**
 * Xử lý khi chạm vào 1 Avatar ở Băng Ghế Chờ:
 * - Nếu người đó đã ở trên sân hiện tại: Chạm vào sẽ gỡ ra về hàng chờ!
 * - Nếu chưa trên sân: Tự động nhảy vào ô trống đầu tiên (Sân trái -> Sân phải)
 */
window.appBenchSelectPlayer = function(memberId) {
  if (!state.activeMatch) {
    state.activeMatch = { team1: [null, null], team2: [null, null] };
  }
  if (!Array.isArray(state.activeMatch.team1)) state.activeMatch.team1 = [null, null];
  if (!Array.isArray(state.activeMatch.team2)) state.activeMatch.team2 = [null, null];
  while (state.activeMatch.team1.length < 2) state.activeMatch.team1.push(null);
  while (state.activeMatch.team2.length < 2) state.activeMatch.team2.push(null);

  const member = StorageService.getMemberById(memberId);
  if (!member) return;

  const currentCourtName = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const otherCourtId = state.currentCourtId === 'court_1' ? 'court_2' : 'court_1';
  const otherCourtName = otherCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';

  // 1. Nếu người này đã có mặt trên sân hiện tại: Chạm vào avatar sẽ gỡ ra về hàng chờ
  let existingSlot = null;
  if (state.activeMatch.team1[0]?.id === memberId) existingSlot = { teamKey: 'team1', slotIndex: 0 };
  else if (state.activeMatch.team1[1]?.id === memberId) existingSlot = { teamKey: 'team1', slotIndex: 1 };
  else if (state.activeMatch.team2[0]?.id === memberId) existingSlot = { teamKey: 'team2', slotIndex: 0 };
  else if (state.activeMatch.team2[1]?.id === memberId) existingSlot = { teamKey: 'team2', slotIndex: 1 };

  if (existingSlot) {
    window.appUnassignSlot(existingSlot.teamKey, existingSlot.slotIndex);
    return;
  }

  // 2. Kiểm tra nếu người này đang đánh ở sân còn lại
  const otherMatch = state.courtMatches[otherCourtId]?.activeMatch;
  if (otherMatch) {
    const onOtherCourt = (
      (otherMatch.team1 && otherMatch.team1.some(p => p?.id === memberId)) ||
      (otherMatch.team2 && otherMatch.team2.some(p => p?.id === memberId))
    );
    if (onOtherCourt) {
      showToast(`${member.name} đang thi đấu ở ${otherCourtName}! Không thể xếp vào ${currentCourtName}.`, 'error');
      return;
    }
  }

  // 3. Tìm ô trống đầu tiên: Sân trái (team1 slot 0, 1) trước, rồi Sân phải (team2 slot 0, 1)
  let target = null;
  if (state.activeMatch.team1[0] === null) {
    target = { teamKey: 'team1', slotIndex: 0 };
  } else if (state.activeMatch.team1[1] === null) {
    target = { teamKey: 'team1', slotIndex: 1 };
  } else if (state.activeMatch.team2[0] === null) {
    target = { teamKey: 'team2', slotIndex: 0 };
  } else if (state.activeMatch.team2[1] === null) {
    target = { teamKey: 'team2', slotIndex: 1 };
  }

  if (!target) {
    showToast(`${currentCourtName} đã đủ 4 VĐV! Chạm vào avatar trên sân để gỡ hoặc bấm Dọn Sân.`, 'info');
    return;
  }

  // Đưa VĐV vào ô trống tìm được
  state.activeMatch[target.teamKey][target.slotIndex] = member;

  const validT1 = state.activeMatch.team1.filter(Boolean);
  const validT2 = state.activeMatch.team2.filter(Boolean);
  const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
  const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;
  state.activeMatch.diffElo = Math.abs(elo1 - elo2);

  StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);

  SoundService.playClick();
  renderCourt();
  debouncedSyncLiveScore();
};

/**
 * Gỡ một VĐV khỏi vị trí trên sân và đưa trở lại hàng chờ (để trống slot đó)
 */
window.appUnassignSlot = function(teamKey, slotIndex) {
  if (!state.activeMatch || !state.activeMatch[teamKey]) return;
  const removed = state.activeMatch[teamKey][slotIndex];
  if (!removed) return;

  state.activeMatch[teamKey][slotIndex] = null;

  const validT1 = state.activeMatch.team1.filter(Boolean);
  const validT2 = state.activeMatch.team2.filter(Boolean);
  const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
  const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;
  state.activeMatch.diffElo = Math.abs(elo1 - elo2);

  StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);

  SoundService.playClick();
  renderCourt();
  debouncedSyncLiveScore();
};

function renderCourtPlayerCard(player, teamKey = 'team1', slotIndex = 0) {
  if (!player) {
    return `
      <div class="court-player-card court-slot-empty" onclick="window.appOpenSwapPlayerModal('${teamKey}', ${slotIndex})" title="Chạm để thêm VĐV vào vị trí này">
        <div class="slot-empty-plus-wrap">
          <span class="slot-empty-plus">➕</span>
        </div>
        <div class="slot-empty-info">
          <div class="slot-empty-title">Thêm VĐV</div>
          <div class="slot-empty-hint">Chạm để chọn</div>
        </div>
      </div>
    `;
  }

  const tier = getTierByElo(player.elo);
  const isMale = player.gender === 'male';

  return `
    <div class="court-player-card court-slot-occupied" onclick="window.appOpenSwapPlayerModal('${teamKey}', ${slotIndex})" title="Chạm để đổi VĐV khác">
      <div class="player-avatar-wrap" onclick="event.stopPropagation(); window.appUnassignSlot('${teamKey}', ${slotIndex})" title="Chạm vào avatar để gỡ ${player.name} về hàng chờ">
        ${renderAvatarHtml(player, { size: 'sm' })}
        <span class="gender-badge-dot ${isMale ? 'gender-male' : 'gender-female'}">
          ${isMale ? '♂' : '♀'}
        </span>
      </div>
      <div class="player-info">
        <div class="player-name">
          <span class="player-name-text">${player.name}</span>
          ${player.activeEloShield ? '<span title="Khiên bảo vệ Elo đang BẬT (Giảm 50% điểm trừ nếu thua)" style="font-size: 0.82rem; flex-shrink: 0;">🛡️</span>' : ''}
        </div>
        <div class="player-meta-row">
          <span class="tier-pill" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
            <span class="tier-icon">${tier.icon}</span>
            <span class="tier-name-text">${tier.name}</span>
          </span>
          <span class="elo-pill">${player.elo}</span>
        </div>
      </div>
      <button type="button" class="btn-swap-player-slot" onclick="event.stopPropagation(); window.appOpenSwapPlayerModal('${teamKey}', ${slotIndex})" title="Đổi VĐV">
        <span>🔄</span><span class="btn-swap-label"> Đổi</span>
      </button>
    </div>
  `;
}

function renderEloPrediction() {
  const previewBox = document.getElementById('elo-preview-box');
  if (!previewBox) return;

  const t1 = state.activeMatch?.team1 || [];
  const t2 = state.activeMatch?.team2 || [];

  if (!state.activeMatch || t1.length < 2 || t2.length < 2 || t1.some(p => !p) || t2.some(p => !p)) {
    previewBox.innerHTML = '<span>Dự đoán Elo sẽ xuất hiện khi có đủ 4 VĐV</span>';
    return;
  }

  if (state.score1 === state.score2) {
    previewBox.innerHTML = '<span>Tỷ số đang hòa. Cần có 1 đội thắng để phân định Elo</span>';
    return;
  }

  const result = calculateDoublesElo(t1, t2, state.score1, state.score2);

  previewBox.innerHTML = `
    <div class="elo-preview-item">
      <span>Đội 1:</span>
      <span class="${result.deltaTeam1 > 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">
        ${result.deltaTeam1 > 0 ? '+' : ''}${result.deltaTeam1} Elo
      </span>
    </div>
    <div style="color: var(--text-dim);">|</div>
    <div class="elo-preview-item">
      <span>Đội 2:</span>
      <span class="${result.deltaTeam2 > 0 ? 'elo-delta-pos' : 'elo-delta-neg'}">
        ${result.deltaTeam2 > 0 ? '+' : ''}${result.deltaTeam2} Elo
      </span>
    </div>
  `;
}

/**
 * =========================================================================
 * RENDER WIDGET DỰ ĐOÁN & CƯỢC VUI (LIVE MINI-BETTING - GIAI ĐOẠN 2)
 * =========================================================================
 */
function renderBettingWidget() {
  const container = document.getElementById('live-betting-card');
  if (!container) return;

  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2 ||
      state.activeMatch.team1.length < 2 || state.activeMatch.team2.length < 2 ||
      state.activeMatch.team1.some(p => !p) || state.activeMatch.team2.some(p => !p)) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; color: var(--text-muted); font-size: 0.82rem; padding: 4px 0;">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span>🎯</span> Kèo cược vui bằng Xu sẽ mở khi có đủ 4 VĐV trên sân
        </span>
        <span style="font-size: 0.72rem; color: var(--text-dim);">Chờ đủ 4 người</span>
      </div>
    `;
    return;
  }

  const courtId = state.currentCourtId;
  const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const t1 = state.activeMatch.team1;
  const t2 = state.activeMatch.team2;

  const t1Ids = t1.map(p => p.id);
  const t2Ids = t2.map(p => p.id);
  const currentUser = StorageService.getCurrentUser();
  const isOnCourt = currentUser && (t1Ids.includes(currentUser.id) || t2Ids.includes(currentUser.id));

  // Tỷ số và kiểm tra khóa cược (cho phép cược linh hoạt nửa đầu hiệp, đóng khi score1 >= 10 || score2 >= 10)
  const isLocked = state.score1 >= 10 || state.score2 >= 10;

  // Tính tỷ lệ Odds (Kèo dưới kẹp tối đa 1 ăn 3.00, kèo trên tối thiểu 1.20)
  const oddsData = calculateBettingOdds(t1, t2);

  // Lấy các vé cược đang chờ cho sân này
  const activeBets = StorageService.getBets(courtId, 'pending');
  const t1Bets = activeBets.filter(b => b.predictedTeam === 'team1');
  const t2Bets = activeBets.filter(b => b.predictedTeam === 'team2');
  const totalBets = activeBets.length;

  // Tính % thanh đo cộng đồng
  let t1Percent = 50;
  let t2Percent = 50;
  if (totalBets > 0) {
    t1Percent = Math.round((t1Bets.length / totalBets) * 100);
    t2Percent = 100 - t1Percent;
  }

  // Vé cược của người dùng hiện tại (nếu có)
  const myBet = currentUser ? StorageService.getUserActiveBet(courtId, currentUser.id) : null;

  // Tên hiển thị 2 đội
  const t1Names = t1.map(p => p.name).join(' & ');
  const t2Names = t2.map(p => p.name).join(' & ');

  // 1. Header widget
  const headerHtml = `
    <div class="live-betting-header">
      <div class="live-betting-title">
        <span>🎯</span> Dự Đoán Trận Đấu (${courtName})
        ${isLocked ? `
          <span class="live-locked-badge">
            <span>🔒</span> ĐÃ ĐÓNG (≥10đ)
          </span>
        ` : `
          <span class="live-pulse-badge">
            <span class="live-pulse-dot"></span> ĐANG MỞ (Cược trước 10đ)
          </span>
        `}
      </div>
      <button class="btn-view-all-bets" onclick="window.appOpenCourtBetsModal()">
        <span>👁️</span> Kèo Cả Sân (${totalBets})
      </button>
    </div>
  `;

  // 2. Crowd Meter bar
  const crowdMeterHtml = `
    <div class="crowd-meter-wrap">
      <div class="crowd-meter-labels">
        <span class="crowd-meter-t1">${t1Names} (${t1Percent}%)</span>
        <span class="crowd-meter-t2">(${t2Percent}%) ${t2Names}</span>
      </div>
      <div class="crowd-meter-bar">
        <div class="crowd-meter-fill-t1" style="width: ${t1Percent}%;"></div>
      </div>
    </div>
  `;

  let bodyHtml = '';

  if (!currentUser) {
    // Chưa đăng nhập
    bodyHtml = `
      <div class="bet-notice-box" style="justify-content: space-between;">
        <span style="display: flex; align-items: center; gap: 8px;">
          <span>🪙</span> <span>Đăng nhập mã PIN để tham gia cược vui nhận Xu!</span>
        </span>
        <button class="btn-primary" style="padding: 6px 14px; font-size: 0.8rem;" onclick="window.appOpenAuthModal()">
          Đăng Nhập
        </button>
      </div>
    `;
  } else if (isOnCourt) {
    // Là 1 trong 4 VĐV đang đánh trên sân
    bodyHtml = `
      <div class="bet-notice-box">
        <span style="font-size: 1.3rem;">🏸</span>
        <div>
          <strong>Bạn đang trực tiếp thi đấu trên sân này!</strong>
          <div style="font-size: 0.76rem; color: var(--text-dim); margin-top: 2px;">
            Hệ thống khóa cược với 4 VĐV trên sân để giữ trọn vẹn tinh thần Fair-play. Tập trung thi đấu giành chiến thắng nhé!
          </div>
        </div>
      </div>
    `;
  } else if (myBet) {
    // Đã đặt cược thành công cho trận này
    const pickedTeamName = myBet.predictedTeam === 'team1' ? t1Names : t2Names;
    const pickedTeamTag = myBet.predictedTeam === 'team1' ? 'ĐỘI 1' : 'ĐỘI 2';
    const tagClass = myBet.predictedTeam === 'team1' ? 'team-1-tag' : 'team-2-tag';

    bodyHtml = `
      <div class="user-bet-ticket">
        <div class="ticket-header">
          <div class="ticket-badge">
            <span>🎟️</span> VÉ CƯỢC CỦA BẠN
          </div>
          <span style="font-size: 0.72rem; color: var(--emerald); font-weight: 700;">
            ${isLocked ? '🔒 ĐÃ KHÓA' : '⏳ ĐANG DIỄN RA'}
          </span>
        </div>
        <div class="ticket-team-title">
          <span class="bet-team-tag ${tagClass}">[${pickedTeamTag}]</span> ${pickedTeamName}
        </div>
        <div class="ticket-details-row">
          <div>Cược: <strong style="color: var(--text-primary);">${myBet.amount} Xu</strong></div>
          <div>Tỷ lệ: <strong style="color: #facc15;">${myBet.odds}x</strong></div>
          <div>Thắng nhận: <strong class="ticket-payout-val">+${myBet.potentialPayout} Xu</strong></div>
        </div>
      </div>
    `;
  } else if (isLocked) {
    // Chưa cược và tỷ số đã chạm mốc 10 điểm
    bodyHtml = `
      <div class="bet-notice-box">
        <span style="font-size: 1.3rem;">🔒</span>
        <div>
          <strong>Đã đóng nhận cược cho trận đấu này!</strong>
          <div style="font-size: 0.76rem; color: var(--text-dim); margin-top: 2px;">
            Tỷ số đã chạm mốc 10 điểm (${state.score1} - ${state.score2}). Hãy cổ vũ cho các tuyển thủ và chờ kèo trận tiếp theo nhé!
          </div>
        </div>
      </div>
    `;
  } else {
    // Đang mở cược và người dùng chưa cược
    const selTeam = state.betting.selectedTeam || 'team1';
    const selAmt = state.betting.selectedAmount || 20;
    const curOdds = selTeam === 'team1' ? oddsData.oddsTeam1 : oddsData.oddsTeam2;
    const potentialPayout = Math.round(selAmt * curOdds);
    const profit = potentialPayout - selAmt;

    bodyHtml = `
      <!-- Chọn Đội -->
      <div class="bet-teams-grid">
        <div class="bet-team-card team-1-card ${selTeam === 'team1' ? 'selected' : ''}" onclick="window.appSelectBetTeam('team1')">
          <div class="bet-team-tag team-1-tag">ĐỘI 1</div>
          <div class="bet-team-names" title="${t1Names}">${t1Names}</div>
          <div class="bet-odds-badge">Ăn ${oddsData.oddsTeam1}x</div>
        </div>
        <div class="bet-team-card team-2-card ${selTeam === 'team2' ? 'selected' : ''}" onclick="window.appSelectBetTeam('team2')">
          <div class="bet-team-tag team-2-tag">ĐỘI 2</div>
          <div class="bet-team-names" title="${t2Names}">${t2Names}</div>
          <div class="bet-odds-badge">Ăn ${oddsData.oddsTeam2}x</div>
        </div>
      </div>

      <!-- Chọn Mức Cược (Chỉ 10, 20, 30 Xu) -->
      <div class="bet-amounts-row">
        <button class="btn-bet-amt ${selAmt === 10 ? 'active' : ''}" onclick="window.appSelectBetAmount(10)">
          🪙 10 Xu
        </button>
        <button class="btn-bet-amt ${selAmt === 20 ? 'active' : ''}" onclick="window.appSelectBetAmount(20)">
          🪙 20 Xu
        </button>
        <button class="btn-bet-amt ${selAmt === 30 ? 'active' : ''}" onclick="window.appSelectBetAmount(30)">
          🪙 30 Xu
        </button>
      </div>

      <!-- Tóm tắt cược -->
      <div class="bet-summary-box">
        <div class="bet-summary-left">
          Cược <strong>${selAmt} Xu</strong> vào <strong>${selTeam === 'team1' ? 'Đội 1' : 'Đội 2'}</strong>
        </div>
        <div class="bet-summary-right">
          Thắng nhận: 🪙 ${potentialPayout} Xu (+${profit} Xu)
        </div>
      </div>

      <!-- Nút Chốt Kèo -->
      <button class="btn-confirm-bet" onclick="window.appConfirmBet()">
        <span>🎯</span> XÁC NHẬN CƯỢC ${selAmt} XU
      </button>
    `;
  }

  container.innerHTML = `${headerHtml}${crowdMeterHtml}${bodyHtml}`;
}

window.appSelectBetTeam = function(teamKey) {
  state.betting.selectedTeam = teamKey;
  SoundService.playClick();
  renderBettingWidget();
};

window.appSelectBetAmount = function(amt) {
  state.betting.selectedAmount = amt;
  SoundService.playClick();
  renderBettingWidget();
};

window.appConfirmBet = function() {
  if (!state.currentUser) {
    showToast('Vui lòng đăng nhập để tham gia dự đoán nhận Xu!', 'error');
    openAuthModal();
    return;
  }

  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2 ||
      state.activeMatch.team1.some(p => !p) || state.activeMatch.team2.some(p => !p)) {
    showToast('Cần có đủ 4 VĐV trên sân để đặt cược!', 'error');
    return;
  }

  const t1Ids = state.activeMatch.team1.map(p => p.id);
  const t2Ids = state.activeMatch.team2.map(p => p.id);
  if (t1Ids.includes(state.currentUser.id) || t2Ids.includes(state.currentUser.id)) {
    showToast('Bạn đang thi đấu trên sân này! Không được đặt cược.', 'error');
    return;
  }

  if (state.score1 >= 10 || state.score2 >= 10) {
    showToast('Trận đấu đã chạm mốc 10 điểm! Kèo cược đã bị khóa.', 'error');
    renderBettingWidget();
    return;
  }

  const oddsData = calculateBettingOdds(state.activeMatch.team1, state.activeMatch.team2);
  const selectedOdds = state.betting.selectedTeam === 'team1' ? oddsData.oddsTeam1 : oddsData.oddsTeam2;

  const res = StorageService.placeBet(
    state.currentCourtId,
    state.currentUser.id,
    state.betting.selectedTeam,
    state.betting.selectedAmount,
    selectedOdds
  );

  if (!res.success) {
    showToast(res.message || 'Không thể đặt cược!', 'error');
    return;
  }

  SoundService.playClick();
  showToast(`🎉 Đặt cược ${state.betting.selectedAmount} Xu thành công! Chúc bạn may mắn!`, 'success');
  state.currentUser = StorageService.getCurrentUser();
  renderUserAuthHeader();
  renderBettingWidget();
};

window.appOpenCourtBetsModal = function() {
  const modal = document.getElementById('modal-court-bets');
  if (!modal) return;

  const courtId = state.currentCourtId;
  const courtName = courtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const t1 = state.activeMatch?.team1 || [];
  const t2 = state.activeMatch?.team2 || [];

  const oddsData = calculateBettingOdds(t1, t2);

  const headerBox = document.getElementById('modal-court-bets-match-header');
  if (headerBox) {
    if (t1.length > 0 && t2.length > 0) {
      headerBox.innerHTML = `
        <div style="font-size: 0.78rem; color: var(--cyan); font-weight: 800; text-transform: uppercase;">
          🏸 ${courtName} • TỶ SỐ HIỆN TẠI: ${state.score1} - ${state.score2}
        </div>
        <div style="font-size: 0.95rem; font-weight: 800; color: var(--text-primary); margin-top: 4px;">
          <span style="color: #38bdf8;">${t1.map(p => p.name).join(' & ')}</span>
          <span style="color: var(--text-muted); font-size: 0.8rem; margin: 0 8px;">VS</span>
          <span style="color: #f43f5e;">${t2.map(p => p.name).join(' & ')}</span>
        </div>
      `;
    } else {
      headerBox.innerHTML = `<div style="color: var(--text-muted);">Chưa có trận đấu trên sân</div>`;
    }
  }

  const activeBets = StorageService.getBets(courtId, 'pending');
  const members = StorageService.getMembers();
  const memberMap = new Map(members.map(m => [m.id, m]));

  const t1Bets = activeBets.filter(b => b.predictedTeam === 'team1');
  const t2Bets = activeBets.filter(b => b.predictedTeam === 'team2');

  const t1Title = document.getElementById('bets-modal-t1-title');
  const t2Title = document.getElementById('bets-modal-t2-title');
  if (t1Title) t1Title.innerHTML = `Đội 1 (${oddsData.oddsTeam1}x) • ${t1Bets.length} vé`;
  if (t2Title) t2Title.innerHTML = `Đội 2 (${oddsData.oddsTeam2}x) • ${t2Bets.length} vé`;

  const renderBetList = (bets) => {
    if (bets.length === 0) {
      return `<div style="text-align: center; color: var(--text-muted); font-size: 0.78rem; padding: 16px 0;">Chưa ai cược cửa này</div>`;
    }
    return bets.map(b => {
      const mem = memberMap.get(b.memberId);
      const name = mem ? mem.name : 'Thành viên';
      const avatarUrl = mem ? getAvatarUrl(mem) : generateDefaultAvatar(name);
      return `
        <div class="modal-bet-item">
          <div class="modal-bet-user">
            <img src="${avatarUrl}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover;" alt="">
            <span>${name}</span>
          </div>
          <div class="modal-bet-amount">
            🪙 ${b.amount} Xu <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">(Ăn ${b.potentialPayout})</span>
          </div>
        </div>
      `;
    }).join('');
  };

  const t1List = document.getElementById('bets-modal-t1-list');
  const t2List = document.getElementById('bets-modal-t2-list');
  if (t1List) t1List.innerHTML = renderBetList(t1Bets);
  if (t2List) t2List.innerHTML = renderBetList(t2Bets);

  modal.classList.add('open');
};

/**
 * Tạo trận mới cho sân hiện tại với hiệu ứng xốc đĩa quay số
 */
function generateNewMatch(withAnimation = true) {
  const attendance = StorageService.getAttendance();
  const members = StorageService.getMembers();
  const guests = StorageService.getGuests();
  const allCandidates = [...members, ...guests];
  const presentMembers = allCandidates.filter(m => attendance.presentIds.includes(m.id));

  if (presentMembers.length < 4) {
    showToast(`Cần ít nhất 4 người có mặt tại sân để ghép trận! Hiện mới có ${presentMembers.length} người.`, 'error');
    return;
  }

  // Loại trừ những người đang đánh ở sân còn lại (Court 1 hoặc Court 2)
  const otherCourtId = state.currentCourtId === 'court_1' ? 'court_2' : 'court_1';
  const otherMatch = state.courtMatches[otherCourtId].activeMatch;
  const excludeIds = [];
  if (otherMatch && otherMatch.team1 && otherMatch.team2) {
    otherMatch.team1.forEach(p => p && excludeIds.push(p.id));
    otherMatch.team2.forEach(p => p && excludeIds.push(p.id));
  }

  const availablePresent = presentMembers.filter(m => !excludeIds.includes(m.id));

  if (availablePresent.length < 4) {
    const currentCourtName = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
    const otherCourtName = state.currentCourtId === 'court_2' ? 'Sân 1' : 'Sân 2';
    showToast(`Không đủ người để xếp trận cho ${currentCourtName} (${otherCourtName} đang có 4 người đánh, chỉ còn ${availablePresent.length} người rảnh)`, 'error');
    return;
  }

  const courtName = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const spinModal = document.getElementById('modal-spinner');
  const subtitle = document.getElementById('spinner-subtitle');

  if (withAnimation && spinModal) {
    if (subtitle) {
      if (state.matchmakerMode === 'mixed') {
        subtitle.textContent = `Đang ghép cặp Đôi Nam Nữ cho ${courtName}...`;
      } else if (state.matchmakerMode === 'random') {
        subtitle.textContent = `Đang xốc đĩa bốc thăm ngẫu nhiên cho ${courtName}...`;
      } else {
        subtitle.textContent = `Đang tính toán chênh lệch Elo nhỏ nhất cho ${courtName}...`;
      }
    }

    spinModal.classList.add('open');
    SoundService.playWhistle();

    setTimeout(() => {
      try {
        StorageService.refundMatchBets(state.currentCourtId, 'Tạo trận mới');
        const match = MatchmakerService.createMatch(
          presentMembers,
          attendance.gamesPlayedToday,
          state.matchmakerMode,
          excludeIds
        );
        match.courtNumber = courtName;
        state.activeMatch = match;
        state.score1 = 0;
        state.score2 = 0;
        StorageService.saveActiveMatch(match, state.currentCourtId);
        renderCourt();
        updateScoreboardDisplay();
        renderEloPrediction();
        updateCourtTabStatusPills();
        spinModal.classList.remove('open');
        showToast(`Đã xếp trận mới lên ${courtName}!`);
      } catch (err) {
        spinModal.classList.remove('open');
        showToast(err.message, 'error');
      }
    }, 600);
  } else {
    try {
      StorageService.refundMatchBets(state.currentCourtId, 'Tạo trận mới');
      const match = MatchmakerService.createMatch(
        presentMembers,
        attendance.gamesPlayedToday,
        state.matchmakerMode,
        excludeIds
      );
      match.courtNumber = courtName;
      state.activeMatch = match;
      state.score1 = 0;
      state.score2 = 0;
      StorageService.saveActiveMatch(match, state.currentCourtId);
      renderCourt();
      updateScoreboardDisplay();
      renderEloPrediction();
      updateCourtTabStatusPills();
      showToast(`Đã xếp trận mới lên ${courtName}!`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

/**
 * Ghép đồng thời 2 trận cho cả 2 sân (Cần tối thiểu 8 người có mặt)
 */
function spinBothCourts() {
  const attendance = StorageService.getAttendance();
  const members = StorageService.getMembers();
  const guests = StorageService.getGuests();
  const allCandidates = [...members, ...guests];
  const presentMembers = allCandidates.filter(m => attendance.presentIds.includes(m.id));

  if (presentMembers.length < 8) {
    showToast(`Cần tối thiểu 8 người có mặt để ghép cùng lúc 2 sân! (Hiện có ${presentMembers.length} người)`, 'error');
    return;
  }

  const spinModal = document.getElementById('modal-spinner');
  const subtitle = document.getElementById('spinner-subtitle');
  if (subtitle) subtitle.textContent = 'Đang bốc 8 người chia đều cho Sân 1 và Sân 2...';
  if (spinModal) spinModal.classList.add('open');
  SoundService.playWhistle();

  setTimeout(() => {
    try {
      StorageService.refundMatchBets('court_1', 'Ghép lại đồng thời cả 2 sân');
      StorageService.refundMatchBets('court_2', 'Ghép lại đồng thời cả 2 sân');

      // 1. Ghép Sân 1
      const match1 = MatchmakerService.createMatch(
        presentMembers,
        attendance.gamesPlayedToday,
        state.courtMatches.court_1.mode || 'balanced',
        []
      );
      match1.courtNumber = 'Sân 1';
      state.courtMatches.court_1.activeMatch = match1;
      state.courtMatches.court_1.score1 = 0;
      state.courtMatches.court_1.score2 = 0;
      StorageService.saveActiveMatch(match1, 'court_1');

      // 2. Ghép Sân 2 từ những người còn lại
      const excludeCourt1 = [...match1.team1.map(p => p.id), ...match1.team2.map(p => p.id)];
      const match2 = MatchmakerService.createMatch(
        presentMembers,
        attendance.gamesPlayedToday,
        state.courtMatches.court_2.mode || 'balanced',
        excludeCourt1
      );
      match2.courtNumber = 'Sân 2';
      state.courtMatches.court_2.activeMatch = match2;
      state.courtMatches.court_2.score1 = 0;
      state.courtMatches.court_2.score2 = 0;
      StorageService.saveActiveMatch(match2, 'court_2');

      if (spinModal) spinModal.classList.remove('open');
      SoundService.playFanfare();
      renderCourt();
      updateScoreboardDisplay();
      renderEloPrediction();
      updateCourtTabStatusPills();
      showToast('🎉 Đã ghép xong cả 2 sân cho 8 người!');
    } catch (err) {
      if (spinModal) spinModal.classList.remove('open');
      showToast(err.message, 'error');
    }
  }, 700);
}

/**
 * Xác nhận kết quả trận đấu & Cập nhật điểm Elo
 */
function finishMatch() {
  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2 ||
      state.activeMatch.team1.some(p => !p) || state.activeMatch.team2.some(p => !p)) {
    showToast('Cần có đủ 4 VĐV trên sân để lưu kết quả trận đấu!', 'error');
    return;
  }

  const s1 = Number(state.score1) || 0;
  const s2 = Number(state.score2) || 0;

  if (s1 === 0 && s2 === 0) {
    showToast('Trận đấu chưa diễn ra (tỷ số 0-0)! Vui lòng cập nhật điểm trước khi lưu.', 'error');
    return;
  }

  if (s1 === s2) {
    showToast('Tỷ số chưa có người thắng! Cầu lông không có tỉ số hòa.', 'error');
    return;
  }

  const maxScore = Math.max(s1, s2);
  const minScore = Math.min(s1, s2);

  if (maxScore < 11) {
    showToast('Tỷ số chưa hợp lệ! Điểm của đội thắng phải đạt ít nhất 11 điểm.', 'error');
    return;
  }

  if (maxScore > 30) {
    showToast('Tỷ số cầu lông tối đa là 30 điểm!', 'error');
    return;
  }

  // Deuce: khi cả 2 đội cùng từ 20 điểm trở lên
  if (minScore >= 20 && maxScore < 30 && (maxScore - minScore) < 2) {
    showToast('Trận đấu đang deuce (20 đều trở lên)! Đội thắng phải cách biệt 2 điểm (hoặc chạm mốc 30).', 'error');
    return;
  }

  const team1 = state.activeMatch.team1;
  const team2 = state.activeMatch.team2;
  const result = calculateDoublesElo(team1, team2, state.score1, state.score2);

  const team1Won = state.score1 > state.score2;
  const members = StorageService.getMembers();
  let leveledUpPlayer = null;

  // Cập nhật từng người chơi
  const updatePlayer = (player, delta, won) => {
    const mem = members.find(m => m.id === player.id);
    if (mem) {
      let finalDelta = delta;
      // Giai đoạn 3: Quyền lợi Thẻ Khiên Bảo Vệ Elo
      if (!won && delta < 0 && mem.activeEloShield) {
        // Giảm 50% số điểm trừ (làm tròn số nguyên)
        finalDelta = Math.min(-1, Math.round(delta * 0.5));
        StorageService.consumeEloShield(mem.id);
        setTimeout(() => {
          showToast(`🛡️ Khiên bảo vệ Elo của ${mem.name} đã kích hoạt! Giảm 50% điểm trừ (${delta} ➔ ${finalDelta})!`, 'info');
        }, 500);
      }

      const oldTier = getTierByElo(mem.elo);
      mem.elo = Math.max(500, mem.elo + finalDelta);
      const newTier = getTierByElo(mem.elo);

      mem.matchesPlayed = (mem.matchesPlayed || 0) + 1;
      if (won) {
        mem.wins = (mem.wins || 0) + 1;
        mem.streak = mem.streak > 0 ? mem.streak + 1 : 1;
      } else {
        mem.losses = (mem.losses || 0) + 1;
        mem.streak = mem.streak < 0 ? mem.streak - 1 : -1;
      }

      if (newTier.minElo > oldTier.minElo) {
        leveledUpPlayer = { player: mem, newTier };
      }
    } else if (player.id && player.id.startsWith('guest_')) {
      // Cập nhật điểm Elo tạm thời cho khách giao lưu trong buổi hôm nay
      StorageService.updateGuestElo(player.id, delta, won);
    }
  };

  team1.forEach(p => updatePlayer(p, result.deltaTeam1, team1Won));
  team2.forEach(p => updatePlayer(p, result.deltaTeam2, !team1Won));

  // Lưu members đã cập nhật vào LocalStorage
  StorageService.saveLocalMembers(members);

  // Chỉ cập nhật các thành viên thực sự tham gia trận đấu lên Cloud Supabase (bảo vệ tuyệt đối các thành viên khác không bị ghi đè)
  if (supabaseService.isConfigured()) {
    const inv = StorageService.getLocalInventory();
    const matchMemberIds = [...team1, ...team2].map(p => p.id).filter(id => id && !id.startsWith('guest_'));
    matchMemberIds.forEach(id => {
      const m = members.find(mem => mem.id === id);
      if (m) supabaseService.upsertMember(m, inv);
    });
  }

  // Lưu trận đấu vào lịch sử
  const activeCourt = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const savedMatch = StorageService.addMatch({
    courtNumber: activeCourt,
    team1: team1.map(p => p.id),
    team2: team2.map(p => p.id),
    score1: state.score1,
    score2: state.score2,
    deltaTeam1: result.deltaTeam1,
    deltaTeam2: result.deltaTeam2,
    eloChange: team1Won ? result.deltaTeam1 : result.deltaTeam2,
    isDeuce: result.isDeuce
  });

  // Ghi nhận số trận chơi hôm nay
  const allIds = [...team1.map(p => p.id), ...team2.map(p => p.id)];
  StorageService.recordGamePlayedToday(allIds);

  const winningTeam = team1Won ? team1 : team2;
  const losingTeam = team1Won ? team2 : team1;
  const allMatchPlayers = [...winningTeam, ...losingTeam];
  const todayStr = getLocalDateStr();

  // 1. Thưởng xu điểm danh buổi đánh: +50 Xu
  // QUY TẮC MỚI: Chỉ cộng vào TRẬN ĐẦU TIÊN TRONG NGÀY (phải thực sự có mặt thi đấu ít nhất 1 trận)
  allMatchPlayers.forEach(p => {
    if (p.id && !p.id.startsWith('guest_')) {
      const existingTxs = StorageService.getCoinTransactions(p.id);
      const alreadyGotDaily = existingTxs.some(t => t.type === 'session_checkin' && t.createdAt?.startsWith(todayStr));
      if (!alreadyGotDaily) {
        StorageService.addCoins(p.id, 50, 'session_checkin', `Thưởng điểm danh & thi đấu trận đầu tiên ngày ${todayStr}`);
        if (state.currentUser && state.currentUser.id === p.id) {
          setTimeout(() => {
            showToast(`🎁 Bạn nhận được +50 Xu điểm danh (Trận đấu đầu tiên trong ngày)!`, 'success');
          }, 300);
        }
      }
    }
  });

  // 2. Thưởng xu thi đấu (Giai đoạn 1): Thắng +20 Xu, Thua +5 Xu (Chỉ thành viên chính thức)
  winningTeam.forEach(p => {
    if (p.id && !p.id.startsWith('guest_')) {
      StorageService.addCoins(p.id, 20, 'match_win', `Thắng trận ${activeCourt} (${state.score1}-${state.score2})`);
    }
  });
  losingTeam.forEach(p => {
    if (p.id && !p.id.startsWith('guest_')) {
      StorageService.addCoins(p.id, 5, 'match_loss', `Hoàn thành trận ${activeCourt} (${state.score1}-${state.score2})`);
    }
  });

  // Quyết toán vé cược Giai đoạn 2
  const winningTeamKey = team1Won ? 'team1' : 'team2';
  const betResults = StorageService.settleMatchBets(state.currentCourtId, winningTeamKey, savedMatch?.id || '');

  if (state.currentUser) {
    state.currentUser = StorageService.getCurrentUser();
    renderUserAuthHeader();

    const myWonBet = betResults.wonBets.find(b => b.memberId === state.currentUser.id);
    const myLostBet = betResults.lostBets.find(b => b.memberId === state.currentUser.id);

    if (myWonBet) {
      setTimeout(() => {
        SoundService.playLevelUp();
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.5 }
        });
        showToast(`🎯 CHÚC MỪNG BẠN ĐÃ ĐOÁN ĐÚNG! Thắng cược nhận +${myWonBet.potentialPayout} Xu!`, 'success');
      }, 500);
    } else if (myLostBet) {
      showToast(`Tiếc quá, bạn đoán sai trận này! Chúc bạn may mắn ở trận sau nhé.`, 'info');
    }
  }

  // Hiệu ứng ăn mừng: Kèn fanfare + pháo giấy
  SoundService.playFanfare();
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 }
  });

  if (leveledUpPlayer) {
    setTimeout(() => {
      SoundService.playLevelUp();
      showToast(`🎉 CHÚC MỪNG ${leveledUpPlayer.player.name} THĂNG HẠNG: ${leveledUpPlayer.newTier.name}!`);
    }, 800);
  }

  showToast(`🏆 Trận đấu ${activeCourt} kết thúc! ${team1Won ? 'Đội 1' : 'Đội 2'} Thắng (${state.score1} - ${state.score2})`);

  // Đặt lại sân về trạng thái trống (idle) sẵn sàng cho trận tiếp theo
  const finishedCourtId = state.currentCourtId;
  const emptyMatch = { team1: [null, null], team2: [null, null] };
  state.courtMatches[finishedCourtId].activeMatch = emptyMatch;
  state.courtMatches[finishedCourtId].score1 = 0;
  state.courtMatches[finishedCourtId].score2 = 0;
  state.courtMatches[finishedCourtId].matchStatus = 'idle';
  state.courtMatches[finishedCourtId].scoreHistory = [];
  StorageService.saveActiveMatch(emptyMatch, finishedCourtId);
  renderCourt();
  updateCourtTabStatusPills();
}

/**
 * =========================================================================
 * 2. RENDER BẢNG XẾP HẠNG (LEADERBOARD)
 * =========================================================================
 */
function renderLeaderboard() {
  const members = StorageService.getMembers();
  const podiumContainer = document.getElementById('podium-section');
  const listContainer = document.getElementById('leaderboard-list-container');
  const countBadge = document.getElementById('total-members-count-badge');
  const subtitle = document.getElementById('lb-subtitle-desc');
  const genderFilter = state.leaderboardGender || 'all';

  // Lọc theo giới tính nếu có
  const filteredMembers = members.filter(m => {
    if (genderFilter === 'male') return m.gender === 'male';
    if (genderFilter === 'female') return m.gender === 'female';
    return true;
  });

  if (countBadge) {
    if (genderFilter === 'male') {
      countBadge.textContent = `${filteredMembers.length} VĐV Nam`;
    } else if (genderFilter === 'female') {
      countBadge.textContent = `${filteredMembers.length} VĐV Nữ`;
    } else {
      countBadge.textContent = `${filteredMembers.length} Thành Viên`;
    }
  }

  if (subtitle) {
    if (genderFilter === 'male') {
      subtitle.textContent = 'Bảng xếp hạng tài năng và phong độ dành riêng cho các tay vợt Nam ♂';
    } else if (genderFilter === 'female') {
      subtitle.textContent = 'Bảng xếp hạng tài năng và phong độ dành riêng cho các tay vợt Nữ ♀';
    } else {
      subtitle.textContent = 'Hệ thống Elo Đánh Đôi linh hoạt, phân chia rõ ràng trình độ & đóng góp';
    }
  }

  const isCoinSort = state.leaderboardSort === 'coins';

  // Sắp xếp danh sách
  const sortedMembers = [...filteredMembers].sort((a, b) => {
    // YÊU CẦU: Những ai chưa đánh trận nào (matchesPlayed === 0) luôn bị đẩy xuống cuối cùng
    // (Kể cả Elo khởi tạo có cao hơn, vì đây là người mới lập nick, chưa đúng trình độ)
    const playedA = (a.matchesPlayed || 0) > 0 ? 1 : 0;
    const playedB = (b.matchesPlayed || 0) > 0 ? 1 : 0;
    if (playedA !== playedB) {
      return playedB - playedA; // Người có trận (> 0) lên trước (1), người 0 trận xuống cuối (0)
    }

    if (state.leaderboardSort === 'matches') {
      return (b.matchesPlayed || 0) - (a.matchesPlayed || 0);
    } else if (state.leaderboardSort === 'wins') {
      return (b.wins || 0) - (a.wins || 0);
    } else if (state.leaderboardSort === 'winrate') {
      const rateA = a.matchesPlayed > 0 ? a.wins / a.matchesPlayed : 0;
      const rateB = b.matchesPlayed > 0 ? b.wins / b.matchesPlayed : 0;
      return rateB - rateA;
    } else if (state.leaderboardSort === 'coins') {
      return (b.coins !== undefined ? b.coins : 100) - (a.coins !== undefined ? a.coins : 100);
    } else {
      // Default: 'elo'
      return b.elo - a.elo;
    }
  });

  if (sortedMembers.length === 0) {
    if (podiumContainer) podiumContainer.innerHTML = '';
    if (listContainer) {
      let emptyTitle = 'CLB Thái Thịnh chưa có thành viên';
      let emptyDesc = 'Dữ liệu thành viên đang để trống để bạn tự nhập danh sách thật của CLB. Bấm nút bên dưới để thêm thành viên đầu tiên!';
      if (genderFilter === 'male') {
        emptyTitle = 'Chưa có VĐV Nam nào trong danh sách';
        emptyDesc = 'Hãy thêm thành viên Nam vào CLB để xuất hiện trên bảng xếp hạng này.';
      } else if (genderFilter === 'female') {
        emptyTitle = 'Chưa có VĐV Nữ nào trong danh sách';
        emptyDesc = 'Hãy thêm thành viên Nữ vào CLB để xuất hiện trên bảng xếp hạng này.';
      }

      listContainer.innerHTML = `
        <div class="empty-state-box" style="margin-top: 10px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🏸</div>
          <h3 class="empty-state-title">${emptyTitle}</h3>
          <p class="empty-state-desc">${emptyDesc}</p>
          <button class="btn btn-primary" onclick="window.appOpenAddMember()" style="padding: 10px 24px; font-weight: 700;">
            ➕ Thêm Thành Viên
          </button>
        </div>
      `;
    }
    return;
  }

  // Bục vinh danh (Top 3) chỉ dành riêng cho thành viên ĐÃ THI ĐẤU (matchesPlayed > 0)
  const activeMembersForPodium = sortedMembers.filter(m => (m.matchesPlayed || 0) > 0);
  if (podiumContainer && activeMembersForPodium.length < 3) {
    podiumContainer.innerHTML = '';
  }

  // Render Podium Top 3 (Hạng 2 bên trái, Hạng 1 ở giữa, Hạng 3 bên phải)
  if (podiumContainer && activeMembersForPodium.length >= 3) {
    const first = activeMembersForPodium[0];
    const second = activeMembersForPodium[1];
    const third = activeMembersForPodium[2];

    const renderPodiumItem = (p, rank, badgeClass, isFirst = false) => {
      const tier = getTierByElo(p.elo);
      const coins = p.coins !== undefined ? p.coins : 100;

      let richBadgeHtml = '';
      if (isCoinSort) {
        if (rank === '1') richBadgeHtml = `<div style="margin-top: 4px;"><span class="rich-title-badge rich-title-1">👑 Vua Xu CLB</span></div>`;
        else if (rank === '2') richBadgeHtml = `<div style="margin-top: 4px;"><span class="rich-title-badge rich-title-2">🥈 Phú Hộ CLB</span></div>`;
        else if (rank === '3') richBadgeHtml = `<div style="margin-top: 4px;"><span class="rich-title-badge rich-title-3">🥉 Triệu Phú CLB</span></div>`;
      }

      return `
        <div class="podium-card ${isFirst ? 'podium-first' : ''}" onclick="window.appViewPlayerProfile('${p.id}')" style="cursor: pointer;" title="Bấm để xem hồ sơ chi tiết">
          ${isFirst ? '<div class="podium-crown">👑</div>' : ''}
          <div class="podium-rank-badge ${badgeClass}">${rank}</div>
          <div style="display: flex; justify-content: center; margin-bottom: 6px;">
            ${renderAvatarHtml(p, { size: isFirst ? 'xl' : 'lg' })}
          </div>
          <div class="podium-name">${p.name}</div>
          ${isCoinSort 
            ? `
              <div class="podium-coin-amount">🪙 ${coins} Xu</div>
              ${richBadgeHtml}
              <div style="font-size: 0.74rem; color: var(--text-dim); margin-top: 4px;">
                ${p.matchesPlayed} trận • ${p.elo} Elo
              </div>
            `
            : `
              <div class="podium-elo">${p.elo} Elo</div>
              <div style="font-size: 0.72rem; color: ${tier.color}; font-weight: 700; margin-top: 2px;">
                ${tier.icon} ${tier.name}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 4px;">
                ${p.wins}T - ${p.losses}B (${p.matchesPlayed > 0 ? Math.round((p.wins/p.matchesPlayed)*100) : 0}%)
              </div>
            `}
        </div>
      `;
    };

    podiumContainer.innerHTML = `
      ${renderPodiumItem(second, '2', 'badge-silver')}
      ${renderPodiumItem(first, '1', 'badge-gold', true)}
      ${renderPodiumItem(third, '3', 'badge-bronze')}
    `;
  }

  // Render Danh sách bảng xếp hạng
  if (listContainer) {
    listContainer.innerHTML = sortedMembers.map((p, index) => {
      const rank = index + 1;
      const hasPlayed = (p.matchesPlayed || 0) > 0;
      const tier = getTierByElo(p.elo);
      const nextTierInfo = getNextTier(p.elo);
      const winRate = hasPlayed ? Math.round((p.wins / p.matchesPlayed) * 100) : 0;
      const coins = p.coins !== undefined ? p.coins : 100;

      return `
        <div class="leaderboard-row ${!hasPlayed ? 'is-unranked-row' : ''}" onclick="window.appViewPlayerProfile('${p.id}')" title="Bấm để xem hồ sơ chi tiết">
          <div class="lb-rank-num">${hasPlayed ? (rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : '#' + rank) : '—'}</div>
          <div style="flex-shrink: 0;">
            ${renderAvatarHtml(p, { size: 'md' })}
          </div>
          <div class="lb-member-details">
            <div class="lb-name-row">
              <span class="lb-name">${p.name}</span>
              ${p.nickname ? `<span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 600;">(${p.nickname})</span>` : ''}
              ${hasPlayed 
                ? `
                  <span class="tier-pill tier-${tier.id}" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
                    ${tier.icon} ${tier.name}
                  </span>
                ` 
                : `<span class="unranked-badge">Chưa đấu trận nào</span>`}
              ${p.activeEloShield ? '<span title="Khiên bảo vệ Elo đang BẬT" style="font-size: 0.85rem;">🛡️</span>' : ''}
            </div>
            <div class="lb-stats-sub">
              ${hasPlayed 
                ? `
                  <span>Đã đấu: <strong>${p.matchesPlayed}</strong></span>
                  <span>Thắng: <strong style="color: #4ade80;">${p.wins}</strong></span>
                  <span>Thua: <strong style="color: #f87171;">${p.losses}</strong></span>
                  <span>Tỷ lệ: <strong>${winRate}%</strong></span>
                  ${p.streak >= 2 ? `<span style="color: #ef4444; font-weight: 800;">🔥 Thắng ${p.streak} trận</span>` : ''}
                `
                : `
                  <span style="color: var(--text-dim);">Tài khoản mới • Đang chờ đánh trận đầu để kiểm chứng Elo</span>
                `}
            </div>
          </div>
          ${isCoinSort 
            ? `
              <div class="lb-elo-box">
                <div class="lb-coin-display">🪙 ${coins} Xu</div>
                <div class="lb-tier-label" style="color: #facc15; font-weight: 700;">${hasPlayed ? `Đại Gia #${rank}` : 'Mới tạo'}</div>
              </div>
            `
            : `
              <div class="lb-elo-box">
                <div class="lb-elo-num">${p.elo}</div>
                <div class="lb-tier-label">${hasPlayed ? (nextTierInfo.tier ? `Cần +${nextTierInfo.pointsNeeded} lên ${nextTierInfo.tier.name}` : 'Tối thượng') : 'Ước tính ban đầu'}</div>
              </div>
            `}
        </div>
      `;
    }).join('');
  }
}

/**
 * =========================================================================
 * 3. RENDER ĐIỂM DANH (ATTENDANCE)
 * =========================================================================
 */
function renderAttendance() {
  const members = StorageService.getMembers();
  const attendance = StorageService.getAttendance();
  const guests = StorageService.getGuests();
  const grid = document.getElementById('attendance-grid-container');

  if (!grid) return;

  if (members.length === 0 && guests.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1/-1;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">📋</div>
        <h4 class="empty-state-title">Chưa có thành viên để điểm danh</h4>
        <p class="empty-state-desc">Vui lòng thêm thành viên vào CLB hoặc thêm khách để bắt đầu điểm danh hôm nay.</p>
        <div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
          <button class="btn btn-primary" onclick="window.appOpenAddMember()">➕ Thêm Thành Viên</button>
          <button class="btn btn-secondary" onclick="window.appOpenAddGuestModal()">➕ Thêm Khách</button>
        </div>
      </div>
    `;
    return;
  }

  // 1. Render Khách Vãng Lai (Hiển thị đầu danh sách để dễ nhận diện & quản lý)
  const guestsHtml = guests.map(g => {
    const isPresent = attendance.presentIds.includes(g.id);
    const gamesCount = (attendance.gamesPlayedToday && attendance.gamesPlayedToday[g.id]) || 0;
    const tier = getTierByElo(g.elo);

    return `
      <div class="attendance-card is-guest ${isPresent ? 'present' : ''}" onclick="window.appToggleAttendance('${g.id}')">
        <div class="att-left">
          <div style="flex-shrink: 0;">
            ${renderAvatarHtml(g, { size: 'sm' })}
          </div>
          <div class="att-info">
            <div class="att-name">
              ${g.name}
              <span class="badge-guest">Khách ${g.gender === 'male' ? '♂' : '♀'}</span>
            </div>
            <div class="att-meta">
              ${tier.icon} ${g.elo} Elo • Hôm nay: ${gamesCount} trận
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" class="btn-remove-guest" onclick="event.stopPropagation(); window.appRemoveGuest('${g.id}')" title="Xóa khách này khỏi buổi hôm nay">
            ✕
          </button>
          <div class="att-status-check">
            ${isPresent ? '✓' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 2. Render Thành Viên Chính Thức Của CLB
  const membersHtml = members.map(m => {
    const isPresent = attendance.presentIds.includes(m.id);
    const gamesCount = (attendance.gamesPlayedToday && attendance.gamesPlayedToday[m.id]) || 0;

    return `
      <div class="attendance-card ${isPresent ? 'present' : ''}" onclick="window.appToggleAttendance('${m.id}')">
        <div class="att-left">
          <div style="flex-shrink: 0;">
            ${renderAvatarHtml(m, { size: 'sm' })}
          </div>
          <div class="att-info">
            <div class="att-name">${m.name}</div>
            <div class="att-meta">
              ${m.frequency === 'regular' ? '⚡ Nòng cốt' : '🍃 Thỉnh thoảng'} • Hôm nay: ${gamesCount} trận
            </div>
          </div>
        </div>
        <div class="att-status-check">
          ${isPresent ? '✓' : ''}
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = guestsHtml + membersHtml;
}

// Global hook để mở Modal Thêm Khách
window.appOpenAddGuestModal = function() {
  const modal = document.getElementById('modal-add-guest');
  if (!modal) return;
  const nameInput = document.getElementById('field-guest-name');
  const genderInput = document.getElementById('field-guest-gender');
  const eloInput = document.getElementById('field-guest-elo');
  if (nameInput) nameInput.value = '';
  if (genderInput) genderInput.value = 'male';
  if (eloInput) eloInput.value = '1000';
  modal.classList.add('open');
  if (nameInput) setTimeout(() => nameInput.focus(), 150);
};

// Global hook để submit form Thêm Khách
window.appSubmitAddGuest = function(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('field-guest-name');
  const genderInput = document.getElementById('field-guest-gender');
  const eloInput = document.getElementById('field-guest-elo');
  const name = nameInput ? nameInput.value.trim() : '';
  const gender = genderInput ? genderInput.value : 'male';
  const elo = eloInput ? Number(eloInput.value) || 1000 : 1000;

  if (!name) {
    showToast('Vui lòng nhập tên khách!', 'error');
    return;
  }

  const newGuest = StorageService.addGuest({ name, gender, elo });
  document.getElementById('modal-add-guest')?.classList.remove('open');
  SoundService.playClick();
  renderAttendance();
  updateSessionStatusBadge();
  renderCourtBench();
  showToast(`✅ Đã thêm khách "${newGuest.name}" (${newGuest.elo} Elo) vào sân hôm nay!`);
};

// Global hook để xóa khách khỏi danh sách hôm nay
window.appRemoveGuest = async function(guestId) {
  const guest = StorageService.getGuests().find(g => g.id === guestId);
  const guestName = guest ? guest.name : 'khách';
  const ok = await showConfirmModal({
    title: 'Xóa Khách Giao Lưu?',
    message: `Bạn có chắc muốn xóa "${guestName}" khỏi danh sách hôm nay?`,
    confirmText: 'Xóa Khách',
    icon: '👤',
    isDanger: true
  });
  if (!ok) return;

  // Nếu khách đang trên Sân 1 hoặc Sân 2, gỡ ra khỏi sân trước
  ['court_1', 'court_2'].forEach(cId => {
    const match = state.courtMatches?.[cId]?.activeMatch;
    if (match) {
      let changed = false;
      if (match.team1) {
        if (match.team1[0]?.id === guestId) { match.team1[0] = null; changed = true; }
        if (match.team1[1]?.id === guestId) { match.team1[1] = null; changed = true; }
      }
      if (match.team2) {
        if (match.team2[0]?.id === guestId) { match.team2[0] = null; changed = true; }
        if (match.team2[1]?.id === guestId) { match.team2[1] = null; changed = true; }
      }
      if (changed) {
        StorageService.saveActiveMatch(match, cId);
      }
    }
  });

  StorageService.removeGuest(guestId);
  SoundService.playClick();
  renderAttendance();
  updateSessionStatusBadge();
  renderCourt();
  renderCourtBench();
  showToast(`Đã xóa ${guestName} khỏi buổi hôm nay`);
};

// Global hook để gọi từ HTML onclick
window.appToggleAttendance = function(memberId) {
  const attendanceBefore = StorageService.getAttendance();
  const wasPresent = attendanceBefore.presentIds?.includes(memberId);

  StorageService.toggleAttendance(memberId);
  SoundService.playClick();
  renderAttendance();
  updateSessionStatusBadge();
  renderCourtBench();

  // Nếu là khách vãng lai: chỉ thông báo trạng thái, không tính xu điểm danh
  if (memberId.startsWith('guest_')) {
    const guest = StorageService.getGuests().find(g => g.id === memberId);
    showToast(wasPresent ? `Khách ${guest ? guest.name : ''} đã rời sân` : `✅ Khách ${guest ? guest.name : ''} đã có mặt!`);
    return;
  }

  // Thành viên chính thức: Chỉ đổi trạng thái có mặt / rời sân, KHÔNG cộng xu ngay khi tick
  const mem = StorageService.getMemberById(memberId);
  if (mem) {
    showToast(wasPresent ? `${mem.name} đã rời sân` : `✅ ${mem.name} đã điểm danh có mặt! (Xu điểm danh sẽ cộng sau trận đầu)`);
  }
};

/**
 * =========================================================================
 * 4. RENDER VINH DANH (BADGES / HALL OF FAME)
 * =========================================================================
 */
function renderBadges() {
  const members = StorageService.getMembers();
  const matches = StorageService.getMatches();
  const badges = calculateBadges(members, matches);
  const container = document.getElementById('badges-grid-container');

  if (!container) return;

  if (badges.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      Chưa có đủ dữ liệu trận đấu để trao danh hiệu vinh danh. Hãy chơi thêm vài set đấu nhé!
    </div>`;
    return;
  }

  container.innerHTML = badges.map(b => {
    const avatarUrl = getAvatarUrl(b.player);
    return `
      <div class="badge-honor-card">
        <div class="badge-glow-bg" style="background: ${b.color};"></div>
        <div class="badge-header">
          <span class="badge-large-icon">${b.icon}</span>
          <div class="badge-title-wrap">
            <h3 style="color: ${b.color};">${b.title}</h3>
            <div class="badge-desc">${b.detail}</div>
          </div>
        </div>
        <div class="badge-player-holder">
          <img class="badge-player-avatar" src="${avatarUrl}" alt="${b.player.name}" onerror="this.src='${generateDefaultAvatar(b.player.name, b.player.gender)}'">
          <div>
            <div class="badge-player-name">${b.player.name}</div>
            <div class="badge-player-detail">${b.player.nickname || 'Chiến binh CLB'} • ${b.player.elo} Elo</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * =========================================================================
 * 5. RENDER THÀNH VIÊN (MEMBERS MANAGEMENT)
 * =========================================================================
 */
function renderMembers() {
  const members = StorageService.getMembers();
  const container = document.getElementById('members-grid-container');
  if (!container) return;

  if (members.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <div style="font-size: 3.2rem; margin-bottom: 12px;">👥</div>
        <h3 class="empty-state-title">Chưa có thành viên nào trong danh sách</h3>
        <p class="empty-state-desc">
          Danh sách đang hoàn toàn trống để bạn tự thêm các anh chị em CLB Thái Thịnh (khoảng 10 bạn đánh thường xuyên & 10 bạn thỉnh thoảng), kèm ảnh đại diện và điểm Elo ban đầu.
        </p>
        <button class="btn btn-primary btn-lg" onclick="window.appOpenAddMember()">
          ➕ Thêm Thành Viên Ngay
        </button>
      </div>
    `;
    return;
  }

  let filtered = members;
  if (state.searchQuery) {
    filtered = members.filter(m => 
      m.name.toLowerCase().includes(state.searchQuery) ||
      (m.nickname && m.nickname.toLowerCase().includes(state.searchQuery))
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
        🔍 Không tìm thấy thành viên nào khớp với "<strong>${state.searchQuery}</strong>"
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const tier = getTierByElo(m.elo);
    const avatarUrl = getAvatarUrl(m);
    const winRate = m.matchesPlayed > 0 ? Math.round((m.wins / m.matchesPlayed) * 100) : 0;
    const isMe = state.currentUser && state.currentUser.id === m.id;
    const isAdmin = state.currentUser && state.currentUser.role === 'admin';

    let actionsHtml = '';
    if (isMe) {
      actionsHtml = `
        <div class="card-top-actions">
          <button class="btn-mini-action" onclick="window.appEditMember('${m.id}')" title="Chỉnh sửa thông tin của tôi" style="background: rgba(6,182,212,0.15); color: var(--cyan); border-color: rgba(6,182,212,0.4); font-size: 0.76rem; font-weight: 700; padding: 3px 8px; width: auto; border-radius: 6px;">
            ✎ Sửa của tôi
          </button>
        </div>
      `;
    } else if (isAdmin) {
      actionsHtml = `
        <div class="card-top-actions">
          <button class="btn-mini-action" onclick="window.appEditMember('${m.id}')" title="Quản trị: Sửa thành viên">✎</button>
          <button class="btn-mini-action btn-mini-danger" onclick="window.appDeleteMember('${m.id}')" title="Quản trị: Xóa thành viên">✕</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="card-top-actions">
          <span style="font-size: 0.76rem; color: #f59e0b; font-weight: 700; background: rgba(245,158,11,0.1); padding: 2px 7px; border-radius: 9999px; border: 1px solid rgba(245,158,11,0.25);">
            🪙 ${m.coins !== undefined ? m.coins : 100}
          </span>
        </div>
      `;
    }

    return `
      <div class="member-management-card" style="${isMe ? 'border-color: var(--cyan); box-shadow: 0 0 0 1.5px rgba(6,182,212,0.3);' : ''}">
        ${actionsHtml}

        <div class="member-card-profile" onclick="window.appViewPlayerProfile('${m.id}')" style="cursor: pointer;" title="Bấm để xem hồ sơ chi tiết">
          <div class="member-card-avatar-wrap" onclick="event.stopPropagation(); ${isMe || isAdmin ? `window.appTriggerAvatarUpload('${m.id}')` : `window.appViewPlayerProfile('${m.id}')`}" title="${isMe || isAdmin ? 'Bấm để đổi ảnh đại diện' : 'Xem hồ sơ'}">
            ${renderAvatarHtml(m, { size: 'md' })}
            ${isMe || isAdmin ? `<div class="camera-overlay-badge">📷</div>` : ''}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 800; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${m.name} ${isMe ? '<span style="font-size: 0.7rem; color: var(--cyan); background: rgba(6,182,212,0.12); padding: 1px 6px; border-radius: 4px; margin-left: 4px;">Tôi</span>' : ''}
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${m.nickname || 'Chưa có biệt danh'}</div>
            <div style="margin-top: 6px;">
              <span class="tier-pill tier-${tier.id}" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
                ${tier.icon} ${tier.name}
              </span>
            </div>
          </div>
        </div>

        <div class="member-stats-strip">
          <div class="stat-item">
            <div class="stat-val" style="color: var(--volt);">${m.elo}</div>
            <div class="stat-lbl">Elo</div>
          </div>
          <div class="stat-item">
            <div class="stat-val">${m.matchesPlayed}</div>
            <div class="stat-lbl">Số Trận</div>
          </div>
          <div class="stat-item">
            <div class="stat-val">${winRate}%</div>
            <div class="stat-lbl">Tỷ Lệ</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Global hook để Mở Modal Thêm Thành Viên
window.appOpenAddMember = function() {
  openMemberModal();
};

// Global hook để Bốc Thăm Trận Mới
window.appGenerateMatch = function() {
  generateNewMatch(true);
};

// Global hook để Bắt Đầu Trận Đấu & Kích hoạt bảng điểm trong sân
window.appStartMatch = function() {
  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2) {
    showToast('Chưa có đội hình trên sân để bắt đầu!', 'error');
    return;
  }
  state.matchStatus = 'in_progress';
  state.activeMatch.matchStatus = 'in_progress';
  StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
  SoundService.playWhistle();
  renderCourt();
  updateCourtTabStatusPills();
  renderBettingWidget();
  showToast('🚀 Trận đấu đã bắt đầu! Bảng điểm trực tiếp đã sẵn sàng.');
};

// Global hook để Dọn Sân (Xoá người chơi hiện tại)
window.appClearCourt = async function() {
  const courtName = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  const hasAnyPlayer = state.activeMatch && (
    (state.activeMatch.team1 && state.activeMatch.team1.some(Boolean)) ||
    (state.activeMatch.team2 && state.activeMatch.team2.some(Boolean))
  );
  if (!hasAnyPlayer && state.score1 === 0 && state.score2 === 0) {
    showToast(`${courtName} hiện đang trống!`, 'info');
    return;
  }
  const ok = await showConfirmModal({
    title: `Dọn Sạch ${courtName}?`,
    message: `Bạn có chắc chắn muốn dọn sạch ${courtName} để chọn người mới? Các vé cược của trận hiện tại sẽ được hoàn tiền.`,
    confirmText: 'Dọn Sân',
    icon: '🧹',
    isDanger: true
  });
  if (!ok) {
    return;
  }
  StorageService.refundMatchBets(state.currentCourtId, 'Dọn sân chọn người mới');
  const emptyMatch = {
    courtNumber: courtName,
    team1: [null, null],
    team2: [null, null],
    score1: 0,
    score2: 0,
    status: 'idle',
    matchStatus: 'idle',
    diffElo: 0,
    isSwappedSides: false
  };
  state.courtMatches[state.currentCourtId].activeMatch = emptyMatch;
  state.courtMatches[state.currentCourtId].score1 = 0;
  state.courtMatches[state.currentCourtId].score2 = 0;
  state.courtMatches[state.currentCourtId].matchStatus = 'idle';
  state.courtMatches[state.currentCourtId].isSwappedSides = false;
  state.courtMatches[state.currentCourtId].scoreHistory = [];
  await StorageService.saveActiveMatch(emptyMatch, state.currentCourtId);
  SoundService.playClick();
  renderCourt();
  updateCourtTabStatusPills();
  renderCourtBench();
  showToast(`🗑️ Đã dọn sạch ${courtName}! 4 vị trí đã sẵn sàng thêm mới.`);
};

// Global hook để Đổi Bên Sân (Trái / Phải)
window.appSwapCourtSides = function() {
  if (!state.activeMatch) {
    showToast('Chưa có trận đấu trên sân để đổi bên!', 'info');
    return;
  }
  state.isSwappedSides = !state.isSwappedSides;
  if (state.activeMatch) {
    state.activeMatch.isSwappedSides = state.isSwappedSides;
    StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
  }
  SoundService.playClick();
  renderCourt();
  showToast('🔄 Đã đổi bên sân hiển thị (Trái ⇋ Phải)!');
};

// Global hook để Hoàn Tác Điểm Vừa Bấm (Undo)
window.appUndoScore = function() {
  const hist = state.scoreHistory;
  if (!hist || hist.length === 0) {
    showToast('Chưa có thao tác điểm nào để hoàn tác!', 'info');
    return;
  }
  const prev = hist.pop();
  state.score1 = prev.score1;
  state.score2 = prev.score2;
  SoundService.playClick();
  updateScoreboardDisplay();
  renderEloPrediction();
  renderBettingWidget();
  debouncedSyncLiveScore();
  showToast(`↩️ Đã hoàn tác về tỷ số: ${state.score1} - ${state.score2}`);
};

// Global hook để Nhập Tỷ Số Bằng Bàn Phím Trực Tiếp
window.appPromptManualScore = function(isTeam1) {
  const currentVal = isTeam1 ? state.score1 : state.score2;
  const teamLabel = isTeam1 ? 'Đội 1' : 'Đội 2';
  const input = prompt(`Nhập tỷ số trực tiếp cho ${teamLabel} (từ 0 đến 30):`, currentVal);
  if (input === null) return;
  const val = parseInt(input.trim(), 10);
  if (isNaN(val) || val < 0 || val > 30) {
    showToast('Tỷ số không hợp lệ! Vui lòng nhập số từ 0 đến 30.', 'error');
    return;
  }
  if (!state.scoreHistory) state.scoreHistory = [];
  state.scoreHistory.push({ score1: state.score1, score2: state.score2 });
  if (isTeam1) {
    state.score1 = val;
  } else {
    state.score2 = val;
  }
  if (state.matchStatus === 'ready') {
    state.matchStatus = 'in_progress';
    if (state.activeMatch) state.activeMatch.matchStatus = 'in_progress';
  }
  SoundService.playClick();
  updateScoreboardDisplay();
  renderEloPrediction();
  renderBettingWidget();
  debouncedSyncLiveScore();
  showToast(`Đã đổi điểm ${teamLabel}: ${val}`);
};

// Global hook để Chuyển Tab từ nút UI
window.appSwitchTab = function(tabName) {
  switchTab(tabName);
};

// Global hook để Sửa Thành Viên (Chỉ sửa được của chính mình hoặc nếu là admin)
window.appEditMember = function(memberId) {
  const isMe = state.currentUser && state.currentUser.id === memberId;
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  if (!isMe && !isAdmin) {
    showToast('⛔ Bạn chỉ có thể chỉnh sửa thông tin của chính bản thân!', 'error');
    return;
  }
  openMemberModal(memberId);
};

// Global hook để Xóa Thành Viên (Chỉ Admin mới có quyền xóa)
window.appDeleteMember = async function(memberId) {
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  if (!isAdmin) {
    showToast('⛔ Chỉ Quản trị viên (Admin) mới có quyền xóa thành viên!', 'error');
    return;
  }
  const mem = StorageService.getMemberById(memberId);
  if (!mem) return;
  const ok = await showConfirmModal({
    title: 'Xóa Thành Viên?',
    message: `Bạn có chắc muốn xóa thành viên "${mem.name}" khỏi CLB Thái Thịnh? Dữ liệu thống kê của thành viên này sẽ bị gỡ bỏ.`,
    confirmText: 'Xóa Thành Viên',
    icon: '⚠️',
    isDanger: true
  });
  if (ok) {
    StorageService.deleteMember(memberId);
    showToast(`Đã xóa ${mem.name}`);
    renderMembers();
    renderLeaderboard();
    renderAttendance();
    renderCourt();
  }
};

// Global hook để kích hoạt Upload Avatar nhanh cho thành viên
window.appTriggerAvatarUpload = function(memberId) {
  const isMe = state.currentUser && state.currentUser.id === memberId;
  const isAdmin = state.currentUser && state.currentUser.role === 'admin';
  if (!isMe && !isAdmin) {
    showToast('⛔ Bạn chỉ có thể đổi ảnh đại diện của chính mình!', 'error');
    return;
  }
  openMemberModal(memberId);
  setTimeout(() => {
    const fileInput = document.getElementById('input-avatar-file');
    if (fileInput) fileInput.click();
  }, 100);
};

function openMemberModal(memberId = null) {
  state.editingMemberId = memberId;
  state.tempAvatarBase64 = null;

  const modal = document.getElementById('modal-member-form');
  const title = document.getElementById('member-modal-title');
  const nameInput = document.getElementById('field-member-name');
  const nickInput = document.getElementById('field-member-nickname');
  const genderSelect = document.getElementById('field-member-gender');
  const freqSelect = document.getElementById('field-member-frequency');
  const eloInput = document.getElementById('field-member-elo');
  const pinInput = document.getElementById('field-member-pin');
  const previewImg = document.getElementById('preview-avatar-img');
  const eloLockedMsg = document.getElementById('member-elo-locked-msg');
  const eloHint = document.getElementById('member-elo-hint');
  const lockedMatchesCount = document.getElementById('member-locked-matches-count');

  if (memberId) {
    const mem = StorageService.getMemberById(memberId);
    if (mem) {
      if (title) title.textContent = `Chỉnh Sửa: ${mem.name}`;
      if (nameInput) nameInput.value = mem.name;
      if (nickInput) nickInput.value = mem.nickname || '';
      if (genderSelect) genderSelect.value = mem.gender || 'male';
      if (freqSelect) freqSelect.value = mem.frequency || 'regular';
      if (pinInput) pinInput.value = mem.pinCode || '';
      if (previewImg) previewImg.src = getAvatarUrl(mem);

      // QUY TẮC ELO:
      // Nếu đã thi đấu > 0 trận: KHÓA CHẶT ô điểm Elo, không cho sửa
      // Nếu chưa thi đấu trận nào (0 trận): cho phép chỉnh sửa điểm khởi điểm
      const matchesPlayed = Number(mem.matchesPlayed) || 0;
      if (eloInput) {
        eloInput.value = mem.elo || 1000;
        if (matchesPlayed > 0) {
          eloInput.disabled = true;
          if (eloLockedMsg) eloLockedMsg.style.display = 'block';
          if (lockedMatchesCount) lockedMatchesCount.textContent = matchesPlayed;
          if (eloHint) eloHint.style.display = 'none';
        } else {
          eloInput.disabled = false;
          if (eloLockedMsg) eloLockedMsg.style.display = 'none';
          if (eloHint) eloHint.style.display = 'block';
        }
      }
    }
  } else {
    if (title) title.textContent = 'Thêm Thành Viên Mới';
    if (nameInput) nameInput.value = '';
    if (nickInput) nickInput.value = '';
    if (genderSelect) genderSelect.value = 'male';
    if (freqSelect) freqSelect.value = 'regular';
    if (pinInput) pinInput.value = '1234';
    if (previewImg) previewImg.src = generateDefaultAvatar('Mới', 'male');
    if (eloInput) {
      eloInput.value = 1000;
      eloInput.disabled = false;
      if (eloLockedMsg) eloLockedMsg.style.display = 'none';
      if (eloHint) eloHint.style.display = 'block';
    }
  }

  if (genderSelect) {
    genderSelect.onchange = () => {
      if (!state.tempAvatarBase64) {
        const currentName = (nameInput && nameInput.value.trim()) || 'Mới';
        if (previewImg) previewImg.src = generateDefaultAvatar(currentName, genderSelect.value);
      }
    };
  }

  if (modal) modal.classList.add('open');
}

function handleMemberFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('field-member-name').value.trim();
  const nickname = document.getElementById('field-member-nickname').value.trim();
  const gender = document.getElementById('field-member-gender').value;
  const frequency = document.getElementById('field-member-frequency').value;
  const elo = parseInt(document.getElementById('field-member-elo').value, 10) || 1000;
  const pinInput = document.getElementById('field-member-pin');
  const pinCode = pinInput ? pinInput.value.trim() : '';

  if (!name) {
    showToast('Vui lòng nhập họ và tên', 'error');
    return;
  }

  if (state.editingMemberId) {
    const mem = StorageService.getMemberById(state.editingMemberId);
    const matchesPlayed = Number(mem?.matchesPlayed) || 0;
    // QUY TẮC ELO: Nếu đã có trận đấu, giữ nguyên Elo, không cho sửa
    const finalElo = matchesPlayed > 0 ? (mem?.elo || 1000) : elo;
    const updateData = {
      name,
      nickname,
      gender,
      frequency,
      elo: finalElo,
      pinCode: pinCode || mem?.pinCode || ''
    };
    if (state.tempAvatarBase64) {
      updateData.avatar = state.tempAvatarBase64;
    }
    StorageService.updateMember(state.editingMemberId, updateData);
    if (state.currentUser && state.currentUser.id === state.editingMemberId) {
      state.currentUser = StorageService.getCurrentUser();
      renderUserAuthHeader();
    }
    showToast(`Đã cập nhật thông tin ${name}`);
  } else {
    const newMember = StorageService.addMember({
      name,
      nickname,
      gender,
      frequency,
      elo,
      pinCode: pinCode || '1234',
      avatar: state.tempAvatarBase64 || ''
    });

    // Nếu chưa đăng nhập ai thì tự động đăng nhập luôn thành viên mới
    if (!state.currentUser) {
      StorageService.setCurrentUser(newMember.id);
      state.currentUser = StorageService.getCurrentUser();
      renderUserAuthHeader();
    }

    // Tự động thêm vào điểm danh hôm nay NẾU CÓ LỊCH SÂN HỢP LỆ
    if (StorageService.hasScheduledSessionToday()) {
      StorageService.toggleAttendance(newMember.id);
    }
    showToast(`Đã thêm thành viên: ${name} (+100 Xu tân thủ)`);
  }

  closeAllModals();
  renderMembers();
  renderLeaderboard();
  renderAttendance();
  updateSessionStatusBadge();
}

/**
 * =========================================================================
 * 6. RENDER LỊCH SỬ (MATCH HISTORY)
 * =========================================================================
 */
function renderHistory() {
  const matches = StorageService.getMatches();
  const allPeople = [...StorageService.getMembers(), ...StorageService.getGuests()];
  const container = document.getElementById('history-matches-container');
  const countBadge = document.getElementById('total-matches-count-badge');

  if (countBadge) countBadge.textContent = `${matches.length} Trận`;
  if (!container) return;

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="text-align: center; padding: 48px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px; margin: 16px 0;">
        <div style="font-size: 3rem; margin-bottom: 12px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));">📜</div>
        <h3 style="margin: 0 0 6px; font-size: 1.1rem; color: var(--text-main);">Chưa Có Trận Đấu Nào</h3>
        <p style="margin: 0 auto 16px; max-width: 320px; font-size: 0.88rem; color: var(--text-muted); line-height: 1.5;">
          Các trận đấu diễn ra trên Sân 1 và Sân 2 sau khi xác nhận kết quả sẽ được lưu trữ và thống kê chi tiết tại đây.
        </p>
        <button type="button" class="btn btn-primary" onclick="window.appSwitchTab('court')" style="font-size: 0.85rem; padding: 8px 18px;">
          🏸 Vào Sân Đấu Ngay
        </button>
      </div>
    `;
    return;
  }

  const limit = state.historyLimit || 20;
  const displayMatches = matches.slice(0, limit);
  const hasMore = matches.length > limit;

  const personMap = new Map(allPeople.map(m => [m.id, m]));

  const cardsHtml = displayMatches.map(m => {
    const t1Names = m.team1.map(id => personMap.get(id)?.name || 'VĐV').join(' & ');
    const t2Names = m.team2.map(id => personMap.get(id)?.name || 'VĐV').join(' & ');
    const team1Won = m.score1 > m.score2;
    const dateStr = new Date(m.timestamp).toLocaleDateString('vi-VN', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
    });

    return `
      <div class="match-history-card">
        <div class="match-history-teams">
          <div class="history-team-col ${team1Won ? 'history-team-winner' : 'history-team-loser'}">
            ${team1Won ? '🏆 ' : ''}${t1Names}
          </div>
          <div class="history-score-badge">
            <span style="color: ${team1Won ? 'var(--volt)' : 'var(--text-muted)'};">${m.score1}</span>
            <span style="color: var(--text-dim); margin: 0 4px;">-</span>
            <span style="color: ${!team1Won ? 'var(--volt)' : 'var(--text-muted)'};">${m.score2}</span>
          </div>
          <div class="history-team-col ${!team1Won ? 'history-team-winner' : 'history-team-loser'}" style="text-align: right;">
            ${!team1Won ? '🏆 ' : ''}${t2Names}
          </div>
        </div>
        <div class="history-meta-col">
          <div style="font-weight: 800; color: var(--cyan); margin-bottom: 2px;">🏸 ${m.courtNumber || 'Sân 1'}</div>
          <div>${dateStr}</div>
          <div style="color: var(--volt); font-weight: 700; margin-top: 2px;">
            ${m.deltaTeam1 !== undefined && m.deltaTeam2 !== undefined
              ? (team1Won ? `+${m.deltaTeam1} / ${m.deltaTeam2}` : `+${m.deltaTeam2} / ${m.deltaTeam1}`)
              : `±${m.eloChange || 16}`} Elo ${m.isDeuce ? '• Deuce' : ''}
          </div>
          <button onclick="window.appDeleteMatch('${m.id}')" style="background: none; border: none; color: var(--coral); cursor: pointer; font-size: 0.75rem; margin-top: 4px;">
            Hoàn tác trận
          </button>
        </div>
      </div>
    `;
  }).join('');

  const loadMoreHtml = hasMore ? `
    <div style="text-align: center; padding: 16px 0 8px;">
      <button type="button" class="btn btn-secondary" onclick="window.appLoadMoreHistory()" style="font-size: 0.85rem; padding: 8px 24px; border-radius: 20px;">
        🔽 Xem thêm (${matches.length - limit} trận cũ hơn)
      </button>
    </div>
  ` : '';

  container.innerHTML = cardsHtml + loadMoreHtml;
}

window.appLoadMoreHistory = function() {
  state.historyLimit = (state.historyLimit || 20) + 20;
  renderHistory();
};

// Global hook để Hoàn tác / Xóa trận đấu (Khôi phục toàn diện điểm số & số trận)
window.appDeleteMatch = async function(matchId) {
  const ok = await showConfirmModal({
    title: 'Hoàn Tác Trận Đấu?',
    message: 'Bạn có chắc muốn hoàn tác và xóa trận đấu này? Điểm Elo, số trận, xu thắng/thua và xu điểm danh sẽ được khôi phục nguyên vẹn về trước trận.',
    confirmText: 'Hoàn Tác',
    icon: '↩️',
    isDanger: true
  });
  if (ok) {
    showToast('Đang hoàn tác trận đấu & cập nhật điểm số...', 'info');
    try {
      const reverted = await StorageService.undoMatch(matchId);
      if (reverted) {
        showToast('Đã hoàn tác trận đấu & khôi phục thông số!');
        renderHistory();
        renderLeaderboard();
        renderMembers();
        renderCourt();
        renderBadges();
        updateSessionStatusBadge();
      } else {
        showToast('Không tìm thấy trận đấu cần hoàn tác', 'error');
      }
    } catch (err) {
      console.error('[App] Lỗi hoàn tác trận đấu:', err);
      showToast('Lỗi khi hoàn tác trận: ' + (err.message || err), 'error');
    }
  }
};

/**
 * =========================================================================
 * TÙY CHỈNH / ĐỔI CẦU THỦ TRÊN SÂN (CUSTOMIZE MATCH PLAYERS)
 * =========================================================================
 */
state.swapTarget = null; // { teamKey: 'team1'|'team2', slotIndex: 0|1, currentMemberId: string }

window.appOpenSwapPlayerModal = function(teamKey, slotIndex) {
  if (!state.activeMatch) state.activeMatch = { team1: [null, null], team2: [null, null] };
  if (!state.activeMatch[teamKey]) state.activeMatch[teamKey] = [null, null];
  while (state.activeMatch[teamKey].length < 2) state.activeMatch[teamKey].push(null);

  const currentTeam = state.activeMatch[teamKey];
  const currentPlayer = currentTeam[slotIndex] || null;

  state.swapTarget = { teamKey, slotIndex, currentMemberId: currentPlayer ? currentPlayer.id : null };

  const targetLabel = document.getElementById('swap-target-label');
  if (targetLabel) {
    const teamName = teamKey === 'team1' ? '🔵 Đội 1' : '🟠 Đội 2';
    targetLabel.innerHTML = currentPlayer 
      ? `${teamName} (Vị trí ${slotIndex + 1}) — Hiện tại: <strong>${currentPlayer.name}</strong> (${currentPlayer.elo} Elo)`
      : `${teamName} (Vị trí ${slotIndex + 1}) — <strong>Chọn VĐV vào vị trí trống</strong>`;
  }

  const unassignWrap = document.getElementById('swap-unassign-btn-wrap');
  if (unassignWrap) {
    unassignWrap.style.display = currentPlayer ? 'block' : 'none';
  }

  const searchInput = document.getElementById('input-search-swap-player');
  if (searchInput) searchInput.value = '';

  renderSwapPlayerList();

  const modal = document.getElementById('modal-swap-court-player');
  if (modal) modal.classList.add('open');
};

window.appRemovePlayerFromSlot = function() {
  if (!state.activeMatch || !state.swapTarget) return;
  const { teamKey, slotIndex } = state.swapTarget;
  if (state.activeMatch[teamKey]) {
    const removedPlayer = state.activeMatch[teamKey][slotIndex];
    state.activeMatch[teamKey][slotIndex] = null;
    StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
    document.getElementById('modal-swap-court-player')?.classList.remove('open');
    state.swapTarget = null;
    SoundService.playClick();
    renderCourt();
    debouncedSyncLiveScore();
    showToast(removedPlayer ? `Đã gỡ ${removedPlayer.name} ra khỏi sân!` : 'Đã để trống vị trí này!');
  }
};

function renderSwapPlayerList(query = '') {
  const container = document.getElementById('swap-player-list-container');
  if (!container || !state.swapTarget) return;

  const allMembers = StorageService.getMembers();
  const guests = StorageService.getGuests();
  const allCandidates = [...allMembers, ...guests];
  const attendance = StorageService.getAttendance();
  const presentIds = attendance.presentIds || [];
  const gamesPlayedToday = attendance.gamesPlayedToday || {};

  // Lấy ID của những người đang thực sự trên sân (loại bỏ null)
  const onCourtIds = [
    ...(state.activeMatch?.team1?.filter(Boolean).map(p => p.id) || []),
    ...(state.activeMatch?.team2?.filter(Boolean).map(p => p.id) || [])
  ];

  const q = query.trim().toLowerCase();
  let filtered = allCandidates;
  if (q) {
    filtered = allCandidates.filter(m => 
      m.name.toLowerCase().includes(q) || 
      (m.nickname && m.nickname.toLowerCase().includes(q))
    );
  }

  // Sắp xếp:
  // 1. Người có mặt hôm nay lên trước
  // 2. Trong số người có mặt, người đang nghỉ ngoài sân ưu tiên hơn
  // 3. Trong số người nghỉ, người chơi ít trận hơn hôm nay lên trước
  filtered.sort((a, b) => {
    const aPres = presentIds.includes(a.id) ? 1 : 0;
    const bPres = presentIds.includes(b.id) ? 1 : 0;
    if (aPres !== bPres) return bPres - aPres;

    const aOnCourt = onCourtIds.includes(a.id) ? 1 : 0;
    const bOnCourt = onCourtIds.includes(b.id) ? 1 : 0;
    if (aOnCourt !== bOnCourt) return aOnCourt - bOnCourt;

    const aGames = gamesPlayedToday[a.id] || 0;
    const bGames = gamesPlayedToday[b.id] || 0;
    if (aGames !== bGames) return aGames - bGames;

    return b.elo - a.elo;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 20px;">Không tìm thấy thành viên hoặc khách nào phù hợp</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const isCurrent = state.swapTarget.currentMemberId && m.id === state.swapTarget.currentMemberId;
    const isOnCourt = onCourtIds.includes(m.id);
    const isPresent = presentIds.includes(m.id);
    const tier = getTierByElo(m.elo);
    const avatarUrl = getAvatarUrl(m);
    const games = gamesPlayedToday[m.id] || 0;

    let badgeHtml = '';
    let itemClass = 'swap-player-item';

    if (isCurrent) {
      itemClass += ' is-current';
      badgeHtml = `<span class="swap-action-badge swap-badge-current">Đang ở vị trí này</span>`;
    } else if (isOnCourt) {
      itemClass += ' is-on-court';
      badgeHtml = `<span class="swap-action-badge swap-badge-switch">🔄 Đổi chỗ</span>`;
    } else {
      badgeHtml = `<span class="swap-action-badge swap-badge-in">➕ Vào sân</span>`;
    }

    const presentTag = isPresent 
      ? `<span style="color: #10b981; font-weight: 700;">● Có mặt (${games} trận)</span>` 
      : `<span style="color: var(--text-dim);">Chưa điểm danh</span>`;

    return `
      <div class="${itemClass}" onclick="window.appApplySwapPlayer('${m.id}')">
        <img class="swap-player-avatar" src="${avatarUrl}" alt="${m.name}" onerror="this.src='${generateDefaultAvatar(m.name, m.gender)}'">
        <div class="swap-player-info">
          <div class="swap-player-name">${m.name} ${m.nickname ? `(${m.nickname})` : ''} ${m.isGuest ? '<span class="badge-guest">Khách</span>' : ''}</div>
          <div class="swap-player-meta">
            <span style="color: ${tier.color}; font-weight: 700;">${tier.icon} ${m.elo} Elo</span>
            <span>•</span>
            ${presentTag}
          </div>
        </div>
        ${badgeHtml}
      </div>
    `;
  }).join('');
}

window.appApplySwapPlayer = function(newMemberId) {
  if (!state.activeMatch || !state.swapTarget) return;
  const { teamKey, slotIndex, currentMemberId } = state.swapTarget;

  if (currentMemberId && newMemberId === currentMemberId) {
    document.getElementById('modal-swap-court-player')?.classList.remove('open');
    return;
  }

  const newMember = StorageService.getMemberById(newMemberId);
  const currentMember = currentMemberId ? StorageService.getMemberById(currentMemberId) : null;
  if (!newMember) return;

  const t1 = state.activeMatch.team1 || [null, null];
  const t2 = state.activeMatch.team2 || [null, null];

  let existingSlot = null;
  if (t1[0]?.id === newMemberId) existingSlot = { teamKey: 'team1', slotIndex: 0 };
  else if (t1[1]?.id === newMemberId) existingSlot = { teamKey: 'team1', slotIndex: 1 };
  else if (t2[0]?.id === newMemberId) existingSlot = { teamKey: 'team2', slotIndex: 0 };
  else if (t2[1]?.id === newMemberId) existingSlot = { teamKey: 'team2', slotIndex: 1 };

  if (existingSlot) {
    state.activeMatch[existingSlot.teamKey][existingSlot.slotIndex] = currentMember || null;
    state.activeMatch[teamKey][slotIndex] = newMember;
    if (currentMember) {
      showToast(`Đã đổi chỗ ${currentMember.name} 🔁 ${newMember.name}!`);
    } else {
      showToast(`Đã chuyển ${newMember.name} sang vị trí này!`);
    }
  } else {
    state.activeMatch[teamKey][slotIndex] = newMember;
    if (currentMember) {
      showToast(`Đã đưa ${newMember.name} vào sân thay cho ${currentMember.name}!`);
    } else {
      showToast(`Đã thêm ${newMember.name} vào sân!`);
    }
  }

  const validT1 = state.activeMatch.team1.filter(Boolean);
  const validT2 = state.activeMatch.team2.filter(Boolean);
  const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
  const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;
  state.activeMatch.diffElo = Math.abs(elo1 - elo2);

  StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);

  document.getElementById('modal-swap-court-player')?.classList.remove('open');
  state.swapTarget = null;

  SoundService.playClick();
  renderCourt();
  debouncedSyncLiveScore();
};

/**
 * =========================================================================
 * UTILITIES
 * =========================================================================
 */
function updateSessionStatusBadge() {
  const attendance = StorageService.getAttendance();
  const members = StorageService.getMembers();
  const guests = StorageService.getGuests();
  const matches = StorageService.getMatches();

  const allAttendees = [...members, ...guests].filter(p => attendance.presentIds.includes(p.id));
  const presentCount = allAttendees.length;
  const maleCount = allAttendees.filter(m => m.gender === 'male').length;
  const femaleCount = allAttendees.filter(m => m.gender === 'female').length;

  const counterEl = document.getElementById('session-counter-text');
  if (counterEl) {
    counterEl.textContent = `Hôm nay: ${presentCount} người (${maleCount} Nam, ${femaleCount} Nữ) | Đã đấu: ${matches.length} trận`;
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
}

let activeToastTimer = null;
let activeToastExitTimer = null;

/**
 * Hiển thị thông báo Toast dạng Dynamic Island Pill ở đỉnh màn hình
 * NGUYÊN TẮC: Luôn chỉ có DUY NHẤT 1 thông báo hiển thị tại một thời điểm.
 * Thông báo mới sẽ thay thế ngay thông báo cũ, không bao giờ xếp chồng làm kín màn hình.
 */
function showToast(message, type = 'success', duration = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // 1. Hủy bỏ timer của thông báo cũ (nếu có)
  if (activeToastTimer) {
    clearTimeout(activeToastTimer);
    activeToastTimer = null;
  }
  if (activeToastExitTimer) {
    clearTimeout(activeToastExitTimer);
    activeToastExitTimer = null;
  }

  // 2. Dọn sạch container ngay lập tức - Không cho phép dồn toa / xếp chồng
  container.innerHTML = '';

  // 3. Tạo phần tử Toast mới
  const toast = document.createElement('div');
  toast.className = `toast ${type} toast-${type}`;

  // Kiểm tra nếu thông điệp đã có sẵn emoji ở đầu thì không chèn thêm icon nữa
  const trimmed = message.trim();
  const hasLeadingEmoji = /^(\p{Extended_Pictographic}|\u26A1|\u2600|\u2728|\u2705|\u23F0|\u26A0)/u.test(trimmed);

  if (hasLeadingEmoji) {
    toast.innerHTML = `<span class="toast-msg">${trimmed}</span>`;
  } else {
    let icon = '⚡';
    if (type === 'error') icon = '⚠️';
    else if (type === 'info') icon = 'ℹ️';
    else if (type === 'success') icon = '✨';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${trimmed}</span>`;
  }

  // 4. Cho phép chạm/click để đóng ngay lập tức
  toast.onclick = () => {
    if (activeToastTimer) clearTimeout(activeToastTimer);
    activeToastTimer = null;
    toast.classList.add('toast-exit');
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 180);
  };

  container.appendChild(toast);

  // 5. Thời gian tồn tại vừa đủ đọc, tự biến mất nhanh gọn (Lỗi: 2.5s, Thông thường: 1.7s)
  const displayTime = duration || (type === 'error' ? 2500 : 1700);

  activeToastTimer = setTimeout(() => {
    toast.classList.add('toast-exit');
    activeToastExitTimer = setTimeout(() => {
      if (toast.parentNode) toast.remove();
      activeToastExitTimer = null;
    }, 200);
  }, displayTime);
}
window.showToast = showToast;

/**
 * Modal Xác Nhận Hiện Đại (Thay thế confirm native của trình duyệt)
 */
export function showConfirmModal({
  title = 'Xác Nhận Thao Tác',
  message = '',
  confirmText = 'Đồng Ý',
  cancelText = 'Hủy',
  icon = '⚠️',
  isDanger = false
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirm');
    if (!modal) {
      resolve(window.confirm(message));
      return;
    }
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const iconEl = document.getElementById('confirm-modal-icon');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    if (okBtn) {
      okBtn.textContent = confirmText;
      if (isDanger) {
        okBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        okBtn.style.borderColor = '#ef4444';
      } else {
        okBtn.style.background = '';
        okBtn.style.borderColor = '';
      }
    }
    if (cancelBtn) cancelBtn.textContent = cancelText;

    let resolved = false;
    const cleanup = (result) => {
      if (resolved) return;
      resolved = true;
      modal.classList.remove('open');
      okBtn?.removeEventListener('click', onOk);
      cancelBtn?.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === modal) cleanup(false);
    };

    okBtn?.addEventListener('click', onOk);
    cancelBtn?.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);

    modal.classList.add('open');
  });
}
window.showConfirmModal = showConfirmModal;

function updateCloudStatusIndicator(isSyncing = false) {
  const dot = document.getElementById('cloud-status-dot');
  const text = document.getElementById('cloud-status-text');
  const btn = document.getElementById('btn-cloud-status');
  if (!dot || !text) return;

  if (isSyncing) {
    dot.style.background = '#06b6d4';
    dot.style.boxShadow = '0 0 10px #06b6d4';
    text.textContent = 'Đang đồng bộ...';
    text.style.color = '#0891b2';
    if (btn) {
      btn.style.background = 'rgba(6, 182, 212, 0.15)';
      btn.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    }
    return;
  }

  if (supabaseService.isConfigured()) {
    dot.style.background = '#10b981';
    dot.style.boxShadow = '0 0 8px #10b981';
    text.textContent = 'Cloud OK';
    text.style.color = '#047857';
    if (btn) {
      btn.style.background = 'rgba(16, 185, 129, 0.12)';
      btn.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      btn.title = 'Supabase Cloud: Đã kết nối & Đồng bộ tự động (Bấm để mở cài đặt)';
    }
  } else {
    dot.style.background = '#f59e0b';
    dot.style.boxShadow = '0 0 6px #f59e0b';
    text.textContent = 'Cục Bộ';
    text.style.color = '#b45309';
    if (btn) {
      btn.style.background = 'rgba(245, 158, 11, 0.12)';
      btn.style.borderColor = 'rgba(245, 158, 11, 0.35)';
      btn.title = 'Chế độ lưu cục bộ trên máy (Bấm để kết nối Supabase Cloud)';
    }
  }
}

async function initCloudSyncAndRealtime() {
  updateCloudStatusIndicator();

  if (!supabaseService.isConfigured()) return;

  // 1. Tự động đồng bộ dữ liệu mới nhất từ Supabase Cloud khi mở app
  updateCloudStatusIndicator(true);
  try {
    const synced = await StorageService.syncFromCloud();
    if (synced) {
      loadInitialState();
      state.currentUser = StorageService.getCurrentUser();
      renderUserAuthHeader();
      switchTab(state.currentTab);
      updateSessionStatusBadge();
      console.log('[App] Đã đồng bộ dữ liệu mới nhất từ Supabase Cloud!');
    }
  } finally {
    updateCloudStatusIndicator(false);
  }

  // 2. Lắng nghe thay đổi Realtime (tự động đồng bộ đa thiết bị tức thì)
  supabaseService.subscribeToChanges(async (table, payload) => {
    console.log(`[Realtime] Nhận được thay đổi ở bảng ${table}:`, payload);

    if (table === 'live_court') {
      const record = payload.new;
      if (record && (record.id === 'court_1' || record.id === 'court_2' || record.id === 'current_court')) {
        const targetCourtId = record.id === 'court_2' ? 'court_2' : 'court_1';
        let allPeople = [...StorageService.getMembers(), ...StorageService.getGuests()];
        let personMap = new Map(allPeople.map(p => [p.id, p]));

        // Kiểm tra nếu có người chơi (đặc biệt là khách) chưa có trong local cache
        const allIds = [...(record.team1 || []), ...(record.team2 || [])].filter(Boolean);
        const missingPerson = allIds.some(id => !personMap.has(id));
        if (missingPerson) {
          await StorageService.syncFromCloud();
          allPeople = [...StorageService.getMembers(), ...StorageService.getGuests()];
          personMap = new Map(allPeople.map(p => [p.id, p]));
        }

        const t1Raw = record.team1 || [];
        const t2Raw = record.team2 || [];
        const slotT1 = [
          t1Raw[0] ? personMap.get(t1Raw[0]) || null : null,
          t1Raw[1] ? personMap.get(t1Raw[1]) || null : null
        ];
        const slotT2 = [
          t2Raw[0] ? personMap.get(t2Raw[0]) || null : null,
          t2Raw[1] ? personMap.get(t2Raw[1]) || null : null
        ];

        const hasAnyPlayer = slotT1.some(Boolean) || slotT2.some(Boolean);

        if (hasAnyPlayer && record.status !== 'idle') {
          const validT1 = slotT1.filter(Boolean);
          const validT2 = slotT2.filter(Boolean);
          const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
          const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;

          const s1 = Number(record.score1) || 0;
          const s2 = Number(record.score2) || 0;
          let calculatedStatus = record.status;
          if (s1 > 0 || s2 > 0) {
            calculatedStatus = 'in_progress';
          } else if (!calculatedStatus || calculatedStatus === 'idle') {
            calculatedStatus = (validT1.length + validT2.length === 4) ? 'ready' : 'idle';
          }

          const matchObj = {
            courtNumber: record.court_number || (targetCourtId === 'court_2' ? 'Sân 2' : 'Sân 1'),
            team1: slotT1,
            team2: slotT2,
            score1: s1,
            score2: s2,
            mode: record.matchmaker_mode || 'balanced',
            status: calculatedStatus,
            matchStatus: calculatedStatus,
            diffElo: Number(record.diff_elo) || Math.abs(elo1 - elo2)
          };
          state.courtMatches[targetCourtId].activeMatch = matchObj;
          state.courtMatches[targetCourtId].score1 = s1;
          state.courtMatches[targetCourtId].score2 = s2;
          state.courtMatches[targetCourtId].matchStatus = calculatedStatus;
          StorageService.saveLocalActiveMatch(matchObj, targetCourtId);
        } else if (hasAnyPlayer) {
          const validT1 = slotT1.filter(Boolean);
          const validT2 = slotT2.filter(Boolean);
          const elo1 = validT1.length > 0 ? Math.round(validT1.reduce((sum, p) => sum + p.elo, 0) / validT1.length) : 0;
          const elo2 = validT2.length > 0 ? Math.round(validT2.reduce((sum, p) => sum + p.elo, 0) / validT2.length) : 0;
          const totalValid = validT1.length + validT2.length;
          const calculatedStatus = totalValid === 4 ? 'ready' : 'idle';

          const matchObj = {
            courtNumber: record.court_number || (targetCourtId === 'court_2' ? 'Sân 2' : 'Sân 1'),
            team1: slotT1,
            team2: slotT2,
            score1: 0,
            score2: 0,
            mode: record.matchmaker_mode || 'balanced',
            status: calculatedStatus,
            matchStatus: calculatedStatus,
            diffElo: Number(record.diff_elo) || Math.abs(elo1 - elo2)
          };
          state.courtMatches[targetCourtId].activeMatch = matchObj;
          state.courtMatches[targetCourtId].score1 = 0;
          state.courtMatches[targetCourtId].score2 = 0;
          state.courtMatches[targetCourtId].matchStatus = calculatedStatus;
          StorageService.saveLocalActiveMatch(matchObj, targetCourtId);
        } else {
          const emptyCourt = {
            courtNumber: targetCourtId === 'court_2' ? 'Sân 2' : 'Sân 1',
            team1: [null, null],
            team2: [null, null],
            score1: 0,
            score2: 0,
            status: 'idle',
            matchStatus: 'idle',
            diffElo: 0,
            isSwappedSides: false
          };
          state.courtMatches[targetCourtId].activeMatch = emptyCourt;
          state.courtMatches[targetCourtId].score1 = 0;
          state.courtMatches[targetCourtId].score2 = 0;
          state.courtMatches[targetCourtId].matchStatus = 'idle';
          state.courtMatches[targetCourtId].isSwappedSides = false;
          state.courtMatches[targetCourtId].scoreHistory = [];
          StorageService.saveLocalActiveMatch(emptyCourt, targetCourtId);
        }

        updateCourtTabStatusPills();

        if (state.currentCourtId === targetCourtId) {
          renderCourt();
          updateScoreboardDisplay();
          renderEloPrediction();
          renderBettingWidget();
        }
        renderCourtBench();
      }
      return;
    }

    if (table === 'attendance') {
      const record = payload.new;
      if (record && Array.isArray(record.present_ids)) {
        // Cập nhật tức thì trực tiếp từ WebSocket payload, không phụ thuộc vào REST API
        const rawGames = record.games_played_today || {};
        const guests = Array.isArray(rawGames._guest_profiles) ? rawGames._guest_profiles : [];
        const cleanGames = { ...rawGames };
        delete cleanGames._guest_profiles;

        const updatedAtt = {
          date: record.date || getLocalDateStr(),
          presentIds: record.present_ids,
          gamesPlayedToday: cleanGames,
          guests: guests
        };

        StorageService.saveGuests(guests);
        StorageService.saveLocalAttendance(updatedAtt);
      } else {
        // Fallback đọc từ Supabase nếu payload không chứa record
        const todayStr = getLocalDateStr();
        const cloudAtt = await supabaseService.fetchAttendance(todayStr);
        if (cloudAtt) {
          StorageService.saveGuests(cloudAtt.guests || []);
          StorageService.saveLocalAttendance(cloudAtt);
        }
      }

      renderAttendance();
      renderCourt();
      renderCourtBench();
      updateSessionStatusBadge();

      const now = Date.now();
      if (!window._lastCloudToastTime || (now - window._lastCloudToastTime > 3000)) {
        window._lastCloudToastTime = now;
        showToast('✅ Danh sách điểm danh vừa được cập nhật!', 'info');
      }
      return;
    }

    if (table === 'matches') {
      const [cloudMatches, cloudMembers] = await Promise.all([
        supabaseService.fetchMatches(),
        supabaseService.fetchMembers()
      ]);
      if (cloudMatches) StorageService.saveLocalMatches(cloudMatches);
      if (cloudMembers && cloudMembers.length > 0) {
        const localMembers = StorageService.getMembers();
        const localMap = new Map(localMembers.map(m => [m.id, m]));
        const merged = cloudMembers.map(cm => {
          const lm = localMap.get(cm.id);
          return {
            ...cm,
            activeFrame: cm.activeFrame || lm?.activeFrame || '',
            activeEloShield: cm.activeEloShield || lm?.activeEloShield || false
          };
        });
        StorageService.saveLocalMembers(merged);
      }

      renderHistory();
      renderLeaderboard();
      renderMembers();
      renderAttendance();
      updateSessionStatusBadge();

      const now = Date.now();
      if (!window._lastCloudToastTime || (now - window._lastCloudToastTime > 4000)) {
        window._lastCloudToastTime = now;
        showToast('🏸 Kết quả trận mới vừa được ghi nhận!', 'info');
      }
      return;
    }

    if (table === 'members') {
      const cloudMembers = await supabaseService.fetchMembers();
      if (cloudMembers && cloudMembers.length > 0) {
        const localMembers = StorageService.getMembers();
        const localMap = new Map(localMembers.map(m => [m.id, m]));
        const merged = cloudMembers.map(cm => {
          const lm = localMap.get(cm.id);
          return {
            ...cm,
            activeFrame: cm.activeFrame || lm?.activeFrame || '',
            activeEloShield: cm.activeEloShield || lm?.activeEloShield || false
          };
        });
        StorageService.saveLocalMembers(merged);
      }

      renderLeaderboard();
      renderMembers();
      renderAttendance();
      renderUserAuthHeader();
      renderCourt();
      renderCourtBench();
      updateSessionStatusBadge();
      return;
    }

    if (table === 'sessions') {
      const cloudSessions = await supabaseService.fetchSessions();
      if (cloudSessions) StorageService.saveLocalSessions(cloudSessions);
      renderSessions();
      updateSessionStatusBadge();
      return;
    }

    if (table === 'bets') {
      const cloudBets = await supabaseService.fetchBets();
      if (cloudBets) {
        // Kiểm tra xem người dùng hiện tại có vé cược nào vừa chuyển trạng thái (won / lost / refunded)
        if (state.currentUser) {
          const oldBets = StorageService.getLocalBets();
          const oldPending = oldBets.find(b => b.memberId === state.currentUser.id && b.status === 'pending');
          if (oldPending) {
            const updated = cloudBets.find(b => b.id === oldPending.id);
            if (updated && updated.status !== 'pending') {
              if (updated.status === 'won') {
                SoundService.playLevelUp();
                confetti({
                  particleCount: 90,
                  spread: 75,
                  origin: { y: 0.5 }
                });
                showToast(`🎯 CHÚC MỪNG BẠN ĐOÁN ĐÚNG! Nhận thưởng +${updated.potentialPayout} Xu!`, 'success');
              } else if (updated.status === 'lost') {
                showToast('Tiếc quá, bạn đoán chưa đúng trận này! Chúc bạn may mắn ở trận sau.', 'info');
              } else if (updated.status === 'refunded') {
                showToast(`Vé cược của bạn đã được hoàn trả (+${updated.amount} Xu) do trận đấu làm lại/dọn sân.`, 'info');
              }
            }
          }
        }
        StorageService.saveLocalBets(cloudBets);
      }

      renderBettingWidget();
      const modalBets = document.getElementById('modal-court-bets');
      if (modalBets && modalBets.classList.contains('open')) {
        window.appOpenCourtBetsModal();
      }
      return;
    }

    if (table === 'coin_transactions') {
      const cloudTx = await supabaseService.fetchCoinTransactions();
      if (cloudTx) {
        StorageService.saveLocalCoinTransactions(cloudTx);
        if (state.currentUser) {
          const myLatestTx = cloudTx.find(t => t.memberId === state.currentUser.id);
          if (myLatestTx && myLatestTx.balanceAfter !== undefined) {
            const members = StorageService.getMembers();
            const mem = members.find(m => m.id === state.currentUser.id);
            if (mem) {
              mem.coins = myLatestTx.balanceAfter;
              StorageService.saveLocalMembers(members);
            }
            state.currentUser.coins = myLatestTx.balanceAfter;
          } else {
            state.currentUser = StorageService.getCurrentUser();
          }
          renderUserAuthHeader();
        }
      }
      return;
    }

    // Với các bảng còn lại (club_settings...)
    await StorageService.syncFromCloud();
    renderSessions();
    renderAttendance();
    updateSessionStatusBadge();
  });

  // 3. Tự động đồng bộ khi người dùng mở lại tab hoặc mở khóa màn hình điện thoại
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[App] Thiết bị hoạt động trở lại, đồng bộ Supabase Cloud...');
      if (supabaseService.ensureRealtimeSubscription) {
        supabaseService.ensureRealtimeSubscription();
      }
      StorageService.syncFromCloud().then(() => {
        updateCourtTabStatusPills();
        renderCourt();
        updateScoreboardDisplay();
        renderEloPrediction();
        renderCourtBench();
        renderUserAuthHeader();
        renderAttendance();
        renderLeaderboard();
        renderMembers();
        renderSessions();
        updateSessionStatusBadge();
      });
    }
  });
}

/**
 * =========================================================================
 * 7. RENDER LỊCH BUỔI ĐÁNH & THÔNG TIN SÂN (SESSIONS & COURTS)
 * =========================================================================
 */
function renderSessions() {
  const gridView = document.getElementById('calendar-grid-view');
  const listView = document.getElementById('sessions-list-container');
  const sessions = StorageService.getSessions();
  const members = StorageService.getMembers();
  const memberMap = new Map(members.map(m => [m.id, m]));

  if (state.calendarViewMode === 'grid') {
    if (gridView) gridView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    renderCalendarMonth(sessions, memberMap);
  } else {
    if (gridView) gridView.style.display = 'none';
    if (listView) listView.style.display = 'grid';
    renderSessionList(sessions, memberMap);
  }
}

/**
 * Render Lịch dạng ô lưới theo tháng (Interactive Calendar Grid)
 */
function renderCalendarMonth(sessions, memberMap) {
  const monthHeading = document.getElementById('cal-month-heading');
  const daysGrid = document.getElementById('calendar-days-grid');
  const detailsPanel = document.getElementById('calendar-selected-day-panel');

  if (monthHeading) {
    monthHeading.textContent = `Tháng ${state.calendarMonth + 1}, ${state.calendarYear}`;
  }

  if (!daysGrid) return;

  const year = state.calendarYear;
  const month = state.calendarMonth;

  // Ngày đầu tiên của tháng và thứ trong tuần (T2=1, ..., CN=7)
  const firstDay = new Date(year, month, 1);
  let firstDayWeek = firstDay.getDay(); // 0 is Sun
  if (firstDayWeek === 0) firstDayWeek = 7;
  const leadDaysCount = firstDayWeek - 1;

  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const totalDaysInPrevMonth = new Date(year, month, 0).getDate();

  const todayStr = getLocalDateStr();

  // Gom nhóm các buổi đánh theo ngày (YYYY-MM-DD)
  const sessionsByDate = new Map();
  sessions.forEach(s => {
    const list = sessionsByDate.get(s.date) || [];
    list.push(s);
    sessionsByDate.set(s.date, list);
  });

  const cells = [];

  // 1. Ngày của tháng trước (Padding đầu tháng)
  const prevMonthYear = month === 0 ? year - 1 : year;
  const prevMonthIndex = month === 0 ? 11 : month - 1;
  for (let i = leadDaysCount - 1; i >= 0; i--) {
    const dayNum = totalDaysInPrevMonth - i;
    const dateStr = `${prevMonthYear}-${String(prevMonthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    cells.push({ dayNum, dateStr, isOtherMonth: true });
  }

  // 2. Toàn bộ các ngày trong tháng hiện tại
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dayNum: d, dateStr, isOtherMonth: false });
  }

  // 3. Ngày của tháng sau (Padding cuối tháng cho tròn lưới 35 hoặc 42 ô)
  const totalNeeded = cells.length <= 35 ? 35 : 42;
  const trailCount = totalNeeded - cells.length;
  const nextMonthYear = month === 11 ? year + 1 : year;
  const nextMonthIndex = month === 11 ? 0 : month + 1;
  for (let d = 1; d <= trailCount; d++) {
    const dateStr = `${nextMonthYear}-${String(nextMonthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dayNum: d, dateStr, isOtherMonth: true });
  }

  // Render lưới ô
  daysGrid.innerHTML = cells.map(cell => {
    const daySessions = sessionsByDate.get(cell.dateStr) || [];
    const hasSession = daySessions.length > 0;
    const isToday = cell.dateStr === todayStr;
    const isSelected = cell.dateStr === state.calendarSelectedDate;

    let chipHtml = '';
    if (hasSession) {
      const first = daySessions[0];
      const timeStr = first.startTime ? first.startTime : 'Có lịch';
      chipHtml = `
        <div class="cal-session-pill" title="${first.title || 'Buổi đánh cầu'}">
          <span>🏸</span> ${timeStr}
        </div>
      `;
      if (daySessions.length > 1) {
        chipHtml += `<div style="font-size: 0.65rem; color: var(--volt); font-weight: 800;">+${daySessions.length - 1} buổi nữa</div>`;
      }
    }

    return `
      <div class="cal-day-cell ${cell.isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''} ${hasSession ? 'has-session' : ''} ${isSelected ? 'is-selected' : ''}"
           onclick="window.appSelectCalendarDate('${cell.dateStr}')">
        <div class="cal-cell-header">
          <span class="cal-day-number">${cell.dayNum}</span>
          ${hasSession ? '<span class="cal-cell-badge">🏸</span>' : ''}
          ${isToday && !hasSession ? '<span style="font-size: 0.65rem; color: var(--cyan); font-weight: 800;">Nay</span>' : ''}
        </div>
        <div class="cal-cell-body">
          ${chipHtml}
        </div>
      </div>
    `;
  }).join('');

  // Render khung chi tiết cho ngày đang được chọn bên dưới
  renderCalendarSelectedDayPanel(detailsPanel, sessionsByDate, memberMap);
}

/**
 * Render khung chi tiết bên dưới lịch lưới khi chọn 1 ngày
 */
function renderCalendarSelectedDayPanel(container, sessionsByDate, memberMap) {
  if (!container) return;

  const selDate = state.calendarSelectedDate;
  const daySessions = sessionsByDate.get(selDate) || [];

  const parts = selDate.split('-');
  let dateFormatted = selDate;
  if (parts.length === 3) {
    const dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const daysOfWeek = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    const dayName = daysOfWeek[dObj.getDay()];
    dateFormatted = `${dayName}, ngày ${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  const todayStr = getLocalDateStr();
  const isToday = selDate === todayStr;

  container.innerHTML = `
    <div class="cal-panel-header">
      <div class="cal-panel-title">
        <span>🏸</span> Chi Tiết: ${dateFormatted}
        ${isToday ? '<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 99px; background: rgba(6,182,212,0.2); color: var(--cyan); border: 1px solid var(--cyan); font-weight: 800;">Hôm Nay</span>' : ''}
      </div>
      <button class="btn-primary" style="padding: 7px 14px; font-size: 0.8rem;" onclick="window.appOpenAddSessionForDate('${selDate}')">
        ➕ Đặt Lịch Cho Ngày Này
      </button>
    </div>

    ${daySessions.length > 0 ? `
      <div class="sessions-list-grid" style="margin-top: 10px;">
        ${daySessions.map(s => renderSingleSessionCard(s, memberMap)).join('')}
      </div>
    ` : `
      <div class="cal-empty-day-box">
        <div style="font-size: 2rem; margin-bottom: 6px;">🏸</div>
        <div style="font-weight: 700; color: var(--text-main); margin-bottom: 4px;">Chưa có lịch đánh trong ngày ${parts[2]}/${parts[1]}</div>
        <p style="font-size: 0.82rem; color: var(--text-dim); margin-bottom: 14px;">Bấm nút bên dưới để tạo buổi đánh mới cho ngày này!</p>
        <button class="btn-primary" style="padding: 7px 16px; font-size: 0.82rem;" onclick="window.appOpenAddSessionForDate('${selDate}')">
          ➕ Đặt Lịch Ngày ${parts[2]}/${parts[1]}
        </button>
      </div>
    `}
  `;
}

/**
 * Render toàn bộ danh sách thẻ (List View)
 */
function renderSessionList(sessions, memberMap) {
  const container = document.getElementById('sessions-list-container');
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        Chưa có lịch buổi đánh nào. Bấm <strong>"+ Đặt Lịch Mới"</strong> để lên lịch!
      </div>
    `;
    return;
  }

  container.innerHTML = sessions.map(s => renderSingleSessionCard(s, memberMap)).join('');
}

/**
 * Render thẻ Buổi Đánh đơn lẻ (Dùng chung cho cả Grid Panel và List View)
 */
function renderSingleSessionCard(s, memberMap) {
  const dateObj = new Date(s.date);
  const dayNum = isNaN(dateObj.getDate()) ? '--' : String(dateObj.getDate()).padStart(2, '0');
  const monthText = isNaN(dateObj.getMonth()) ? 'THÁNG' : `THÁNG ${dateObj.getMonth() + 1}`;

  const rsvps = s.rsvps || {};
  const attendingIds = Object.keys(rsvps).filter(id => rsvps[id] === 'attending');
  const attendingMembers = attendingIds.map(id => memberMap.get(id)).filter(Boolean);
  const maleCount = attendingMembers.filter(m => m.gender === 'male').length;
  const femaleCount = attendingMembers.filter(m => m.gender === 'female').length;

  const hasMap = Boolean(s.venueAddress || s.venueName);
  const mapQuery = encodeURIComponent(`${s.venueName || ''} ${s.venueAddress || ''}`.trim());
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;
  const timeDisplay = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || s.endTime || '');

  return `
    <div class="session-card">
      <div class="session-header">
        <div class="session-date-badge">
          <div class="session-day-num">${dayNum}</div>
          <div class="session-month-text">${monthText}</div>
        </div>
        <div class="session-main-info">
          <div class="session-title">${s.title || 'Buổi Đánh Cầu'}</div>
          ${timeDisplay ? `
          <div class="session-time-row">
            <span>⏰</span> ${timeDisplay}
          </div>` : ''}
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="btn-mini-action" onclick="window.appEditSession('${s.id}')" title="Sửa thông tin">✎</button>
          <button class="btn-mini-action btn-mini-danger" onclick="window.appDeleteSession('${s.id}')" title="Xóa buổi đánh">✕</button>
        </div>
      </div>

      ${(s.venueName || s.venueAddress || s.courtNumbers || s.feeNote) ? `
      <div class="session-venue-box">
        ${(s.venueName || s.courtNumbers) ? `
        <div class="venue-name-row">
          <div class="venue-name">
            <span>📍</span> ${s.venueName || 'Sân cầu lông'}
          </div>
          ${s.courtNumbers ? `<span class="venue-courts-tag">${s.courtNumbers}</span>` : ''}
        </div>` : ''}
        ${s.venueAddress ? `
        <div class="venue-address-row">
          <span>${s.venueAddress}</span>
          ${hasMap ? `<a href="${mapUrl}" target="_blank" rel="noopener noreferrer" class="venue-map-link">[Bản đồ ↗]</a>` : ''}
        </div>` : ''}
        ${s.feeNote ? `<div style="font-size: 0.75rem; color: var(--volt); margin-top: 4px;">💰 ${s.feeNote}</div>` : ''}
      </div>` : ''}

      <div class="session-attendees-strip">
        <div class="attendees-counter-row">
          <span>Đăng ký tham gia: <strong style="color: var(--volt);">${attendingMembers.length} người</strong></span>
          <span style="font-size: 0.75rem; color: var(--text-dim);">(${maleCount} Nam, ${femaleCount} Nữ)</span>
        </div>
        <div class="attendees-avatars-pile">
          ${attendingMembers.slice(0, 14).map(m => `
            <img class="pile-avatar" src="${getAvatarUrl(m)}" title="${m.name} (${m.gender === 'male' ? 'Nam' : 'Nữ'})" alt="${m.name}" onclick="window.appViewPlayerProfile('${m.id}')" style="cursor: pointer;">
          `).join('')}
          ${attendingMembers.length > 14 ? `<span style="font-size: 0.75rem; color: var(--text-muted); padding: 4px;">+${attendingMembers.length - 14}</span>` : ''}
        </div>
      </div>

      <div class="session-footer-actions">
        <button class="btn-secondary" style="flex: 1; font-size: 0.8rem; padding: 8px 10px;" onclick="window.appQuickRSVP('${s.id}')">
          ✋ Đăng Ký Có Mặt
        </button>
        <button class="btn-primary" style="flex: 1.3; font-size: 0.82rem; padding: 8px 12px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff;" onclick="window.appStartSession('${s.id}')">
          🏸 Bắt Đầu Buổi Đánh
        </button>
      </div>
    </div>
  `;
}

function openSessionModal(sessionId = null, defaultDate = null) {
  state.editingSessionId = sessionId;
  const modal = document.getElementById('modal-session-form');
  const title = document.getElementById('session-modal-title');
  const fieldTitle = document.getElementById('field-session-title');
  const fieldDate = document.getElementById('field-session-date');
  const fieldStart = document.getElementById('field-session-start');
  const fieldEnd = document.getElementById('field-session-end');
  const fieldVenue = document.getElementById('field-session-venue');
  const fieldAddress = document.getElementById('field-session-address');
  const fieldCourts = document.getElementById('field-session-courts');
  const fieldFee = document.getElementById('field-session-fee');

  if (sessionId) {
    const session = StorageService.getSessions().find(s => s.id === sessionId);
    if (session) {
      if (title) title.textContent = 'Sửa Lịch Buổi Đánh';
      if (fieldTitle) fieldTitle.value = session.title || '';
      if (fieldDate) fieldDate.value = session.date || '';
      if (fieldStart) fieldStart.value = session.startTime || '';
      if (fieldEnd) fieldEnd.value = session.endTime || '';
      if (fieldVenue) fieldVenue.value = session.venueName || '';
      if (fieldAddress) fieldAddress.value = session.venueAddress || '';
      if (fieldCourts) fieldCourts.value = session.courtNumbers || '';
      if (fieldFee) fieldFee.value = session.feeNote || '';
    }
  } else {
    if (title) title.textContent = 'Đặt Lịch Buổi Đánh Mới';
    if (fieldTitle) fieldTitle.value = '';
    if (fieldDate) fieldDate.value = defaultDate || state.calendarSelectedDate || getLocalDateStr();
    if (fieldStart) fieldStart.value = '';
    if (fieldEnd) fieldEnd.value = '';
    if (fieldVenue) fieldVenue.value = '';
    if (fieldAddress) fieldAddress.value = '';
    if (fieldCourts) fieldCourts.value = '';
    if (fieldFee) fieldFee.value = '';
  }

  if (modal) modal.classList.add('open');
}

// Global hook để Sửa Buổi Đánh
window.appEditSession = function(sessionId) {
  openSessionModal(sessionId);
};

// Global hook để Chọn Ngày trên Lịch Lưới
window.appSelectCalendarDate = function(dateStr) {
  state.calendarSelectedDate = dateStr;
  renderSessions();
};

// Global hook để Đặt Lịch cho Ngày cụ thể
window.appOpenAddSessionForDate = function(dateStr) {
  openSessionModal(null, dateStr);
};

function handleSessionFormSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('field-session-title').value.trim();
  const date = document.getElementById('field-session-date').value;
  const startTime = document.getElementById('field-session-start').value;
  const endTime = document.getElementById('field-session-end').value;
  const venueName = document.getElementById('field-session-venue').value.trim();
  const venueAddress = document.getElementById('field-session-address').value.trim();
  const courtNumbers = document.getElementById('field-session-courts').value.trim();
  const feeNote = document.getElementById('field-session-fee').value.trim();

  if (!date) {
    showToast('Vui lòng chọn ngày đánh', 'error');
    return;
  }

  const sessionTitle = title || `Buổi Đánh Ngày ${date}`;

  if (state.editingSessionId) {
    StorageService.updateSession(state.editingSessionId, {
      title: sessionTitle, date, startTime, endTime, venueName, venueAddress, courtNumbers, feeNote
    });
    showToast('Đã cập nhật lịch buổi đánh!');
  } else {
    StorageService.addSession({
      title: sessionTitle, date, startTime, endTime, venueName, venueAddress, courtNumbers, feeNote
    });
    showToast('Đã tạo lịch buổi đánh mới!');
  }

  closeAllModals();
  renderSessions();
}

window.appQuickRSVP = function(sessionId) {
  const session = StorageService.getSessions().find(s => s.id === sessionId);
  if (!session) return;

  const modal = document.getElementById('modal-quick-rsvp');
  if (!modal) return;

  const title = document.getElementById('quick-rsvp-modal-title');
  const desc = document.getElementById('quick-rsvp-modal-desc');
  if (title) title.textContent = `🏸 Đăng Ký: ${session.title || 'Buổi Đánh'}`;
  if (desc) desc.textContent = `Ngày: ${session.date} • Giờ: ${session.startTime || '19:00'} - ${session.endTime || '21:00'} • Sân: ${session.venueName || 'Sân CLB'}`;

  const selfBox = document.getElementById('quick-rsvp-self-box');
  const btnSelf = document.getElementById('btn-quick-rsvp-self');
  const list = document.getElementById('quick-rsvp-members-list');

  const rsvps = session.rsvps || {};
  const members = StorageService.getMembers();

  // Nút 1-chạm nếu người dùng hiện tại đã đăng nhập
  if (state.currentUser && selfBox && btnSelf) {
    selfBox.style.display = 'block';
    const isAttending = rsvps[state.currentUser.id] === 'attending';
    btnSelf.innerHTML = isAttending
      ? `<span>✅</span> <span>Bạn (${state.currentUser.name}) Đã Đăng Ký (Bấm để huỷ)</span>`
      : `<span>✋</span> <span>Tôi (${state.currentUser.name}) Tham Gia Buổi Này!</span>`;
    btnSelf.className = isAttending ? 'btn btn-secondary' : 'btn btn-primary';
    btnSelf.style.width = '100%';
    btnSelf.onclick = () => {
      const newStatus = isAttending ? 'declined' : 'attending';
      StorageService.rsvpSession(sessionId, state.currentUser.id, newStatus);
      SoundService.playClick();
      modal.classList.remove('open');
      showToast(newStatus === 'attending' ? `✅ Bạn đã đăng ký tham gia!` : `Đã huỷ đăng ký buổi đánh`);
      renderSessions();
    };
  } else if (selfBox) {
    selfBox.style.display = 'none';
  }

  // Danh sách thành viên chọn nhanh
  if (list) {
    list.innerHTML = members.map(m => {
      const isAtt = rsvps[m.id] === 'attending';
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; cursor: pointer; transition: all 0.15s ease;"
             onclick="window.appToggleMemberRSVP('${sessionId}', '${m.id}', ${isAtt ? "'declined'" : "'attending'"})">
          <div style="display: flex; align-items: center; gap: 10px;">
            ${renderAvatarHtml(m, { size: 'sm' })}
            <div>
              <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary);">${m.name}</div>
              <div style="font-size: 0.74rem; color: var(--text-dim);">${m.elo} Elo • ${m.frequency === 'regular' ? '⚡ Nòng cốt' : '🍃 Giao lưu'}</div>
            </div>
          </div>
          <button type="button" class="${isAtt ? 'btn btn-secondary' : 'btn btn-primary'}" style="font-size: 0.78rem; padding: 6px 12px; pointer-events: none; font-weight: 700;">
            ${isAtt ? '✓ Có mặt' : '+ Đăng ký'}
          </button>
        </div>
      `;
    }).join('');
  }

  modal.classList.add('open');
};

window.appToggleMemberRSVP = function(sessionId, memberId, status) {
  const modal = document.getElementById('modal-quick-rsvp');
  StorageService.rsvpSession(sessionId, memberId, status);
  SoundService.playClick();
  if (modal) modal.classList.remove('open');
  const mem = StorageService.getMemberById(memberId);
  showToast(status === 'attending' ? `✅ ${mem ? mem.name : 'Thành viên'} đã đăng ký tham gia!` : `Đã huỷ đăng ký`);
  renderSessions();
};

window.appStartSession = function(sessionId) {
  const sessions = StorageService.getSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const rsvps = session.rsvps || {};
  const attendingIds = Object.keys(rsvps).filter(id => rsvps[id] === 'attending');

  if (attendingIds.length === 0) {
    showToast('Chưa có ai đăng ký tham gia buổi này!', 'error');
    return;
  }

  StorageService.setAttendanceList(attendingIds);
  SoundService.playWhistle();
  showToast(`🏸 Đã bắt đầu buổi đánh! ${attendingIds.length} thành viên đã sẵn sàng trên sân.`);
  switchTab('court');
  updateSessionStatusBadge();
};

window.appDeleteSession = async function(sessionId) {
  const ok = await showConfirmModal({
    title: 'Xóa Buổi Đánh?',
    message: 'Bạn có chắc chắn muốn xóa lịch buổi đánh này không?',
    confirmText: 'Xóa Lịch',
    icon: '🗑️',
    isDanger: true
  });
  if (ok) {
    StorageService.deleteSession(sessionId);
    showToast('Đã xóa buổi đánh');
    renderSessions();
  }
};

/**
 * =========================================================================
 * 8. HỒ SƠ VẬN ĐỘNG VIÊN CHUYÊN NGHIỆP (PLAYER PROFILE PRO)
 * =========================================================================
 */
window.appViewPlayerProfile = function(memberId) {
  const members = StorageService.getMembers();
  const matches = StorageService.getMatches();
  const stats = getPlayerDetailedStats(memberId, members, matches);
  if (!stats) return;

  const modal = document.getElementById('modal-player-profile');
  const body = document.getElementById('player-profile-modal-body');
  if (!modal || !body) return;

  const m = stats.member;
  const tier = stats.tier;
  const nextTier = stats.nextTier;
  const avatarUrl = getAvatarUrl(m);
  const isMale = m.gender === 'male';

  body.innerHTML = `
    <div class="profile-pro-wrap">
      <div class="profile-hero-card">
        <div class="profile-avatar-large-wrap">
          ${renderAvatarHtml(m, { size: 'xl' })}
          <span class="gender-badge-dot ${isMale ? 'gender-male' : 'gender-female'}">
            ${isMale ? '♂' : '♀'}
          </span>
        </div>
        <div class="profile-hero-details">
          <div class="profile-hero-name">${m.name}</div>
          <div class="profile-hero-nick">${m.nickname || 'Chiến binh CLB Thái Thịnh'}</div>
          <div class="profile-hero-badges">
            <span class="tier-pill tier-${tier.id}" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
              ${tier.icon} ${tier.name}
            </span>
            <span class="profile-freq-pill">
              ${m.frequency === 'regular' ? '⚡ Nòng cốt' : '🍃 Thỉnh thoảng'}
            </span>
          </div>
        </div>
      </div>

      <!-- Elo & Next Tier Progress -->
      <div class="profile-rank-progress-box">
        <div class="progress-header">
          <span class="progress-rank-text">Hạng <strong>#${stats.rank}</strong> • <span class="progress-elo-val">${m.elo} Elo</span></span>
          <span class="progress-next-tier">
            ${nextTier.tier ? `Cần +${nextTier.pointsNeeded} Elo lên ${nextTier.tier.name}` : '👑 Bậc Tối Thượng'}
          </span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${nextTier.progressPercent}%;"></div>
        </div>
      </div>

      <!-- 4 Stats Dials -->
      <div class="profile-stats-grid">
        <div class="profile-stat-box">
          <div class="profile-stat-icon">📈</div>
          <div class="profile-stat-num stat-elo">${m.elo}</div>
          <div class="profile-stat-label">Điểm Elo</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-icon">🏸</div>
          <div class="profile-stat-num">${m.matchesPlayed}</div>
          <div class="profile-stat-label">Tổng Trận</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-icon">🎯</div>
          <div class="profile-stat-num stat-winrate">${stats.winRate}%</div>
          <div class="profile-stat-label">Tỷ Lệ Thắng</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-icon">🔥</div>
          <div class="profile-stat-num ${m.streak >= 0 ? 'streak-pos' : 'streak-neg'}">
            ${m.streak > 0 ? `+${m.streak}` : m.streak}
          </div>
          <div class="profile-stat-label">Chuỗi Trận</div>
        </div>
      </div>

      <!-- Best Partner Box (Sử dụng hệ thống avatar chuẩn, tránh ảnh vỡ) -->
      ${stats.bestPartner ? `
        <div class="best-partner-box">
          <div class="bp-left">
            <div style="flex-shrink: 0;">
              ${renderAvatarHtml(stats.bestPartner.player, { size: 'md' })}
            </div>
            <div class="bp-info">
              <div class="bp-tag">💘 BẠN DIỄN ĂN Ý NHẤT</div>
              <div class="bp-name">${stats.bestPartner.player.name}</div>
            </div>
          </div>
          <div class="bp-stats">
            <div style="color: #f59e0b; font-size: 1.15rem; font-weight: 900; font-family: var(--font-heading);">${stats.bestPartner.rate}%</div>
            <div style="font-size: 0.72rem; color: var(--text-dim); font-weight: 600;">${stats.bestPartner.won}/${stats.bestPartner.played} Trận Thắng</div>
          </div>
        </div>
      ` : ''}

      <!-- Recent Personal Matches -->
      <div>
        <div style="font-size: 0.82rem; font-weight: 800; text-transform: uppercase; color: var(--text-dim); margin-bottom: 8px;">
          LỊCH SỬ THI ĐẤU GẦN NHẤT
        </div>
        ${stats.personalMatches.length > 0 ? `
          <div class="personal-history-list">
            ${stats.personalMatches.map(pm => `
              <div class="personal-match-item ${pm.isWin ? 'win' : 'loss'}">
                <div class="pm-left">
                  <span class="pm-status-pill ${pm.isWin ? 'pm-win-pill' : 'pm-loss-pill'}">
                    ${pm.isWin ? 'THẮNG' : 'THUA'}
                  </span>
                  <div>
                    <div style="font-weight: 700;">
                      Đánh cùng: <strong>${pm.partner ? pm.partner.name : 'Đồng đội'}</strong>
                    </div>
                    <div style="font-size: 0.72rem; color: var(--text-dim);">
                      vs ${pm.opponents.map(o => o.name).join(' & ')} • ${pm.courtNumber}
                    </div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 900; font-size: 1rem;">${pm.myScore} - ${pm.oppScore}</div>
                  <div class="pm-delta-tag" style="color: ${pm.eloDelta > 0 ? '#4ade80' : '#f87171'}; font-size: 0.75rem;">
                    ${pm.eloDelta > 0 ? '+' : ''}${pm.eloDelta} Elo
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 0.85rem;">
            Chưa có trận đấu nào được ghi lại cho thành viên này.
          </div>
        `}
      </div>
    </div>
  `;

  modal.classList.add('open');
  SoundService.playClick();
};

// =========================================================================
// 8. ĐỊNH DANH NGƯỜI DÙNG, MÃ PIN & VÍ XU (GIAI ĐOẠN 1)
// =========================================================================

function renderUserAuthHeader() {
  const container = document.getElementById('header-user-container');
  if (!container) return;

  const currentUser = StorageService.getCurrentUser();
  state.currentUser = currentUser;

  if (currentUser) {
    const coins = currentUser.coins !== undefined ? currentUser.coins : 100;
    container.innerHTML = `
      <div id="header-user-widget" class="header-user-pill" onclick="window.appOpenUserWallet()" title="Xem ví xu & hồ sơ cá nhân">
        ${renderAvatarHtml(currentUser, { size: 'xs', className: 'header-user-avatar' })}
        <span class="header-user-name">${currentUser.name}</span>
        <span class="header-coin-badge">🪙 <span id="header-user-coins">${coins}</span></span>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn-header-login" onclick="window.appOpenLoginModal()" title="Đăng nhập để nhận xu & quản lý hồ sơ">
        <span>🔑</span> <span class="login-text-full">Đăng Nhập</span><span class="login-text-short">ĐN</span>
      </button>
    `;
  }
}

window.appOpenLoginModal = function() {
  const modal = document.getElementById('modal-auth-pin');
  const select = document.getElementById('select-auth-member');
  const inputPin = document.getElementById('input-auth-pin');
  if (!modal || !select) return;

  const members = StorageService.getMembers();
  if (members.length === 0) {
    showToast('Chưa có thành viên nào trong CLB! Hãy tạo thành viên mới trước.', 'error');
    window.appOpenAddMember();
    return;
  }

  select.innerHTML = members.map(m => `
    <option value="${m.id}" ${state.currentUser?.id === m.id ? 'selected' : ''}>
      ${m.name} ${m.nickname ? `(${m.nickname})` : ''} • Elo ${m.elo} ${m.pinCode ? '🔒' : '🆕 (Chưa đặt PIN)'}
    </option>
  `).join('');

  const updatePinHint = () => {
    const memId = select.value;
    const mem = StorageService.getMemberById(memId);
    const hint = document.getElementById('auth-pin-hint');
    const tag = document.getElementById('auth-pin-status-tag');
    if (mem && !mem.pinCode) {
      if (hint) hint.innerHTML = '✨ <strong>Tài khoản mới:</strong> Hãy nhập 4 số bất kỳ để đặt mã PIN đăng nhập lần đầu.';
      if (tag) { tag.textContent = 'Chưa đặt PIN'; tag.style.color = 'var(--volt)'; }
    } else {
      if (hint) hint.textContent = 'Nhập mã PIN 4 số của bạn để mở khóa tài khoản.';
      if (tag) { tag.textContent = 'Đã bảo mật PIN'; tag.style.color = 'var(--cyan)'; }
    }
  };

  select.onchange = updatePinHint;
  updatePinHint();

  if (inputPin) {
    inputPin.value = '';
    setTimeout(() => inputPin.focus(), 200);
  }

  modal.classList.add('open');
};

window.appSubmitAuthPin = function() {
  const select = document.getElementById('select-auth-member');
  const inputPin = document.getElementById('input-auth-pin');
  if (!select || !inputPin) return;

  const memberId = select.value;
  const pin = inputPin.value.trim();

  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    showToast('Vui lòng nhập đúng 4 chữ số mã PIN!', 'error');
    inputPin.focus();
    return;
  }

  const result = StorageService.verifyPin(memberId, pin);
  if (!result.success) {
    showToast(result.message || 'Mã PIN không đúng!', 'error');
    inputPin.value = '';
    inputPin.focus();
    return;
  }

  StorageService.setCurrentUser(memberId);
  state.currentUser = StorageService.getCurrentUser();
  closeAllModals();

  if (result.isNewPin) {
    showToast(`🎉 Đã thiết lập mã PIN và đăng nhập: ${state.currentUser.name}!`);
  } else {
    showToast(`👋 Chào mừng trở lại, ${state.currentUser.name}!`);
  }

  renderUserAuthHeader();
  renderMembers();
};

window.appOpenUserWallet = function() {
  const user = StorageService.getCurrentUser();
  if (!user) {
    window.appOpenLoginModal();
    return;
  }

  const modal = document.getElementById('modal-user-wallet');
  const avatarContainer = document.getElementById('wallet-user-avatar-container');
  const avatarImg = document.getElementById('wallet-user-avatar');
  const name = document.getElementById('wallet-user-name');
  const tier = document.getElementById('wallet-user-tier');
  const coins = document.getElementById('wallet-coins-amount');
  const txList = document.getElementById('wallet-tx-list');

  if (avatarContainer) {
    avatarContainer.innerHTML = renderAvatarHtml(user, { size: 'lg' });
  } else if (avatarImg) {
    avatarImg.src = getAvatarUrl(user);
  }
  if (name) name.textContent = user.name;
  if (tier) {
    const t = getTierByElo(user.elo);
    tier.innerHTML = `${t.icon} ${t.name} (Elo ${user.elo})`;
  }
  if (coins) coins.textContent = user.coins !== undefined ? user.coins : 100;

  if (txList) {
    const txs = StorageService.getCoinTransactions(user.id);
    if (txs.length === 0) {
      txList.innerHTML = `
        <div style="text-align: center; padding: 24px 16px; color: var(--text-muted); font-size: 0.85rem;">
          Chưa có giao dịch xu nào được ghi nhận.
        </div>
      `;
    } else {
      txList.innerHTML = txs.map(tx => {
        const isPos = tx.amount > 0;
        const dateStr = new Date(tx.createdAt || Date.now()).toLocaleDateString('vi-VN', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        return `
          <div class="wallet-tx-item">
            <div style="min-width: 0; flex: 1; padding-right: 8px;">
              <div class="wallet-tx-desc">${tx.description || 'Giao dịch xu'}</div>
              <div class="wallet-tx-date">${dateStr} • Số dư sau: ${tx.balanceAfter} Xu</div>
            </div>
            <div class="${isPos ? 'tx-amount-pos' : 'tx-amount-neg'}">
              ${isPos ? '+' : ''}${tx.amount} 🪙
            </div>
          </div>
        `;
      }).join('');
    }
  }

  if (modal) modal.classList.add('open');
};

window.appLogout = function() {
  StorageService.clearCurrentUser();
  state.currentUser = null;
  closeAllModals();
  showToast('Đã đăng xuất tài khoản');
  renderUserAuthHeader();
  renderMembers();
};

window.appEditMyProfile = function() {
  const user = StorageService.getCurrentUser();
  if (!user) {
    window.appOpenLoginModal();
    return;
  }
  closeAllModals();
  openMemberModal(user.id);
};

window.appOpenRegisterNewMember = function() {
  closeAllModals();
  openMemberModal(null);
};

// =========================================================================
// 10. CỬA HÀNG VẬT PHẨM & TÚI ĐỒ CỦA TÔI (GIAI ĐOẠN 3)
// =========================================================================

function renderClubShop() {
  const user = StorageService.getCurrentUser();
  const coinsSpan = document.getElementById('shop-user-coins');
  const itemsContainer = document.getElementById('shop-items-container');
  const invCountBadge = document.getElementById('inventory-count-badge');
  const shieldBox = document.getElementById('inventory-elo-shield-box');
  const invItemsContainer = document.getElementById('inventory-items-container');

  const userCoins = user && user.coins !== undefined ? user.coins : 100;
  if (coinsSpan) coinsSpan.textContent = userCoins;

  const userInv = user ? StorageService.getUserInventory(user.id) : [];
  if (invCountBadge) {
    const totalItems = userInv.reduce((sum, item) => sum + (item.quantity || 1), 0);
    invCountBadge.textContent = totalItems;
  }

  // 1. RENDER SHOP ITEMS (Flat Grid, Không chia kệ)
  if (itemsContainer) {
    itemsContainer.innerHTML = SHOP_ITEMS.map(item => {
      const isLegendary = item.rarity === 'legendary';
      let badgeClass = 'badge-real';
      if (item.category === 'perk') badgeClass = 'badge-perk';
      else if (isLegendary) badgeClass = 'badge-legendary';
      else if (item.rarity === 'rare') badgeClass = 'badge-rare';

      const isOwnedFrame = item.type === 'frame' && userInv.some(i => i.itemId === item.id);
      const consumableInv = item.type !== 'frame' ? userInv.find(i => i.itemId === item.id) : null;
      const consumableCount = consumableInv?.quantity || 0;

      let previewMarkup = '';
      if (item.type === 'frame') {
        const dummyMember = {
          ...(user || {}),
          name: user ? user.name : 'VĐV',
          gender: item.category === 'female' ? 'female' : 'male',
          activeFrame: item.id
        };
        previewMarkup = `
          <div style="padding: 10px 4px 6px 4px; display: flex; justify-content: center; align-items: center;">
            ${renderAvatarHtml(dummyMember, { size: 'md' })}
          </div>
        `;
      } else {
        previewMarkup = `
          <div style="font-size: 2.2rem; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.06); border-radius: var(--radius-md);">
            ${item.icon}
          </div>
        `;
      }

      let btnHtml = '';
      if (isOwnedFrame) {
        btnHtml = `<button class="shop-btn-owned" disabled title="Bạn đã sở hữu khung này">✓ Đã Có</button>`;
      } else {
        const canAfford = userCoins >= item.price;
        btnHtml = `
          <button class="shop-btn-buy" onclick="window.appBuyShopItem('${item.id}')" ${!canAfford ? 'style="opacity: 0.55; cursor: not-allowed;"' : ''} title="${canAfford ? 'Bấm để mua ngay' : 'Bạn chưa đủ xu'}">
            Mua ${item.price} 🪙
          </button>
        `;
      }

      return `
        <div class="shop-item-card ${isLegendary ? 'is-legendary' : ''}">
          <div>
            <div class="shop-item-top">
              <div class="shop-item-avatar-preview">${previewMarkup}</div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 3px;">
                  <span class="shop-item-badge ${badgeClass}">${item.tierBadge || item.badge}</span>
                  ${item.hasAnimation ? '<span class="shop-anim-tag">⚡ XOAY 360°</span>' : ''}
                </div>
                <div class="shop-item-title">${item.name}</div>
                ${consumableCount > 0 ? `<div style="font-size: 0.74rem; color: #10b981; font-weight: 700; margin-top: 2px;">(Đang có: ${consumableCount})</div>` : ''}
              </div>
            </div>
            <div class="shop-item-desc">${item.description}</div>
          </div>
          <div class="shop-item-bottom">
            <div class="shop-item-price" style="${isLegendary ? 'color: #fde047; font-size: 1.05rem; text-shadow: 0 0 10px rgba(250,204,21,0.5);' : ''}">
              🪙 ${item.price} Xu
            </div>
            ${btnHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. RENDER INVENTORY TAB (Túi Đồ Của Tôi)
  if (shieldBox) {
    const shieldItem = userInv.find(i => i.itemId === 'elo_shield' && i.quantity > 0);
    const shieldCount = shieldItem?.quantity || 0;
    const isShieldActive = !!(user && user.activeEloShield);

    shieldBox.innerHTML = `
      <div class="perk-banner-header">
        <div class="perk-banner-title">
          <span>🛡️</span> Thẻ Khiên Bảo Vệ Elo (Đang có: <strong>${shieldCount}</strong> thẻ)
        </div>
        <button class="perk-shield-toggle-btn ${isShieldActive ? 'shield-active' : 'shield-inactive'}" onclick="window.appToggleEloShield()">
          ${isShieldActive ? '🛡️ KHIÊN ĐANG BẬT' : '⚪ KHIÊN ĐANG TẮT'}
        </button>
      </div>
      <div class="perk-banner-desc">
        ${isShieldActive 
          ? `<strong style="color: #10b981;">Khiên đang BẬT:</strong> Nếu thua trận tiếp theo, bạn chỉ bị trừ 50% số điểm Elo! Nếu thắng, bạn nhận đủ 100% Elo và không bị trừ thẻ.`
          : `Khiên đang TẮT. Bật khiên trước khi đánh trận để kích hoạt quyền lợi giảm 50% trừ điểm Elo khi thua.`}
      </div>
    `;
  }

  if (invItemsContainer) {
    const gripItem = userInv.find(i => i.itemId === 'grip' && i.quantity > 0);
    const ownedFrames = userInv.filter(i => i.itemType === 'frame');
    const activeFrame = user?.activeFrame || '';

    let cardsHtml = '';

    // Khung Mặc Định (Không Khung)
    const isDefaultActive = !activeFrame;
    cardsHtml += `
      <div class="inventory-card ${isDefaultActive ? 'is-active-frame' : ''}">
        <div class="inventory-card-top">
          <div class="avatar-container avatar-md">
            <img src="${user ? getAvatarUrl(user) : generateDefaultAvatar('Tôi')}" class="avatar-img" alt="Mặc định">
          </div>
          <div class="inventory-card-info">
            <div class="inventory-card-name">Avatar Mặc Định</div>
            <div class="inventory-card-status">${isDefaultActive ? '🟢 Đang sử dụng' : 'Khung cơ bản của CLB'}</div>
          </div>
        </div>
        <div class="inventory-card-bottom">
          <span style="font-size: 0.74rem; color: var(--text-dim);">Cơ bản</span>
          ${isDefaultActive 
            ? `<span style="font-size: 0.78rem; font-weight: 700; color: #10b981;">✓ Đang Dùng</span>`
            : `<button class="btn-inventory-action btn-inventory-unequip" onclick="window.appEquipFrame('')">Dùng Mặc Định</button>`}
        </div>
      </div>
    `;

    // Cuốn cán nếu có
    if (gripItem && gripItem.quantity > 0) {
      cardsHtml += `
        <div class="inventory-card">
          <div class="inventory-card-top">
            <div style="font-size: 2.2rem; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: rgba(56, 189, 248, 0.1); border-radius: var(--radius-md);">
              🏸
            </div>
            <div class="inventory-card-info">
              <div class="inventory-card-name">Cuốn Cán Vợt Chống Trơn</div>
              <div class="inventory-card-status">Còn lại: <strong style="color: #38bdf8;">${gripItem.quantity}</strong> chiếc</div>
            </div>
          </div>
          <div class="inventory-card-bottom">
            <span style="font-size: 0.74rem; color: var(--text-dim);">Nhận tại sân</span>
            <button class="btn-inventory-action btn-inventory-claim" onclick="window.appClaimGrip()" title="Bấm khi bạn đã nhận 1 cuốn cán thật từ thủ quỹ/trọng tài tại sân">
              Đã Nhận 1 Cuốn
            </button>
          </div>
        </div>
      `;
    }

    // Các khung đã sở hữu
    ownedFrames.forEach(invItem => {
      const shopDef = SHOP_ITEMS.find(s => s.id === invItem.itemId);
      if (!shopDef) return;
      const isActive = activeFrame === shopDef.id;

      const dummyMember = {
        ...(user || {}),
        name: user ? user.name : 'Tôi',
        activeFrame: shopDef.id
      };

      cardsHtml += `
        <div class="inventory-card ${isActive ? 'is-active-frame' : ''}">
          <div class="inventory-card-top">
            <div style="padding: 8px 4px 4px 4px; display: flex; align-items: center; justify-content: center;">
              ${renderAvatarHtml(dummyMember, { size: 'md' })}
            </div>
            <div class="inventory-card-info">
              <div class="inventory-card-name">${shopDef.name}</div>
              <div class="inventory-card-status">${isActive ? '🟢 Đang sử dụng' : 'Trong túi đồ'}</div>
              ${shopDef.hasAnimation ? '<div style="font-size: 0.7rem; color: #facc15; font-weight: 700;">⚡ Hiệu ứng xoay 360°</div>' : ''}
            </div>
          </div>
          <div class="inventory-card-bottom">
            <span style="font-size: 0.74rem; color: var(--text-dim);">${shopDef.tierBadge || shopDef.badge}</span>
            ${isActive 
              ? `<button class="btn-inventory-action btn-inventory-unequip" onclick="window.appEquipFrame('')">Tháo Khung</button>`
              : `<button class="btn-inventory-action btn-inventory-equip" onclick="window.appEquipFrame('${shopDef.id}')">Đeo Khung</button>`}
          </div>
        </div>
      `;
    });

    invItemsContainer.innerHTML = cardsHtml;
  }

  // 3. RENDER COIN HISTORY
  renderCoinHistory();
}

let currentCoinHistoryFilter = 'all';

function renderCoinHistory(filter = null) {
  if (filter) currentCoinHistoryFilter = filter;
  const user = StorageService.getCurrentUser();
  if (!user) return;

  const totalInSpan = document.getElementById('coin-history-total-in');
  const totalOutSpan = document.getElementById('coin-history-total-out');
  const balanceSpan = document.getElementById('coin-history-balance');
  const container = document.getElementById('shop-history-container');

  const allTxs = StorageService.getCoinTransactions(user.id);

  let totalIn = 0;
  let totalOut = 0;
  allTxs.forEach(tx => {
    if (tx.amount > 0) totalIn += Number(tx.amount);
    else totalOut += Math.abs(Number(tx.amount));
  });

  if (totalInSpan) totalInSpan.textContent = `+${totalIn.toLocaleString('vi-VN')} 🪙`;
  if (totalOutSpan) totalOutSpan.textContent = `-${totalOut.toLocaleString('vi-VN')} 🪙`;
  if (balanceSpan) balanceSpan.textContent = `${(user.coins !== undefined ? user.coins : 100).toLocaleString('vi-VN')} 🪙`;

  let displayTxs = allTxs;
  if (currentCoinHistoryFilter === 'in') {
    displayTxs = allTxs.filter(tx => tx.amount > 0);
  } else if (currentCoinHistoryFilter === 'out') {
    displayTxs = allTxs.filter(tx => tx.amount < 0);
  }

  document.querySelectorAll('.coin-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === currentCoinHistoryFilter);
  });

  if (!container) return;

  if (displayTxs.length === 0) {
    container.innerHTML = `
      <div class="empty-history-box">
        <div style="font-size: 2.2rem; margin-bottom: 6px;">📜</div>
        <div style="font-weight: 700; color: var(--text-secondary);">Chưa có giao dịch nào</div>
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 2px;">
          ${currentCoinHistoryFilter === 'all' 
            ? 'Hãy tích cực điểm danh và thi đấu để tích lũy xu!' 
            : currentCoinHistoryFilter === 'in' 
              ? 'Chưa có giao dịch thu vào nào.' 
              : 'Chưa có giao dịch chi tiêu nào.'}
        </div>
      </div>
    `;
    return;
  }

  const typeIcons = {
    session_checkin: { icon: '🏸', label: 'Điểm danh', color: '#10b981' },
    match_win: { icon: '🏆', label: 'Thắng trận', color: '#f59e0b' },
    match_loss: { icon: '⚡', label: 'Hoàn thành', color: '#3b82f6' },
    bet_won: { icon: '🎲', label: 'Thắng cược', color: '#ec4899' },
    bet_placed: { icon: '🎯', label: 'Đặt cược', color: '#6366f1' },
    bet_refund: { icon: '🔁', label: 'Hoàn tiền', color: '#06b6d4' },
    match_undo: { icon: '↩️', label: 'Hoàn tác trận', color: '#f97316' },
    session_checkin_undo: { icon: '↩️', label: 'Thu hồi điểm danh', color: '#ef4444' },
    shop_purchase: { icon: '🛒', label: 'Cửa hàng', color: '#f43f5e' },
    system: { icon: '🪙', label: 'Hệ thống', color: '#8b5cf6' }
  };

  container.innerHTML = displayTxs.map(tx => {
    const isPos = tx.amount > 0;
    const typeMeta = typeIcons[tx.type] || { icon: '🪙', label: 'Giao dịch', color: '#8b5cf6' };
    const dateObj = new Date(tx.createdAt || Date.now());
    const timeStr = dateObj.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = dateObj.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return `
      <div class="coin-history-card ${isPos ? 'is-inflow' : 'is-outflow'}">
        <div class="coin-history-icon" style="background: ${typeMeta.color}22; color: ${typeMeta.color}; border: 1px solid ${typeMeta.color}44;">
          ${typeMeta.icon}
        </div>
        <div class="coin-history-body">
          <div class="coin-history-title-row">
            <span class="coin-history-desc">${tx.description || 'Giao dịch xu'}</span>
            <span class="coin-history-badge" style="color: ${typeMeta.color}; border-color: ${typeMeta.color}44;">
              ${typeMeta.label}
            </span>
          </div>
          <div class="coin-history-meta-row">
            <span class="coin-history-time">${timeStr} • ${dateStr}</span>
            <span class="coin-history-after">Số dư: <strong>${(tx.balanceAfter !== undefined ? tx.balanceAfter : (user.coins || 100)).toLocaleString('vi-VN')} 🪙</strong></span>
          </div>
        </div>
        <div class="coin-history-amount ${isPos ? 'pos' : 'neg'}">
          ${isPos ? '+' : ''}${tx.amount.toLocaleString('vi-VN')} 🪙
        </div>
      </div>
    `;
  }).join('');
}

window.appFilterCoinHistory = function(filter) {
  SoundService.playClick();
  renderCoinHistory(filter);
};

window.appOpenShopModal = function() {
  const user = StorageService.getCurrentUser();
  if (!user) {
    showToast('Vui lòng đăng nhập hoặc chọn hồ sơ của bạn trước khi vào Cửa Hàng!', 'info');
    window.appOpenLoginModal();
    return;
  }

  const modal = document.getElementById('modal-club-shop');
  if (modal) {
    modal.classList.add('open');
    window.appSwitchShopTab('store');
    renderClubShop();
  }
};

window.appOpenWalletModal = function() {
  window.appOpenShopModal();
  window.appSwitchShopTab('history');
};

window.appSwitchShopTab = function(tab) {
  const btnStore = document.getElementById('btn-shop-tab-store');
  const btnInv = document.getElementById('btn-shop-tab-inventory');
  const btnHist = document.getElementById('btn-shop-tab-history');
  const panelStore = document.getElementById('shop-panel-store');
  const panelInv = document.getElementById('shop-panel-inventory');
  const panelHist = document.getElementById('shop-panel-history');

  btnStore?.classList.remove('active');
  btnInv?.classList.remove('active');
  btnHist?.classList.remove('active');
  if (panelStore) panelStore.style.display = 'none';
  if (panelInv) panelInv.style.display = 'none';
  if (panelHist) panelHist.style.display = 'none';

  if (tab === 'inventory') {
    btnInv?.classList.add('active');
    if (panelInv) panelInv.style.display = 'block';
  } else if (tab === 'history') {
    btnHist?.classList.add('active');
    if (panelHist) panelHist.style.display = 'block';
    renderCoinHistory();
  } else {
    btnStore?.classList.add('active');
    if (panelStore) panelStore.style.display = 'block';
  }
  SoundService.playClick();
};

window.appBuyShopItem = function(itemId) {
  const user = StorageService.getCurrentUser();
  if (!user) {
    window.appOpenLoginModal();
    return;
  }

  const res = StorageService.buyShopItem(user.id, itemId);
  if (!res.success) {
    showToast(res.message, 'error');
    return;
  }

  // Cập nhật state
  state.currentUser = StorageService.getCurrentUser();
  renderUserAuthHeader();
  renderClubShop();

  if (res.item.type === 'frame') {
    confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.6 }
    });
    SoundService.playLevelUp();
    showToast(`🎉 Mua thành công ${res.item.name}! Hãy mở "Túi Đồ Của Tôi" để đeo khung!`, 'success');
  } else {
    SoundService.playClick();
    showToast(`✅ Mua thành công ${res.item.name}! (Số dư còn lại: ${res.balanceAfter} Xu)`, 'success');
  }
};

window.appEquipFrame = function(frameId) {
  const user = StorageService.getCurrentUser();
  if (!user) return;

  const res = StorageService.equipAvatarFrame(user.id, frameId);
  if (!res.success) {
    showToast(res.message, 'error');
    return;
  }

  state.currentUser = StorageService.getCurrentUser();
  SoundService.playClick();
  showToast(frameId ? '✨ Đã đeo khung Avatar mới thành công!' : 'Đã chuyển về khung Avatar mặc định', 'success');

  renderClubShop();
  renderUserAuthHeader();
  renderLeaderboard();
  renderAttendance();
  renderMembers();
  renderCourt();
};

window.appToggleEloShield = function() {
  const user = StorageService.getCurrentUser();
  if (!user) return;

  const res = StorageService.toggleEloShield(user.id);
  if (!res.success) {
    showToast(res.message, 'error');
    return;
  }

  state.currentUser = StorageService.getCurrentUser();
  SoundService.playClick();
  showToast(res.activeEloShield ? '🛡️ Đã BẬT Khiên bảo vệ Elo cho trận đấu tiếp theo!' : 'Đã TẮT Khiên bảo vệ Elo', 'info');

  renderClubShop();
  renderCourt();
};

window.appClaimGrip = async function() {
  const user = StorageService.getCurrentUser();
  if (!user) return;

  const confirmClaim = await showConfirmModal({
    title: 'Nhận Cuốn Cán Vợt?',
    message: 'Bạn có chắc chắn muốn xác nhận đã nhận 1 cuốn cán vợt thật tại sân thi đấu không?',
    confirmText: 'Đã Nhận Cán Vợt',
    icon: '🏸',
    isDanger: false
  });
  if (!confirmClaim) return;

  const res = StorageService.claimGrip(user.id);
  if (!res.success) {
    showToast(res.message, 'error');
    return;
  }

  state.currentUser = StorageService.getCurrentUser();
  SoundService.playClick();
  showToast(`🏸 Đã xác nhận nhận cuốn cán! (Còn lại trong túi: ${res.remaining})`, 'success');
  renderClubShop();
};

