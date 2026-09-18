/**
 * elo.js - Thuật toán Doubles Elo & Cấp bậc Xếp hạng CLB Thái Thịnh
 */

export const TIERS = [
  {
    id: 'ga_nhat_cau',
    name: 'Gà Nhặt Cầu',
    icon: '🐣',
    minElo: 0,
    maxElo: 999,
    color: '#94a3b8',
    bgColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: '#64748b',
    description: 'Khởi động vui vẻ, vợt chạm đất nhiều hơn chạm cầu'
  },
  {
    id: 'chat_cau_phui',
    name: 'Chặt Cầu Phủi',
    icon: '🏸',
    minElo: 1000,
    maxElo: 1199,
    color: '#38bdf8',
    bgColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#0284c7',
    description: 'Biết điều cầu cơ bản, thỉnh thoảng phát cầu rúc lưới'
  },
  {
    id: 'cat_cau_bay',
    name: 'Cắt Cầu Bay',
    icon: '⚡',
    minElo: 1200,
    maxElo: 1349,
    color: '#a3e635',
    bgColor: 'rgba(163, 230, 53, 0.15)',
    borderColor: '#65a30d',
    description: 'Phản xạ nhanh, biết gài lưới và chụp góc hiểm'
  },
  {
    id: 'smash_chay_san',
    name: 'Smash Cháy Sân',
    icon: '💥',
    minElo: 1350,
    maxElo: 1499,
    color: '#fb923c',
    bgColor: 'rgba(251, 146, 60, 0.15)',
    borderColor: '#ea580c',
    description: 'Tay to cắm vạch, đối thủ nghe tiếng vợt là giật mình'
  },
  {
    id: 'chien_than',
    name: 'Chiến Thần Thái Thịnh',
    icon: '👑',
    minElo: 1500,
    maxElo: 9999,
    color: '#f43f5e',
    bgColor: 'rgba(244, 63, 94, 0.2)',
    borderColor: '#e11d48',
    description: 'Gánh mọi loại tạ, hào quang sân cầu lông Thái Thịnh'
  }
];

export function getTierByElo(elo) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (elo >= TIERS[i].minElo) {
      return TIERS[i];
    }
  }
  return TIERS[0];
}

export function getNextTier(elo) {
  const currentTier = getTierByElo(elo);
  const currentIndex = TIERS.findIndex(t => t.id === currentTier.id);
  if (currentIndex < TIERS.length - 1) {
    const nextTier = TIERS[currentIndex + 1];
    return {
      tier: nextTier,
      pointsNeeded: nextTier.minElo - elo,
      progressPercent: Math.min(100, Math.max(0, ((elo - currentTier.minElo) / (nextTier.minElo - currentTier.minElo)) * 100))
    };
  }
  return {
    tier: null,
    pointsNeeded: 0,
    progressPercent: 100
  };
}

/**
 * Tính toán kết quả Elo cho trận đánh đôi
 * @param {Array<Object>} team1Players - [playerA1, playerA2]
 * @param {Array<Object>} team2Players - [playerB1, playerB2]
 * @param {number} score1 - Tỷ số đội 1
 * @param {number} score2 - Tỷ số đội 2
 * @returns {Object} Kết quả biến động Elo
 */
