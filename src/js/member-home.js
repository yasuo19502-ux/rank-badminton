// Presentation only: all figures come from existing records; no writes or recalculation.
import {escapeHtml} from './html.js';
import {renderAvatarHtml} from './avatar.js';
import {getTierByElo} from './elo.js';
import {getMatchPlayerDelta} from './match-record.js';

const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa rõ ngày' : date.toLocaleDateString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit'});
};
const action = (id, icon, label, detail='') => `<button class="member-action" data-member-action="${id}"><span class="member-action-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong>${detail?`<small>${escapeHtml(detail)}</small>`:''}</span><span class="action-arrow" aria-hidden="true">↗</span></button>`;

export function countMatchesOnDay(matches,day) {
  const start=Date.parse(day+'T00:00:00+07:00'),end=start+86400000;
  return matches.filter(m=>{const stamp=typeof m.timestamp==='number'||/^\d+$/.test(String(m.timestamp))?Number(m.timestamp):Date.parse(m.timestamp);return stamp>=start&&stamp<end;}).length;
}

export function getUpcomingSessions(sessions,today) {
  return sessions.filter(s=>s.date>=today).sort((a,b)=>(a.date+(a.startTime||'')).localeCompare(b.date+(b.startTime||'')));
}
export function renderUpcomingCard(sessions,today,memberId) {
  const session=getUpcomingSessions(sessions,today)[0];
  if(!session)return `<article class="upcoming-card"><div class="card-kicker">LỊCH SÂN</div><h3>Chưa có lịch sắp tới</h3><p>Lịch mới của CLB sẽ xuất hiện tại đây.</p><button class="text-action" data-section-link="sessions">Xem lịch sân →</button></article>`;
  const attending=Object.values(session.rsvps||{}).filter(v=>v==='attending').length;
  const status=memberId?session.rsvps?.[memberId]:null;
  return `<article class="upcoming-card"><div class="card-kicker">${session.date===today?'BUỔI ĐÁNH HÔM NAY':'BUỔI ĐÁNH SẮP TỚI'}</div><h3>${escapeHtml(session.title||'Buổi đánh CLB')}</h3><p class="upcoming-time">📅 ${dateLabel(session.date+'T12:00:00+07:00')}${session.startTime?' · '+escapeHtml(session.startTime):''}</p><p>📍 ${escapeHtml(session.venueName||'Địa điểm sẽ được cập nhật')}</p><div class="upcoming-footer"><span>${attending} người đăng ký${status==='attending'?' · Bạn đã tham gia':status==='maybe'?' · Bạn đang cân nhắc':''}</span><button class="text-action" data-section-link="sessions">Xem chi tiết →</button></div></article>`;
}

