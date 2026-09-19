/**
 * matchmaker.js - Thuật toán ghép trận thông minh & vui nhộn cho CLB Thái Thịnh
 */

export const MatchmakerService = {
  /**
   * Tạo trận đấu mới theo chế độ
   * @param {Array<Object>} presentMembers - Danh sách thành viên có mặt hôm nay
   * @param {Object} gamesPlayedToday - Số trận từng người đã chơi hôm nay { [id]: count }
   * @param {string} mode - 'balanced' | 'mixed' | 'random'
   * @param {Array<string>} excludeIds - ID người đang trên sân (nếu có nhiều sân)
   * @returns {Object} { team1: [p1, p2], team2: [p3, p4], mode, diffElo }
   */
  createMatch(presentMembers, gamesPlayedToday = {}, mode = 'balanced', excludeIds = []) {
    // Lọc những người có mặt và chưa bị exclude
    const available = presentMembers.filter(m => !excludeIds.includes(m.id));

    if (available.length < 4) {
      throw new Error(`Cần tối thiểu 4 người có mặt để xếp trận (hiện có ${available.length} người sẵn sàng)`);
    }

    if (mode === 'mixed') {
      return this._createMixedMatch(available, gamesPlayedToday);
    } else if (mode === 'random') {
      return this._createRandomMatch(available);
    } else {
      // Default: 'balanced' (Cân kèo tự động + ưu tiên người ít trận)
      return this._createBalancedMatch(available, gamesPlayedToday);
    }
  },

  /**
   * Chế độ 1: Cân kèo tự động (Auto-Balance)
   * 1. Ưu tiên 4 người chơi ít trận nhất hôm nay
   * 2. Trong 4 người, thử 3 cách chia đôi: (1,2) vs (3,4), (1,3) vs (2,4), (1,4) vs (2,3)
   * 3. Chọn cặp có chênh lệch tổng Elo nhỏ nhất!
   */
  _createBalancedMatch(available, gamesPlayedToday) {
    // Sắp xếp người theo:
    // 1. Số trận hôm nay (tăng dần - ai ít trận được ưu tiên)
    // 2. Phân định bằng số ngẫu nhiên chuẩn xác (tránh sort không ổn định)
    const pool = available.map(p => ({
      player: p,
      games: gamesPlayedToday[p.id] || 0,
      rand: Math.random()
    })).sort((a, b) => {
      if (a.games !== b.games) return a.games - b.games;
      return a.rand - b.rand;
    });

    // Lấy 4 người đầu tiên
    const players = pool.slice(0, 4).map(item => item.player);

    // Thử 3 cách chia đội
    const pairings = [
      { team1: [players[0], players[1]], team2: [players[2], players[3]] },
      { team1: [players[0], players[2]], team2: [players[1], players[3]] },
      { team1: [players[0], players[3]], team2: [players[1], players[2]] }
    ];

    const evaluatedPairings = pairings.map(p => {
      const elo1 = (p.team1[0].elo + p.team1[1].elo) / 2;
      const elo2 = (p.team2[0].elo + p.team2[1].elo) / 2;
      return {
        ...p,
        diff: Math.abs(elo1 - elo2)
      };
    }).sort((a, b) => a.diff - b.diff);

    const minDiff = evaluatedPairings[0].diff;
    // Lấy các cách ghép có độ cân tương đương (chênh lệch không quá 25 Elo so với tối ưu)
    const balancedOptions = evaluatedPairings.filter(p => p.diff <= minDiff + 25);
    // Chọn ngẫu nhiên trong các phương án cân kèo để đa dạng hoá cặp đấu
    const bestPairing = balancedOptions[Math.floor(Math.random() * balancedOptions.length)];

    return {
      team1: bestPairing.team1,
      team2: bestPairing.team2,
      mode: 'balanced',
      diffElo: Math.round(bestPairing.diff),
      allSelected: players
    };
  },

  /**
   * Chế độ 2: Đôi Nam Nữ (Mixed Doubles)
   * Chọn 2 nam và 2 nữ (ưu tiên người ít trận), ghép mỗi đội 1 Nam + 1 Nữ sao cho cân Elo
   */
  _createMixedMatch(available, gamesPlayedToday) {
    const males = available.filter(m => m.gender === 'male');
    const females = available.filter(m => m.gender === 'female');

    if (males.length < 2 || females.length < 2) {
      throw new Error(`Cần tối thiểu 2 Nam và 2 Nữ để đánh Đôi Nam Nữ (hiện có ${males.length} Nam, ${females.length} Nữ)`);
    }

    const sortWithRand = (list) => {
      return list.map(p => ({
        player: p,
        games: gamesPlayedToday[p.id] || 0,
        rand: Math.random()
      })).sort((a, b) => {
        if (a.games !== b.games) return a.games - b.games;
        return a.rand - b.rand;
      }).map(item => item.player);
    };

    const sortedMales = sortWithRand(males);
    const sortedFemales = sortWithRand(females);

    const m1 = sortedMales[0];
    const m2 = sortedMales[1];
    const f1 = sortedFemales[0];
    const f2 = sortedFemales[1];

    // Có 2 cách ghép: (m1, f1) vs (m2, f2) hoặc (m1, f2) vs (m2, f1)
    const diff1 = Math.abs((m1.elo + f1.elo) / 2 - (m2.elo + f2.elo) / 2);
    const diff2 = Math.abs((m1.elo + f2.elo) / 2 - (m2.elo + f1.elo) / 2);

    let team1, team2, chosenDiff;
    if (Math.abs(diff1 - diff2) <= 25) {
      // Nếu 2 phương án đều cân kèo, ngẫu nhiên chọn để đổi bạn cặp
      if (Math.random() < 0.5) {
        team1 = [m1, f1]; team2 = [m2, f2]; chosenDiff = diff1;
      } else {
        team1 = [m1, f2]; team2 = [m2, f1]; chosenDiff = diff2;
      }
    } else if (diff1 <= diff2) {
      team1 = [m1, f1]; team2 = [m2, f2]; chosenDiff = diff1;
    } else {
      team1 = [m1, f2]; team2 = [m2, f1]; chosenDiff = diff2;
    }

    return {
      team1,
      team2,
      mode: 'mixed',
      diffElo: Math.round(chosenDiff),
      allSelected: [m1, m2, f1, f2]
    };
  },

  /**
   * Chế độ 3: Xốc đĩa / Vòng quay may mắn (Pure Random)
   * Bốc 4 người hoàn toàn ngẫu nhiên và xếp ngẫu nhiên để tấu hài
   */
  _createRandomMatch(available) {
    const pool = available.map(p => ({ player: p, rand: Math.random() })).sort((a, b) => a.rand - b.rand);
    const players = pool.slice(0, 4).map(item => item.player);

    const team1 = [players[0], players[1]];
    const team2 = [players[2], players[3]];
    const elo1 = (team1[0].elo + team1[1].elo) / 2;
    const elo2 = (team2[0].elo + team2[1].elo) / 2;

    return {
      team1,
      team2,
      mode: 'random',
      diffElo: Math.round(Math.abs(elo1 - elo2)),
      allSelected: players
    };
  },

  /**
   * Đổi chỗ người chơi giữa 2 đội (Swap manual)
   */
  swapPlayers(team1, team2, playerIndexTeam1, playerIndexTeam2) {
    const newTeam1 = [...team1];
    const newTeam2 = [...team2];

    const temp = newTeam1[playerIndexTeam1];
    newTeam1[playerIndexTeam1] = newTeam2[playerIndexTeam2];
    newTeam2[playerIndexTeam2] = temp;

    const elo1 = (newTeam1[0].elo + newTeam1[1].elo) / 2;
    const elo2 = (newTeam2[0].elo + newTeam2[1].elo) / 2;

    return {
      team1: newTeam1,
      team2: newTeam2,
      diffElo: Math.round(Math.abs(elo1 - elo2))
    };
  }
};