export function calculateDoublesElo(team1Players, team2Players, score1, score2) {
  const elo1 = (team1Players[0].elo + team1Players[1].elo) / 2;
  const elo2 = (team2Players[0].elo + team2Players[1].elo) / 2;

  // Xác suất thắng kỳ vọng của Team 1
  const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
  const expected2 = 1 - expected1;

  const actual1 = score1 > score2 ? 1 : 0;
  const scoreDiff = Math.abs(score1 - score2);

  // Hệ số cách biệt điểm số (Margin of Victory Multiplier)
  // Thắng huỷ diệt (ví dụ 21-5) được cộng nhiều hơn thắng deuce sít sao (21-19, 22-20)
  const eloDiff = Math.abs(elo1 - elo2);
  const marginMultiplier = Math.log(scoreDiff + 1) * (2.2 / (eloDiff * 0.001 + 2.2));

  // K-factor trung bình của từng đội
  const getTeamK = (team) => {
    // Nếu có người mới hoặc thỉnh thoảng chơi (< 10 trận), K cao hơn để nhanh về đúng rank
    const avgMatches = (team[0].matchesPlayed + team[1].matchesPlayed) / 2;
    if (avgMatches < 10) return 40;
    if (avgMatches < 20) return 30;
    return 24;
  };

  const k1 = getTeamK(team1Players);
  const k2 = getTeamK(team2Players);

  // Lượng điểm thay đổi cơ bản
  let deltaTeam1 = 0;
  let deltaTeam2 = 0;

  if (actual1 === 1) {
    // Đội 1 thắng
    let winDelta = Math.round(k1 * (1 - expected1) * marginMultiplier);
    const maxDelta = Math.round(k1 * 1.2);
    if (winDelta > maxDelta) winDelta = maxDelta;
    if (winDelta < 5) winDelta = 5;

    deltaTeam1 = winDelta;
    // Đội 2 thua: Giảm 20% mức phạt so với thắng (chỉ trừ 80%), làm tròn số nguyên không có số thập phân
    const lossPenalty = Math.max(1, Math.round(winDelta * 0.8));
    deltaTeam2 = -lossPenalty;
  } else {
    // Đội 2 thắng
    let winDelta = Math.round(k2 * (1 - expected2) * marginMultiplier);
    const maxDelta = Math.round(k2 * 1.2);
    if (winDelta > maxDelta) winDelta = maxDelta;
    if (winDelta < 5) winDelta = 5;

    deltaTeam2 = winDelta;
    // Đội 1 thua: Giảm 20% mức phạt so với thắng (chỉ trừ 80%), làm tròn số nguyên không có số thập phân
    const lossPenalty = Math.max(1, Math.round(winDelta * 0.8));
    deltaTeam1 = -lossPenalty;
  }

  return {
    team1Elo: Math.round(elo1),
    team2Elo: Math.round(elo2),
    expected1: Math.round(expected1 * 100),
    expected2: Math.round(expected2 * 100),
    deltaTeam1,
    deltaTeam2,
    scoreDiff,
    isDeuce: (score1 >= 20 && score2 >= 20) || scoreDiff <= 2
  };
}

/**
 * Tính toán danh hiệu Vinh Danh (Hall of Fame) từ toàn bộ lịch sử đấu & thành viên
 */
