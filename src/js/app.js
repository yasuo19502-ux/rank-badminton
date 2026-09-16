import confetti from 'canvas-confetti';
import { StorageService, getLocalDateStr } from './storage.js';
import { calculateDoublesElo, calculateBadges, getTierByElo, getNextTier, getPlayerDetailedStats, TIERS } from './elo.js';
import { processImageFile, generateDefaultAvatar, getAvatarUrl } from './avatar.js';
import { MatchmakerService } from './matchmaker.js';
import { SoundService } from './sound.js';
import { supabaseService } from './supabase.js';

// Trạng thái ứng dụng (Application State)
// Trạng thái ứng dụng (Application State)
const state = {
  currentTab: 'court',
  currentCourtId: 'court_1', // 'court_1' | 'court_2'
  courtMatches: {
    court_1: {
      activeMatch: null,
      score1: 21,
      score2: 18,
      mode: 'balanced'
    },
    court_2: {
      activeMatch: null,
      score1: 21,
      score2: 18,
      mode: 'balanced'
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
    return this.courtMatches[this.currentCourtId]?.score1 ?? 21;
  },
  set score1(val) {
    if (this.courtMatches[this.currentCourtId]) {
      this.courtMatches[this.currentCourtId].score1 = val;
    }
  },
  get score2() {
    return this.courtMatches[this.currentCourtId]?.score2 ?? 18;
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
  leaderboardSort: 'elo',
  searchQuery: '',
  editingMemberId: null,
  editingSessionId: null,
  tempAvatarBase64: null,
  calendarViewMode: 'grid', // 'grid' | 'list'
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0 - 11
  calendarSelectedDate: getLocalDateStr()
};

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  initTheme();
  setupEventListeners();
  loadInitialState();
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
  const savedCourt1 = StorageService.getActiveMatch('court_1');
  if (savedCourt1 && savedCourt1.team1 && savedCourt1.team2) {
    state.courtMatches.court_1.activeMatch = savedCourt1;
    state.courtMatches.court_1.score1 = savedCourt1.score1 || 0;
    state.courtMatches.court_1.score2 = savedCourt1.score2 || 0;
    state.courtMatches.court_1.mode = savedCourt1.mode || 'balanced';
  }

  const savedCourt2 = StorageService.getActiveMatch('court_2');
  if (savedCourt2 && savedCourt2.team1 && savedCourt2.team2) {
    state.courtMatches.court_2.activeMatch = savedCourt2;
    state.courtMatches.court_2.score1 = savedCourt2.score1 || 0;
    state.courtMatches.court_2.score2 = savedCourt2.score2 || 0;
    state.courtMatches.court_2.mode = savedCourt2.mode || 'balanced';
  }

  updateCourtTabStatusPills();
}

function updateCourtTabStatusPills() {
  const p1 = document.getElementById('court-1-status-text');
  const p2 = document.getElementById('court-2-status-text');
  const m1 = state.courtMatches.court_1.activeMatch;
  const m2 = state.courtMatches.court_2.activeMatch;

  if (p1) {
    if (m1 && m1.team1 && m1.team2) {
      p1.textContent = `Đang đấu (${state.courtMatches.court_1.score1} - ${state.courtMatches.court_1.score2})`;
      p1.style.color = 'var(--volt)';
    } else {
      p1.textContent = 'Đang trống';
      p1.style.color = 'var(--text-dim)';
    }
  }

  if (p2) {
    if (m2 && m2.team1 && m2.team2) {
      p2.textContent = `Đang đấu (${state.courtMatches.court_2.score1} - ${state.courtMatches.court_2.score2})`;
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
        const swapped = MatchmakerService.swapPlayers(state.activeMatch.team1, state.activeMatch.team2, 0, 0);
        state.activeMatch.team1 = swapped.team1;
        state.activeMatch.team2 = swapped.team2;
        state.activeMatch.diffElo = swapped.diffElo;
        StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
        SoundService.playClick();
        renderCourt();
        updateCourtTabStatusPills();
        showToast('Đã đổi người giữa 2 đội!');
      }
    });
  }

  // 5. Điều chỉnh Tỷ số (Đồng bộ Realtime đa thiết bị ngay khi bấm điểm)
  let syncScoreTimeout = null;
  const debouncedSyncLiveScore = () => {
    if (!state.activeMatch) return;
    state.activeMatch.score1 = state.score1;
    state.activeMatch.score2 = state.score2;
    StorageService.saveLocalActiveMatch(state.activeMatch, state.currentCourtId);
    updateCourtTabStatusPills();

    if (syncScoreTimeout) clearTimeout(syncScoreTimeout);
    syncScoreTimeout = setTimeout(() => {
      StorageService.saveActiveMatch(state.activeMatch, state.currentCourtId);
    }, 250);
  };

  const setupScoreButton = (id, delta, isTeam1) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      if (isTeam1) {
        state.score1 = Math.max(0, Math.min(30, state.score1 + delta));
      } else {
        state.score2 = Math.max(0, Math.min(30, state.score2 + delta));
      }
      SoundService.playSmash();
      updateScoreboardDisplay();
      renderEloPrediction();
      debouncedSyncLiveScore();
    });
  };

  setupScoreButton('btn-t1-minus', -1, true);
  setupScoreButton('btn-t1-plus', 1, true);
  setupScoreButton('btn-t2-minus', -1, false);
  setupScoreButton('btn-t2-plus', 1, false);

  // Preset Tỷ số
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.score1 = parseInt(chip.dataset.s1, 10);
      state.score2 = parseInt(chip.dataset.s2, 10);
      SoundService.playClick();
      updateScoreboardDisplay();
      renderEloPrediction();
      debouncedSyncLiveScore();
    });
  });

  // 6. Nút Xác Nhận Kết Quả Trận Đấu
  const btnFinish = document.getElementById('btn-finish-match');
  if (btnFinish) {
    btnFinish.addEventListener('click', finishMatch);
  }

  // 7. Tab Bảng Xếp Hạng Sub-tabs
  document.querySelectorAll('.lb-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-subtab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.leaderboardSort = btn.dataset.lbsort;
      SoundService.playClick();
      renderLeaderboard();
    });
  });

  // 8. Điểm danh Quick Actions
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

  // Xử lý Form Thêm/Sửa Thành Viên
  const formMember = document.getElementById('form-member');
  if (formMember) {
    formMember.addEventListener('submit', handleMemberFormSubmit);
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
    btnReset.addEventListener('click', () => {
      if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (thành viên, lịch sử trận, điểm danh) để làm mới 100% không?')) {
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
    btnSettingsReset.addEventListener('click', () => {
      if (confirm('Bạn có chắc chắn muốn xóa toàn bộ dữ liệu (thành viên, lịch sử trận, điểm danh) để làm mới 100% không?')) {
        StorageService.resetAllData();
        closeAllModals();
        loadInitialState();
        switchTab(state.currentTab);
        showToast('Đã làm sạch toàn bộ dữ liệu!');
      }
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
  const team1Half = document.querySelector('.team-1-half');
  const team2Half = document.querySelector('.team-2-half');
  const netBadge = document.querySelector('.net-badge');

  // Cập nhật tên lưới theo sân hiện tại
  if (netBadge) {
    netBadge.textContent = state.currentCourtId === 'court_2' ? 'LƯỚI THÁI THỊNH - SÂN 2' : 'LƯỚI THÁI THỊNH - SÂN 1';
  }

  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2) {
    const allMembers = StorageService.getMembers();
    const att = StorageService.getAttendance();
    const presentCount = att?.presentIds?.length || 0;

    let emptyCardHtml = '';
    if (allMembers.length < 4) {
      emptyCardHtml = `
        <div class="court-empty-card">
          <div class="court-empty-icon">🏸</div>
          <h4 class="court-empty-title">Cần tối thiểu 4 thành viên để ghép trận đôi</h4>
          <p class="court-empty-desc">Hiện CLB có <strong>${allMembers.length}</strong> thành viên. Hãy thêm thành viên thật để máy tự động bốc thăm cân kèo!</p>
          <button class="btn-court-action" onclick="window.appOpenAddMember()">➕ Thêm Thành Viên Ngay</button>
        </div>
      `;
    } else if (presentCount < 4) {
      emptyCardHtml = `
        <div class="court-empty-card">
          <div class="court-empty-icon">📋</div>
          <h4 class="court-empty-title">Chưa đủ người có mặt hôm nay (${presentCount}/4)</h4>
          <p class="court-empty-desc">Vào tab "Điểm Danh" để đánh dấu những ai đang có mặt tại sân.</p>
          <button class="btn-court-action" onclick="window.appSwitchTab('attendance')">Đi Đến Điểm Danh 👉</button>
        </div>
      `;
    } else {
      emptyCardHtml = `
        <div class="court-empty-card">
          <div class="court-empty-icon">⚡</div>
          <h4 class="court-empty-title">Sân Đang Trống - Sẵn Sàng Vào Trận</h4>
          <p class="court-empty-desc">Đã có <strong>${presentCount}</strong> thành viên có mặt. Nhấn <strong>"Quay Trận Mới"</strong> để máy bốc thăm kèo đấu cân nhất!</p>
          <button class="btn-court-action" onclick="window.appGenerateMatch()">⚡ Quay Trận Mới Ngay</button>
        </div>
      `;
    }

    if (emptyOverlay) {
      emptyOverlay.innerHTML = emptyCardHtml;
      emptyOverlay.style.display = 'flex';
    }
    if (team1Half) team1Half.style.opacity = '0.35';
    if (team2Half) team2Half.style.opacity = '0.35';
    if (team1Grid) team1Grid.innerHTML = '';
    if (team2Grid) team2Grid.innerHTML = '';
    if (t1AvgLabel) t1AvgLabel.textContent = 'Elo TB: 0';
    if (t2AvgLabel) t2AvgLabel.textContent = 'Elo TB: 0';

    updateScoreboardDisplay();
    renderEloPrediction();
    return;
  }

  // Khi đã có trận đấu
  if (emptyOverlay) {
    emptyOverlay.style.display = 'none';
  }
  if (team1Half) team1Half.style.opacity = '1';
  if (team2Half) team2Half.style.opacity = '1';

  // Lấy dữ liệu mới nhất từ storage đề phòng thành viên vừa được sửa điểm
  const memberMap = new Map(StorageService.getMembers().map(m => [m.id, m]));
  const t1 = state.activeMatch.team1.map(p => memberMap.get(p.id) || p);
  const t2 = state.activeMatch.team2.map(p => memberMap.get(p.id) || p);

  // Render Team 1
  if (team1Grid) {
    team1Grid.innerHTML = t1.map(p => renderCourtPlayerCard(p)).join('');
  }
  const elo1 = Math.round((t1[0].elo + t1[1].elo) / 2);
  if (t1AvgLabel) t1AvgLabel.textContent = `Elo TB: ${elo1}`;

  // Render Team 2
  if (team2Grid) {
    team2Grid.innerHTML = t2.map(p => renderCourtPlayerCard(p)).join('');
  }
  const elo2 = Math.round((t2[0].elo + t2[1].elo) / 2);
  if (t2AvgLabel) t2AvgLabel.textContent = `Elo TB: ${elo2}`;

  updateScoreboardDisplay();
  renderEloPrediction();
}

function renderCourtPlayerCard(player) {
  const tier = getTierByElo(player.elo);
  const avatarUrl = getAvatarUrl(player);
  const isMale = player.gender === 'male';

  return `
    <div class="court-player-card">
      <div class="player-avatar-wrap">
        <img class="player-avatar" src="${avatarUrl}" alt="${player.name}" onerror="this.src='${generateDefaultAvatar(player.name, player.gender)}'">
        <span class="gender-badge-dot ${isMale ? 'gender-male' : 'gender-female'}">
          ${isMale ? '♂' : '♀'}
        </span>
      </div>
      <div class="player-info">
        <div class="player-name">${player.name}</div>
        <div class="player-nickname">${player.nickname || 'Thành viên'}</div>
        <div class="player-meta-row">
          <span class="tier-pill" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
            ${tier.icon} ${tier.name}
          </span>
          <span class="elo-pill">${player.elo}</span>
        </div>
      </div>
    </div>
  `;
}

function updateScoreboardDisplay() {
  const t1Val = document.getElementById('score-team1-val');
  const t2Val = document.getElementById('score-team2-val');
  if (t1Val) t1Val.textContent = state.score1;
  if (t2Val) t2Val.textContent = state.score2;
}

function renderEloPrediction() {
  const previewBox = document.getElementById('elo-preview-box');
  if (!previewBox) return;

  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2) {
    previewBox.innerHTML = '<span>Dự đoán Elo sẽ xuất hiện khi có đủ 2 đội</span>';
    return;
  }

  const t1 = state.activeMatch.team1;
  const t2 = state.activeMatch.team2;

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
 * Tạo trận mới cho sân hiện tại với hiệu ứng xốc đĩa quay số
 */
function generateNewMatch(withAnimation = true) {
  const attendance = StorageService.getAttendance();
  const members = StorageService.getMembers();
  const presentMembers = members.filter(m => attendance.presentIds.includes(m.id));

  if (members.length < 4) {
    showToast(`CLB cần ít nhất 4 thành viên để ghép đôi! Hiện mới có ${members.length} người.`, 'error');
    switchTab('members');
    openMemberModal();
    return;
  }

  // Loại trừ những người đang đánh ở sân còn lại (Court 1 hoặc Court 2)
  const otherCourtId = state.currentCourtId === 'court_1' ? 'court_2' : 'court_1';
  const otherMatch = state.courtMatches[otherCourtId].activeMatch;
  const excludeIds = [];
  if (otherMatch && otherMatch.team1 && otherMatch.team2) {
    otherMatch.team1.forEach(p => excludeIds.push(p.id));
    otherMatch.team2.forEach(p => excludeIds.push(p.id));
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
  const presentMembers = members.filter(m => attendance.presentIds.includes(m.id));

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
  if (!state.activeMatch || !state.activeMatch.team1 || !state.activeMatch.team2) {
    showToast('Chưa có trận đấu nào trên sân!', 'error');
    return;
  }

  if (state.score1 === state.score2) {
    showToast('Tỷ số chưa có người thắng! Cầu lông không có tỉ số hòa.', 'error');
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
      const oldTier = getTierByElo(mem.elo);
      mem.elo = Math.max(500, mem.elo + delta);
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
    }
  };

  team1.forEach(p => updatePlayer(p, result.deltaTeam1, team1Won));
  team2.forEach(p => updatePlayer(p, result.deltaTeam2, !team1Won));

  // Lưu members đã cập nhật
  StorageService.saveMembers(members);

  // Lưu trận đấu vào lịch sử
  const activeCourt = state.currentCourtId === 'court_2' ? 'Sân 2' : 'Sân 1';
  StorageService.addMatch({
    courtNumber: activeCourt,
    team1: team1.map(p => p.id),
    team2: team2.map(p => p.id),
    score1: state.score1,
    score2: state.score2,
    eloChange: Math.abs(result.deltaTeam1),
    isDeuce: result.isDeuce
  });

  // Ghi nhận số trận chơi hôm nay
  const allIds = [...team1.map(p => p.id), ...team2.map(p => p.id)];
  StorageService.recordGamePlayedToday(allIds);

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

  // Tự động quay trận tiếp theo cho sân này
  setTimeout(() => {
    generateNewMatch(false);
  }, 1000);
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

  if (countBadge) countBadge.textContent = `${members.length} Thành Viên`;

  // Sắp xếp danh sách
  const sortedMembers = [...members].sort((a, b) => {
    if (state.leaderboardSort === 'matches') {
      return b.matchesPlayed - a.matchesPlayed;
    } else if (state.leaderboardSort === 'wins') {
      return b.wins - a.wins;
    } else if (state.leaderboardSort === 'winrate') {
      const rateA = a.matchesPlayed > 0 ? a.wins / a.matchesPlayed : 0;
      const rateB = b.matchesPlayed > 0 ? b.wins / b.matchesPlayed : 0;
      return rateB - rateA;
    } else {
      // Default: 'elo'
      return b.elo - a.elo;
    }
  });

  if (sortedMembers.length === 0) {
    if (podiumContainer) podiumContainer.innerHTML = '';
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state-box" style="margin-top: 10px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🏸</div>
          <h3 class="empty-state-title">CLB Thái Thịnh chưa có thành viên</h3>
          <p class="empty-state-desc">
            Dữ liệu thành viên đang để trống để bạn tự nhập danh sách thật của CLB. Bấm nút bên dưới để thêm thành viên đầu tiên!
          </p>
          <button class="btn btn-primary" onclick="window.appOpenAddMember()" style="padding: 10px 24px; font-weight: 700;">
            ➕ Thêm Thành Viên Đầu Tiên
          </button>
        </div>
      `;
    }
    return;
  }

  if (podiumContainer && sortedMembers.length < 3) {
    podiumContainer.innerHTML = '';
  }

  // Render Podium Top 3 (Hạng 2 bên trái, Hạng 1 ở giữa, Hạng 3 bên phải)
  if (podiumContainer && sortedMembers.length >= 3) {
    const first = sortedMembers[0];
    const second = sortedMembers[1];
    const third = sortedMembers[2];

    const renderPodiumItem = (p, rank, badgeClass, isFirst = false) => {
      const tier = getTierByElo(p.elo);
      const avatarUrl = getAvatarUrl(p);
      return `
        <div class="podium-card ${isFirst ? 'podium-first' : ''}" onclick="window.appViewPlayerProfile('${p.id}')" style="cursor: pointer;" title="Bấm để xem hồ sơ chi tiết">
          ${isFirst ? '<div class="podium-crown">👑</div>' : ''}
          <div class="podium-rank-badge ${badgeClass}">${rank}</div>
          <img class="podium-avatar" src="${avatarUrl}" alt="${p.name}" onerror="this.src='${generateDefaultAvatar(p.name, p.gender)}'">
          <div class="podium-name">${p.name}</div>
          <div class="podium-elo">${p.elo} Elo</div>
          <div style="font-size: 0.72rem; color: ${tier.color}; font-weight: 700; margin-top: 2px;">
            ${tier.icon} ${tier.name}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 4px;">
            ${p.wins}T - ${p.losses}B (${p.matchesPlayed > 0 ? Math.round((p.wins/p.matchesPlayed)*100) : 0}%)
          </div>
        </div>
      `;
    };

    podiumContainer.innerHTML = `
      ${renderPodiumItem(second, '2', 'badge-silver')}
      ${renderPodiumItem(first, '1', 'badge-gold', true)}
      ${renderPodiumItem(third, '3', 'badge-bronze')}
    `;
  }

  // Render Danh sách từ hạng 4 trở đi (hoặc từ đầu nếu không dùng podium)
  if (listContainer) {
    listContainer.innerHTML = sortedMembers.map((p, index) => {
      const rank = index + 1;
      const tier = getTierByElo(p.elo);
      const nextTierInfo = getNextTier(p.elo);
      const avatarUrl = getAvatarUrl(p);
      const winRate = p.matchesPlayed > 0 ? Math.round((p.wins / p.matchesPlayed) * 100) : 0;

      return `
        <div class="leaderboard-row" onclick="window.appViewPlayerProfile('${p.id}')" title="Bấm để xem hồ sơ chi tiết">
          <div class="lb-rank-num">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : '#' + rank}</div>
          <img class="lb-avatar" src="${avatarUrl}" alt="${p.name}" onerror="this.src='${generateDefaultAvatar(p.name, p.gender)}'">
          <div class="lb-member-details">
            <div class="lb-name-row">
              <span class="lb-name">${p.name}</span>
              ${p.nickname ? `<span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 600;">(${p.nickname})</span>` : ''}
              <span class="tier-pill" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
                ${tier.icon} ${tier.name}
              </span>
            </div>
            <div class="lb-stats-sub">
              <span>Đã đấu: <strong>${p.matchesPlayed}</strong></span>
              <span>Thắng: <strong style="color: #4ade80;">${p.wins}</strong></span>
              <span>Thua: <strong style="color: #f87171;">${p.losses}</strong></span>
              <span>Tỷ lệ: <strong>${winRate}%</strong></span>
              ${p.streak >= 2 ? `<span style="color: #ef4444; font-weight: 800;">🔥 Thắng ${p.streak} trận</span>` : ''}
            </div>
          </div>
          <div class="lb-elo-box">
            <div class="lb-elo-num">${p.elo}</div>
            <div class="lb-tier-label">${nextTierInfo.tier ? `Cần +${nextTierInfo.pointsNeeded} lên ${nextTierInfo.tier.name}` : 'Tối thượng'}</div>
          </div>
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
  const grid = document.getElementById('attendance-grid-container');

  if (!grid) return;

  if (members.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1/-1;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">📋</div>
        <h4 class="empty-state-title">Chưa có thành viên để điểm danh</h4>
        <p class="empty-state-desc">Vui lòng thêm thành viên vào CLB để bắt đầu điểm danh ai có mặt hôm nay.</p>
        <button class="btn btn-primary" onclick="window.appOpenAddMember()">➕ Thêm Thành Viên</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = members.map(m => {
    const isPresent = attendance.presentIds.includes(m.id);
    const gamesCount = (attendance.gamesPlayedToday && attendance.gamesPlayedToday[m.id]) || 0;
    const avatarUrl = getAvatarUrl(m);

    return `
      <div class="attendance-card ${isPresent ? 'present' : ''}" onclick="window.appToggleAttendance('${m.id}')">
        <div class="att-left">
          <img class="att-avatar" src="${avatarUrl}" alt="${m.name}" onerror="this.src='${generateDefaultAvatar(m.name, m.gender)}'">
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
}

// Global hook để gọi từ HTML onclick
window.appToggleAttendance = function(memberId) {
  StorageService.toggleAttendance(memberId);
  SoundService.playClick();
  renderAttendance();
  updateSessionStatusBadge();
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

    return `
      <div class="member-management-card">
        <div class="card-top-actions">
          <button class="btn-mini-action" onclick="window.appEditMember('${m.id}')" title="Sửa thông tin">✎</button>
          <button class="btn-mini-action btn-mini-danger" onclick="window.appDeleteMember('${m.id}')" title="Xóa thành viên">✕</button>
        </div>

        <div class="member-card-profile" onclick="window.appViewPlayerProfile('${m.id}')" style="cursor: pointer;" title="Bấm để xem hồ sơ chi tiết">
          <div class="member-card-avatar-wrap" onclick="event.stopPropagation(); window.appTriggerAvatarUpload('${m.id}')" title="Bấm để đổi ảnh đại diện">
            <img class="member-card-avatar" src="${avatarUrl}" alt="${m.name}" onerror="this.src='${generateDefaultAvatar(m.name, m.gender)}'">
            <div class="camera-overlay-badge">📷</div>
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 800; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.name}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${m.nickname || 'Chưa có biệt danh'}</div>
            <div style="margin-top: 4px;">
              <span class="tier-pill" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor};">
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

// Global hook để Chuyển Tab từ nút UI
window.appSwitchTab = function(tabName) {
  switchTab(tabName);
};

// Global hook để Sửa Thành Viên
window.appEditMember = function(memberId) {
  openMemberModal(memberId);
};

// Global hook để Xóa Thành Viên
window.appDeleteMember = function(memberId) {
  const mem = StorageService.getMemberById(memberId);
  if (!mem) return;
  if (confirm(`Bạn có chắc muốn xóa thành viên "${mem.name}" khỏi CLB Thái Thịnh?`)) {
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
  const previewImg = document.getElementById('preview-avatar-img');

  if (memberId) {
    const mem = StorageService.getMemberById(memberId);
    if (mem) {
      if (title) title.textContent = `Chỉnh Sửa: ${mem.name}`;
      if (nameInput) nameInput.value = mem.name;
      if (nickInput) nickInput.value = mem.nickname || '';
      if (genderSelect) genderSelect.value = mem.gender || 'male';
      if (freqSelect) freqSelect.value = mem.frequency || 'regular';
      if (eloInput) eloInput.value = mem.elo || 1000;
      if (previewImg) previewImg.src = getAvatarUrl(mem);
    }
  } else {
    if (title) title.textContent = 'Thêm Thành Viên Mới';
    if (nameInput) nameInput.value = '';
    if (nickInput) nickInput.value = '';
    if (genderSelect) genderSelect.value = 'male';
    if (freqSelect) freqSelect.value = 'regular';
    if (eloInput) eloInput.value = 1000;
    if (previewImg) previewImg.src = generateDefaultAvatar('Mới', 'male');
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

  if (!name) {
    showToast('Vui lòng nhập họ và tên', 'error');
    return;
  }

  if (state.editingMemberId) {
    const updateData = { name, nickname, gender, frequency, elo };
    if (state.tempAvatarBase64) {
      updateData.avatar = state.tempAvatarBase64;
    }
    StorageService.updateMember(state.editingMemberId, updateData);
    showToast(`Đã cập nhật thông tin ${name}`);
  } else {
    const newMember = StorageService.addMember({
      name,
      nickname,
      gender,
      frequency,
      elo,
      avatar: state.tempAvatarBase64 || ''
    });
    // Tự động thêm vào điểm danh hôm nay
    StorageService.toggleAttendance(newMember.id);
    showToast(`Đã thêm thành viên ${name}`);
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
  const members = StorageService.getMembers();
  const container = document.getElementById('history-matches-container');
  const countBadge = document.getElementById('total-matches-count-badge');

  if (countBadge) countBadge.textContent = `${matches.length} Trận`;
  if (!container) return;

  if (matches.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">
      Chưa có trận đấu nào được ghi lại.
    </div>`;
    return;
  }

  const memberMap = new Map(members.map(m => [m.id, m]));

  container.innerHTML = matches.map(m => {
    const t1Names = m.team1.map(id => memberMap.get(id)?.name || 'VĐV').join(' & ');
    const t2Names = m.team2.map(id => memberMap.get(id)?.name || 'VĐV').join(' & ');
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
            ±${m.eloChange || 16} Elo ${m.isDeuce ? '• Deuce' : ''}
          </div>
          <button onclick="window.appDeleteMatch('${m.id}')" style="background: none; border: none; color: var(--coral); cursor: pointer; font-size: 0.75rem; margin-top: 4px;">
            Hoàn tác trận
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Global hook để Hoàn tác / Xóa trận đấu
window.appDeleteMatch = function(matchId) {
  if (confirm('Bạn có chắc muốn hoàn tác và xóa trận đấu này?')) {
    StorageService.deleteMatch(matchId);
    showToast('Đã hoàn tác trận đấu');
    renderHistory();
    renderBadges();
  }
};

/**
 * =========================================================================
 * UTILITIES
 * =========================================================================
 */
function updateSessionStatusBadge() {
  const attendance = StorageService.getAttendance();
  const members = StorageService.getMembers();
  const matches = StorageService.getMatches();

  const presentCount = attendance.presentIds.length;
  const presentMembers = members.filter(m => attendance.presentIds.includes(m.id));
  const maleCount = presentMembers.filter(m => m.gender === 'male').length;
  const femaleCount = presentMembers.filter(m => m.gender === 'female').length;

  const counterEl = document.getElementById('session-counter-text');
  if (counterEl) {
    counterEl.textContent = `Hôm nay: ${presentCount} người (${maleCount} Nam, ${femaleCount} Nữ) | Đã đấu: ${matches.length} trận`;
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '⚡' : '⚠️'}</span> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function updateCloudStatusIndicator() {
  const dot = document.getElementById('cloud-status-dot');
  const text = document.getElementById('cloud-status-text');
  const btn = document.getElementById('btn-cloud-status');
  if (!dot || !text) return;

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
  const synced = await StorageService.syncFromCloud();
  if (synced) {
    loadInitialState();
    switchTab(state.currentTab);
    updateSessionStatusBadge();
    console.log('[App] Đã đồng bộ dữ liệu mới nhất từ Supabase Cloud!');
  }

  // 2. Lắng nghe thay đổi Realtime (tự động đồng bộ đa thiết bị tức thì)
  supabaseService.subscribeToChanges(async (table, payload) => {
    console.log(`[Realtime] Nhận được thay đổi ở bảng ${table}:`, payload);

    if (table === 'live_court') {
      const record = payload.new;
      if (record && (record.id === 'court_1' || record.id === 'court_2' || record.id === 'current_court')) {
        const targetCourtId = record.id === 'court_2' ? 'court_2' : 'court_1';
        const members = StorageService.getMembers();
        const memberMap = new Map(members.map(m => [m.id, m]));
        const team1 = (record.team1 || []).map(id => memberMap.get(id)).filter(Boolean);
        const team2 = (record.team2 || []).map(id => memberMap.get(id)).filter(Boolean);

        if (team1.length > 0 && team2.length > 0) {
          const matchObj = {
            courtNumber: record.court_number || (targetCourtId === 'court_2' ? 'Sân 2' : 'Sân 1'),
            team1,
            team2,
            score1: record.score1 || 0,
            score2: record.score2 || 0,
            mode: record.matchmaker_mode || 'balanced',
            status: record.status || 'in_progress',
            diffElo: record.diff_elo || 0
          };
          state.courtMatches[targetCourtId].activeMatch = matchObj;
          state.courtMatches[targetCourtId].score1 = record.score1 || 0;
          state.courtMatches[targetCourtId].score2 = record.score2 || 0;
          StorageService.saveLocalActiveMatch(matchObj, targetCourtId);
        } else if (record.status === 'idle') {
          state.courtMatches[targetCourtId].activeMatch = null;
          state.courtMatches[targetCourtId].score1 = 0;
          state.courtMatches[targetCourtId].score2 = 0;
          StorageService.saveLocalActiveMatch(null, targetCourtId);
        }

        updateCourtTabStatusPills();

        if (state.currentCourtId === targetCourtId) {
          renderCourt();
          updateScoreboardDisplay();
          renderEloPrediction();
        }
      }
      return;
    }

    // Với các bảng còn lại (members, sessions, matches, attendance, club_settings)
    await StorageService.syncFromCloud();
    loadInitialState();
    switchTab(state.currentTab);
    updateSessionStatusBadge();

    if (table === 'members') {
      showToast('☁️ Bảng xếp hạng và thành viên vừa được cập nhật!');
    } else if (table === 'sessions') {
      showToast('📅 Lịch buổi đánh vừa được cập nhật!');
    } else if (table === 'matches') {
      showToast('🏸 Kết quả trận đấu mới vừa được ghi nhận!');
    } else if (table === 'attendance') {
      showToast('✅ Danh sách điểm danh vừa được cập nhật!');
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
  const members = StorageService.getMembers();
  const session = StorageService.getSessions().find(s => s.id === sessionId);
  if (!session) return;

  const chosenName = prompt('Nhập tên thành viên đăng ký tham gia buổi này:\n(Ví dụ: gõ "Long", "Hương", "Huy"...)');
  if (!chosenName) return;

  const matched = members.find(m => 
    m.name.toLowerCase().includes(chosenName.toLowerCase().trim()) ||
    (m.nickname && m.nickname.toLowerCase().includes(chosenName.toLowerCase().trim()))
  );

  if (matched) {
    StorageService.rsvpSession(sessionId, matched.id, 'attending');
    SoundService.playClick();
    showToast(`✅ ${matched.name} đã đăng ký tham gia!`);
    renderSessions();
  } else {
    showToast('Không tìm thấy thành viên có tên tương tự', 'error');
  }
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

window.appDeleteSession = function(sessionId) {
  if (confirm('Bạn có chắc chắn muốn xóa lịch buổi đánh này không?')) {
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
          <img class="profile-avatar-large" src="${avatarUrl}" alt="${m.name}" onerror="this.src='${generateDefaultAvatar(m.name, m.gender)}'">
          <span class="gender-badge-dot ${isMale ? 'gender-male' : 'gender-female'}" style="width: 24px; height: 24px; font-size: 13px;">
            ${isMale ? '♂' : '♀'}
          </span>
        </div>
        <div class="profile-hero-details">
          <div class="profile-hero-name">${m.name}</div>
          <div class="profile-hero-nick">${m.nickname || 'Chiến binh CLB Thái Thịnh'}</div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
            <span class="tier-pill" style="background: ${tier.bgColor}; color: ${tier.color}; border: 1px solid ${tier.borderColor}; font-size: 0.8rem; padding: 2px 10px;">
              ${tier.icon} ${tier.name}
            </span>
            <span style="font-size: 0.75rem; color: var(--text-dim); font-weight: 700;">
              ${m.frequency === 'regular' ? '⚡ Nòng cốt' : '🍃 Thỉnh thoảng'}
            </span>
          </div>
        </div>
      </div>

      <!-- Elo & Next Tier Progress -->
      <div class="profile-rank-progress-box">
        <div class="progress-header">
          <span>Hạng <strong>#${stats.rank}</strong> • <span style="color: var(--volt); font-weight: 900;">${m.elo} Elo</span></span>
          <span style="color: var(--text-muted); font-size: 0.75rem;">
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
          <div class="profile-stat-num" style="color: var(--volt);">${m.elo}</div>
          <div class="profile-stat-label">Điểm Elo</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-num">${m.matchesPlayed}</div>
          <div class="profile-stat-label">Tổng Trận</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-num" style="color: #4ade80;">${stats.winRate}%</div>
          <div class="profile-stat-label">Tỷ Lệ Thắng</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-num" style="color: ${m.streak >= 0 ? '#ef4444' : 'var(--text-dim)'};">
            ${m.streak > 0 ? `+${m.streak}` : m.streak}
          </div>
          <div class="profile-stat-label">Chuỗi Trận</div>
        </div>
      </div>

      <!-- Best Partner Box -->
      ${stats.bestPartner ? `
        <div class="best-partner-box">
          <div class="bp-left">
            <img class="bp-avatar" src="${getAvatarUrl(stats.bestPartner.player)}" alt="${stats.bestPartner.player.name}">
            <div class="bp-info">
              <div class="bp-tag">💘 BẠN DIỄN ĂN Ý NHẤT</div>
              <div class="bp-name">${stats.bestPartner.player.name}</div>
            </div>
          </div>
          <div class="bp-stats">
            <div style="color: var(--gold); font-size: 1.1rem; font-weight: 900;">${stats.bestPartner.rate}%</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${stats.bestPartner.won}/${stats.bestPartner.played} Trận Thắng</div>
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