export function renderMemberHome({user,members,matches,inventory,sessions,today,isAdmin}) {
  const community=`<section class="member-community"><div class="panel-heading"><h3>Cùng CLB</h3></div><div class="member-action-grid">${action('members','👥','Thành viên','Tìm bạn chơi, xem hồ sơ')}${action('history','📜','Lịch sử trận','Kết quả và biến động Elo')}${action('fund','🤝','Quỹ CLB','Thông tin góp quỹ sân và cầu')}${action('shop','🛍️','Cửa hàng','Đổi xu lấy vật phẩm')}</div></section>`;
  if(!user)return `<div class="member-home-grid"><article class="member-welcome"><span class="welcome-mark" aria-hidden="true">🏸</span><p class="eyebrow">CHÀO BẠN ĐẾN VỚI CLB</p><h3>Một chỗ cho mọi thông tin của bạn.</h3><p>Đăng nhập để xem Elo, ví xu, khiên bảo vệ và các trận đã chơi.</p><div class="welcome-actions"><button class="btn-primary" data-member-action="login">Đăng nhập bằng PIN</button><button class="btn-secondary" data-member-action="register">Tôi là thành viên mới</button></div></article>${renderUpcomingCard(sessions,today)}</div>${community}`;
  const tier=getTierByElo(user.elo);
  const ranking=[...members].sort((a,b)=>b.elo-a.elo||a.id.localeCompare(b.id));
  const rank=ranking.findIndex(m=>m.id===user.id)+1;
  const shields=inventory.filter(i=>i.itemId==='elo_shield').reduce((n,i)=>n+Math.max(0,Number(i.quantity)||0),0);
  const active=!!user.activeEloShield&&shields>0;
  const myMatches=matches.filter(m=>m.team1.includes(user.id)||m.team2.includes(user.id)).sort((a,b)=>b.timestamp-a.timestamp).slice(0,3);
  const recent=myMatches.length?myMatches.map(m=>{
    const onTeam1=m.team1.includes(user.id),won=onTeam1===(m.score1>m.score2),delta=getMatchPlayerDelta(m,user.id);
    const shield=m.playerResults?.[user.id]?.shieldUsed;
    return `<button class="member-match" data-member-action="profile"><span class="match-outcome ${won?'is-win':'is-loss'}">${won?'Thắng':'Thua'}</span><span class="member-match-info"><strong>${m.score1} – ${m.score2}</strong><small>${dateLabel(m.timestamp)} · ${escapeHtml(m.courtNumber||'Sân CLB')}${shield?' · Đã dùng khiên':''}</small></span><span class="member-match-delta ${delta>0?'is-gain':delta<0?'is-loss':''}">${delta>0?'+':''}${delta} <small>Elo</small></span></button>`;
  }).join(''):`<div class="member-empty">Chưa có trận nào. Hẹn gặp bạn trên sân!</div>`;
  return `<article class="member-hero"><div class="member-identity">${renderAvatarHtml(user,{size:'lg'})}<div><p class="eyebrow">${isAdmin?'QUẢN TRỊ VIÊN':'THÀNH VIÊN CLB'}</p><h3>${escapeHtml(user.name)}</h3><p>${escapeHtml(user.nickname||tier.name)}</p></div></div><button class="btn-secondary" data-member-action="edit">Sửa hồ sơ</button></article>
  <div class="member-metrics"><div><span>Điểm Elo</span><strong>${user.elo}</strong><small>${escapeHtml(tier.name)}</small></div><div><span>Hạng CLB</span><strong>#${rank}</strong><small>Trong ${members.length} thành viên</small></div><button data-member-action="wallet"><span>Ví xu</span><strong>${Number(user.coins??0).toLocaleString('vi-VN')} <em>xu</em></strong><small>Xem thu chi →</small></button><div><span>Trận đã chơi</span><strong>${Number(user.matchesPlayed)||0}</strong><small>${Number(user.wins)||0} thắng · ${Number(user.losses)||0} thua</small></div></div>
  <div class="member-home-grid"><section class="member-main-column"><div class="member-action-grid">${action('wallet','🪙','Ví & giao dịch','Theo dõi các khoản cộng, trừ')}${action('inventory','🎒','Túi đồ','Khung, khiên và cuốn cán')}</div><article class="member-shield ${active?'shield-on':''}"><span class="shield-symbol" aria-hidden="true">🛡️</span><div><h3>Khiên bảo vệ ${active?'đang bật':'đang tắt'}</h3><p>${shields} thẻ trong túi · ${active?'Thua giảm 50% điểm trừ; mỗi trận dùng 1 thẻ dù thắng hay thua.':'Quản lý trạng thái trong túi đồ.'}</p></div><button class="text-action" data-member-action="inventory">Quản lý →</button></article><section class="member-recent"><div class="panel-heading"><h3>Trận gần đây của bạn</h3><button class="text-action" data-member-action="profile">Xem hồ sơ →</button></div>${recent}</section></section>${renderUpcomingCard(sessions,today,user.id)}</div>
  ${community}<div class="member-account-actions">${isAdmin?'<button class="btn-secondary" data-member-action="admin">⚙️ Quản lý CLB</button>':''}<button class="text-action" data-member-action="logout">Đăng xuất</button></div>`;
}
