// Dữ liệu kiểm toán đi cùng bản ghi trận, tương thích database cũ chỉ có court_number.
const AUDIT_MARKER = '|audit_v1:';

export function getMatchTeamDeltas(match) {
  const change = Number(match.eloChange ?? 16);
  const loss = String(match.id || '').startsWith('match_zs_')
    ? change : Math.max(1, Math.round(change * 0.8));
  const won = Number(match.score1) > Number(match.score2);
  return {
    deltaTeam1: Number(match.deltaTeam1 ?? (won ? change : -loss)) || 0,
    deltaTeam2: Number(match.deltaTeam2 ?? (won ? -loss : change)) || 0
  };
}

export function getMatchPlayerDelta(match, memberId) {
  const recorded = match.playerResults?.[memberId]?.eloDelta;
  if (recorded !== undefined && Number.isFinite(Number(recorded))) return Number(recorded);
  const deltas = getMatchTeamDeltas(match);
  return match.team1.includes(memberId) ? deltas.deltaTeam1 : deltas.deltaTeam2;
}

export function encodeMatchCourt(match) {
  const base = (match.courtNumber || 'Sân 1').split(AUDIT_MARKER)[0].split('|ref:')[0];
  const referee = match.refereeId || match.refereeName
    ? `|ref:${match.refereeId || ''}|${match.refereeName || ''}` : '';
  const audit = match.playerResults ? AUDIT_MARKER + encodeURIComponent(JSON.stringify({
    deltaTeam1: match.deltaTeam1,
    deltaTeam2: match.deltaTeam2,
    playerResults: match.playerResults
  })) : '';
  return base + referee + audit;
}

export function decodeMatchCourt(value = '') {
  const [courtAndRef, encodedAudit] = value.split(AUDIT_MARKER);
  const [courtNumber, referee] = courtAndRef.split('|ref:');
  const [refereeId, refereeName] = (referee || '').split('|');
  let audit = {};
  try {
    const parsed = JSON.parse(decodeURIComponent(encodedAudit || ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      audit = { deltaTeam1: parsed.deltaTeam1, deltaTeam2: parsed.deltaTeam2, playerResults: parsed.playerResults };
    }
  } catch { /* Bản ghi cũ hoặc metadata hỏng vẫn hiển thị được trận. */ }
  return { courtNumber, refereeId: refereeId || null, refereeName: refereeName || null, ...audit };
}