export function calculateBadges(members, matches) {
  if (!matches || matches.length === 0 || !members || members.length === 0) {
    return [];
  }

  const memberMap = new Map(members.map(m => [m.id, m]));
  const badges = [];

  // 1. Gánh Tạ Vàng (Thắng trận có đồng đội chênh lệch Elo lớn nhất)
  let maxCarryDiff = -1;
  let bestCarryPlayer = null;
  let carryPartner = null;

  matches.forEach(m => {
    const winningTeamIds = m.score1 > m.score2 ? m.team1 : m.team2;
    const p1 = memberMap.get(winningTeamIds[0]);
    const p2 = memberMap.get(winningTeamIds[1]);
    if (p1 && p2) {
      const diff = Math.abs(p1.elo - p2.elo);
      if (diff > maxCarryDiff && diff >= 150) {
        maxCarryDiff = diff;
        if (p1.elo > p2.elo) {
          bestCarryPlayer = p1;
          carryPartner = p2;
        } else {
          bestCarryPlayer = p2;
          carryPartner = p1;
        }
      }
    }
  });

  if (bestCarryPlayer) {
    badges.push({
      id: 'carry_master',
      title: 'Gánh Tạ Vàng',
      icon: '🏋️',
      color: '#eab308',
      player: bestCarryPlayer,
      detail: `Gánh bạn diễn lệch tới ${maxCarryDiff} Elo giành chiến thắng thuyết phục!`
    });
  }

  // 2. Máy Bào Sân (Chơi nhiều trận nhất)
  const sortedByMatches = [...members].sort((a, b) => b.matchesPlayed - a.matchesPlayed);
  if (sortedByMatches.length > 0 && sortedByMatches[0].matchesPlayed > 0) {
    badges.push({
      id: 'court_grinder',
      title: 'Máy Bào Sân',
      icon: '⚡',
      color: '#06b6d4',
      player: sortedByMatches[0],
      detail: `Đã cày ${sortedByMatches[0].matchesPlayed} set đấu, thể lực tựa pin con ó!`
    });
  }

  // 3. Chiến Thần Bất Bại (Chuỗi thắng cao nhất hiện tại)
  const sortedByStreak = [...members].sort((a, b) => b.streak - a.streak);
  if (sortedByStreak.length > 0 && sortedByStreak[0].streak >= 2) {
    badges.push({
      id: 'win_streak',
      title: 'Chiến Thần Bất Bại',
      icon: '🔥',
      color: '#ef4444',
      player: sortedByStreak[0],
      detail: `Đang giữ chuỗi ${sortedByStreak[0].streak} trận thắng liên tiếp không thể cản phá!`
    });
  }

  // 4. Sứ Giả Hoà Bình (Đánh nhiều trận deuce/nghẹt thở nhất)
  const deuceCounts = {};
  matches.forEach(m => {
    if (m.isDeuce || Math.abs(m.score1 - m.score2) <= 2) {
      [...m.team1, ...m.team2].forEach(id => {
        deuceCounts[id] = (deuceCounts[id] || 0) + 1;
      });
    }
  });

  let maxDeuce = 0;
  let peacePlayerId = null;
  Object.entries(deuceCounts).forEach(([id, cnt]) => {
    if (cnt > maxDeuce) {
      maxDeuce = cnt;
      peacePlayerId = id;
    }
  });

  if (peacePlayerId && memberMap.get(peacePlayerId)) {
    badges.push({
      id: 'peace_maker',
      title: 'Sứ Giả Hoà Bình',
      icon: '🕊️',
      color: '#a855f7',
      player: memberMap.get(peacePlayerId),
      detail: `Tham gia ${maxDeuce} trận đấu giằng co sát nút 21-19, 29-28 thót tim!`
    });
  }

  // 5. Cặp Đôi Huỷ Diệt (Bộ đôi đánh chung có tỉ lệ thắng cao nhất, tối thiểu 2 trận)
  const duoStats = {}; // key: "id1_id2" sorted
  matches.forEach(m => {
    const processTeam = (teamIds, won) => {
      const sortedIds = [...teamIds].sort();
      const key = `${sortedIds[0]}__${sortedIds[1]}`;
      if (!duoStats[key]) duoStats[key] = { played: 0, won: 0, p1: sortedIds[0], p2: sortedIds[1] };
      duoStats[key].played++;
      if (won) duoStats[key].won++;
    };
    processTeam(m.team1, m.score1 > m.score2);
    processTeam(m.team2, m.score2 > m.score1);
  });

  let bestDuo = null;
  let bestDuoRate = 0;
  Object.values(duoStats).forEach(d => {
    if (d.played >= 2) {
      const rate = d.won / d.played;
      if (rate > bestDuoRate || (rate === bestDuoRate && d.played > (bestDuo?.played || 0))) {
        bestDuoRate = rate;
        bestDuo = d;
      }
    }
  });

  if (bestDuo && memberMap.get(bestDuo.p1) && memberMap.get(bestDuo.p2)) {
    const p1 = memberMap.get(bestDuo.p1);
    const p2 = memberMap.get(bestDuo.p2);
    badges.push({
      id: 'dynamic_duo',
      title: 'Cặp Đôi Huỷ Diệt',
      icon: '💘',
      color: '#ec4899',
      player: p1,
      extraPlayer: p2,
      detail: `${p1.name} & ${p2.name}: Tỉ lệ thắng ${Math.round(bestDuoRate * 100)}% (${bestDuo.won}/${bestDuo.played} trận)!`
    });
  }

  return badges;
}

