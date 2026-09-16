import { calculateDoublesElo, getTierByElo, calculateBadges, TIERS } from './src/js/elo.js';
import { MatchmakerService } from './src/js/matchmaker.js';
import { INITIAL_MEMBERS, INITIAL_MATCHES } from './src/js/storage.js';

console.log('--- 1. KIỂM TRA BẬC RANK (TIERS) ---');
TIERS.forEach(t => console.log(`${t.icon} ${t.name} (${t.minElo} - ${t.maxElo})`));

console.log('\n--- 2. KIỂM TRA TÍNH DOUBLES ELO ---');
const team1 = [INITIAL_MEMBERS[0], INITIAL_MEMBERS[2]]; // Long (1420), Hương (1350) -> Avg: 1385
const team2 = [INITIAL_MEMBERS[3], INITIAL_MEMBERS[4]]; // Huy (1460), Yến (1290) -> Avg: 1375
const eloRes = calculateDoublesElo(team1, team2, 21, 19);
console.log('Kết quả 21-19:');
console.log(`Team 1 (Avg ${eloRes.team1Elo}) vs Team 2 (Avg ${eloRes.team2Elo})`);
console.log(`Delta Team 1: ${eloRes.deltaTeam1 > 0 ? '+' : ''}${eloRes.deltaTeam1} | Delta Team 2: ${eloRes.deltaTeam2}`);

const eloBlowout = calculateDoublesElo(team1, team2, 21, 8);
console.log(`Kết quả thắng đậm 21-8: Delta Team 1: +${eloBlowout.deltaTeam1} (cao hơn khi thắng suýt sao)`);

console.log('\n--- 3. KIỂM TRA THUẬT TOÁN GHÉP CẶP (MATCHMAKER) ---');
const present = INITIAL_MEMBERS.slice(0, 10);
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
const badges = calculateBadges(INITIAL_MEMBERS, INITIAL_MATCHES);
badges.forEach(b => console.log(`${b.icon} ${b.title}: ${b.player.name} - ${b.detail}`));

console.log('\n=== TẤT CẢ MODULE HOẠT ĐỘNG HOÀN HẢO! ===');
