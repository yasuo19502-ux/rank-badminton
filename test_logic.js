import { calculateDoublesElo, getTierByElo, calculateBadges, TIERS } from './src/js/elo.js';
import { MatchmakerService } from './src/js/matchmaker.js';
import { INITIAL_MEMBERS, INITIAL_MATCHES } from './src/js/storage.js';

console.log('--- 1. KIỂM TRA BẬC RANK (TIERS) ---');
TIERS.forEach(t => console.log(`${t.icon} ${t.name} (${t.minElo} - ${t.maxElo})`));

const mockMembers = INITIAL_MEMBERS.length >= 5 ? INITIAL_MEMBERS : [
  { id: '1', name: 'Long', elo: 1420, gender: 'male', matchesPlayed: 10, wins: 8 },
  { id: '2', name: 'Nam', elo: 1300, gender: 'male', matchesPlayed: 5, wins: 3 },
  { id: '3', name: 'Hương', elo: 1350, gender: 'female', matchesPlayed: 8, wins: 6 },
  { id: '4', name: 'Huy', elo: 1460, gender: 'male', matchesPlayed: 12, wins: 9 },
  { id: '5', name: 'Yến', elo: 1290, gender: 'female', matchesPlayed: 6, wins: 3 },
  { id: '6', name: 'Tuấn', elo: 1250, gender: 'male', matchesPlayed: 4, wins: 2 },
  { id: '7', name: 'Mai', elo: 1310, gender: 'female', matchesPlayed: 7, wins: 4 },
  { id: '8', name: 'Đức', elo: 1400, gender: 'male', matchesPlayed: 9, wins: 6 },
  { id: '9', name: 'Linh', elo: 1220, gender: 'female', matchesPlayed: 5, wins: 2 },
  { id: '10', name: 'Phong', elo: 1380, gender: 'male', matchesPlayed: 11, wins: 7 }
];

console.log('\n--- 2. KIỂM TRA TÍNH DOUBLES ELO ---');
const team1 = [mockMembers[0], mockMembers[2]]; // Long (1420), Hương (1350) -> Avg: 1385
const team2 = [mockMembers[3], mockMembers[4]]; // Huy (1460), Yến (1290) -> Avg: 1375
const eloRes = calculateDoublesElo(team1, team2, 21, 19);
console.log('Kết quả 21-19:');
console.log(`Team 1 (Avg ${eloRes.team1Elo}) vs Team 2 (Avg ${eloRes.team2Elo})`);
console.log(`Delta Team 1: ${eloRes.deltaTeam1 > 0 ? '+' : ''}${eloRes.deltaTeam1} | Delta Team 2: ${eloRes.deltaTeam2}`);
if (eloRes.deltaTeam1 !== -eloRes.deltaTeam2) {
  throw new Error('Elo không zero-sum: điểm đội thắng và đội thua phải cân bằng tuyệt đối');
}

const eloBlowout = calculateDoublesElo(team1, team2, 21, 8);
console.log(`Kết quả thắng đậm 21-8: Delta Team 1: +${eloBlowout.deltaTeam1} (cao hơn khi thắng suýt sao)`);
if (eloBlowout.deltaTeam1 !== -eloBlowout.deltaTeam2) {
  throw new Error('Elo trận thắng đậm không zero-sum');
}

const floorTeam = [
  { id: 'floor_1', elo: 500, matchesPlayed: 30 },
  { id: 'floor_2', elo: 500, matchesPlayed: 30 }
];
const floorRes = calculateDoublesElo(team1, floorTeam, 21, 19);
if (floorRes.deltaTeam1 !== 0 || floorRes.deltaTeam2 !== 0) {
  throw new Error('Elo tại sàn 500 phải giữ zero-sum và không tạo thêm điểm');
}

console.log('\n--- 3. KIỂM TRA THUẬT TOÁN GHÉP CẶP (MATCHMAKER) ---');
const present = mockMembers.slice(0, 10);
const balancedMatch = MatchmakerService.createMatch(present, {}, 'balanced');
console.log('Trận Cân Kèo:');
console.log(`Đội 1: ${balancedMatch.team1[0].name} & ${balancedMatch.team1[1].name}`);
console.log(`Đội 2: ${balancedMatch.team2[0].name} & ${balancedMatch.team2[1].name}`);
console.log(`Chênh lệch Elo: ${balancedMatch.diffElo} điểm (Cực kỳ cân kèo)`);

const mixedMatch = MatchmakerService.createMatch(present, {}, 'mixed');
console.log('\nTrận Đôi Nam Nữ:');
console.log(`Đội 1: ${mixedMatch.team1[0].name} (${mixedMatch.team1[0].gender}) & ${mixedMatch.team1[1].name} (${mixedMatch.team1[1].gender})`);
console.log(`Đội 2: ${mixedMatch.team2[0].name} (${mixedMatch.team2[0].gender}) & ${mixedMatch.team2[1].name} (${mixedMatch.team2[1].gender})`);

console.log('\n--- 4. KIỂM TRA VINH DANH (BADGES) ---');
const badges = calculateBadges(mockMembers, INITIAL_MATCHES);
badges.forEach(b => console.log(`${b.icon} ${b.title}: ${b.player.name} - ${b.detail}`));

console.log('\n=== TẤT CẢ MODULE HOẠT ĐỘNG HOÀN HẢO! ===');