/**
 * Thống kê chuyên sâu hồ sơ một thành viên (Player Profile Analytics)
 */
export function getPlayerDetailedStats(memberId, members, matches = []) {
  const member = members.find(m => m.id === memberId);
  if (!member) return null;

  const memberMap = new Map(members.map(m => [m.id, m]));
  const sortedByElo = [...members].sort((a, b) => b.elo - a.elo);
  const rank = sortedByElo.findIndex(m => m.id === memberId) + 1;
  const tier = getTierByElo(member.elo);
  const nextTier = getNextTier(member.elo);
  const winRate = member.matchesPlayed > 0 ? Math.round((member.wins / member.matchesPlayed) * 100) : 0;

  // 1. Phân tích bạn diễn ăn ý nhất (Best Partner)
  const partnerStats = {}; // { partnerId: { played: 0, won: 0 } }
  const personalMatches = [];

  matches.forEach(m => {
    const inTeam1 = m.team1.includes(memberId);
    const inTeam2 = m.team2.includes(memberId);

    if (inTeam1 || inTeam2) {
      const myTeam = inTeam1 ? m.team1 : m.team2;
      const oppTeam = inTeam1 ? m.team2 : m.team1;
      const myScore = inTeam1 ? m.score1 : m.score2;
      const oppScore = inTeam1 ? m.score2 : m.score1;
      const isWin = myScore > oppScore;

      const partnerId = myTeam.find(id => id !== memberId);
      if (partnerId) {
        if (!partnerStats[partnerId]) partnerStats[partnerId] = { played: 0, won: 0 };
        partnerStats[partnerId].played++;
        if (isWin) partnerStats[partnerId].won++;
      }

      let myEloDelta;
      if (inTeam1 && m.deltaTeam1 !== undefined) {
        myEloDelta = Number(m.deltaTeam1);
      } else if (inTeam2 && m.deltaTeam2 !== undefined) {
        myEloDelta = Number(m.deltaTeam2);
      } else {
        const baseChange = Number(m.eloChange) || 16;
        myEloDelta = isWin ? baseChange : -Math.max(1, Math.round(baseChange * 0.8));
      }

      personalMatches.push({
        id: m.id,
        timestamp: m.timestamp,
        courtNumber: m.courtNumber || 'Sân 1',
        isWin,
        partner: partnerId ? memberMap.get(partnerId) : null,
        opponents: oppTeam.map(id => memberMap.get(id)).filter(Boolean),
        myScore,
        oppScore,
        eloDelta: myEloDelta,
        isDeuce: m.isDeuce
      });
    }
  });

  // Tìm Best Partner
  let bestPartner = null;
  let maxPartnerWins = 0;
  let bestPartnerRate = 0;

  Object.entries(partnerStats).forEach(([pId, stat]) => {
    const partner = memberMap.get(pId);
    if (partner && stat.played >= 1) {
      const rate = stat.won / stat.played;
      if (stat.won > maxPartnerWins || (stat.won === maxPartnerWins && rate > bestPartnerRate)) {
        maxPartnerWins = stat.won;
        bestPartnerRate = rate;
        bestPartner = {
          player: partner,
          played: stat.played,
          won: stat.won,
          rate: Math.round(rate * 100)
        };
      }
    }
  });

  return {
    member,
    rank,
    tier,
    nextTier,
    winRate,
    bestPartner,
    personalMatches: personalMatches.slice(0, 15) // 15 trận gần nhất
  };
}

