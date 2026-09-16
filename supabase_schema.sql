-- ====================================================================
-- SCHEMA DATABASE SUPABASE CHO CLB CẦU LÔNG THÁI THỊNH (PHIÊN BẢN ĐỒNG BỘ WEB TOÀN DIỆN)
-- Dự án: CLB Cầu Lông Thái Thịnh (URL: https://sfdtqtdjxnkkgjimnliz.supabase.co)
-- Cách chạy: Đăng nhập Supabase -> Chọn Project -> Vào "SQL Editor" -> Dán toàn bộ mã này vào và bấm "RUN".
-- ====================================================================

-- Kích hoạt extension hỗ trợ nếu cần
create extension if not exists "uuid-ossp";

-- ====================================================================
-- 1. BẢNG THÀNH VIÊN & VẬN ĐỘNG VIÊN (MEMBERS)
-- Phân tách riêng: quản lý hồ sơ, điểm Elo, thứ hạng, thống kê và ảnh đại diện
-- ====================================================================
create table if not exists public.members (
    id text primary key,
    name text not null,
    nickname text default '',
    gender text default 'male' check (gender in ('male', 'female')),
    frequency text default 'regular' check (frequency in ('regular', 'occasional')),
    elo integer default 1000 check (elo >= 0),
    matches_played integer default 0 check (matches_played >= 0),
    wins integer default 0 check (wins >= 0),
    losses integer default 0 check (losses >= 0),
    streak integer default 0,
    avatar text default '',
    phone text default '',
    joined_date text,
    created_at timestamp with time zone default timezone('utc'::text, now()),
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Index tối ưu tốc độ tải và xếp thứ hạng bảng xếp hạng Elo
create index if not exists idx_members_elo on public.members (elo desc);
create index if not exists idx_members_frequency on public.members (frequency);

-- ====================================================================
-- 2. BẢNG LỊCH BUỔI ĐÁNH & THÔNG TIN SÂN (SESSIONS)
-- Phân tách riêng: quản lý lịch tập, sân đấu, giờ giấc, đăng ký RSVP
-- ====================================================================
create table if not exists public.sessions (
    id text primary key,
    title text not null,
    date text not null, -- Định dạng YYYY-MM-DD
    start_time text default '', -- Ví dụ: '19:00'
    end_time text default '',   -- Ví dụ: '21:00'
    venue_name text default '', -- Tên sân: Sân Cầu Lông Thái Thịnh
    venue_address text default '', -- Địa chỉ: Số 123 Thái Thịnh, Đống Đa, Hà Nội
    court_numbers text default '', -- Sân thuê: Sân 1, Sân 2
    fee_note text default '', -- Ghi chú tiền sân/cầu
    rsvps jsonb default '{}'::jsonb, -- Danh sách đăng ký: { "member_id": "attending" | "maybe" | "declined" }
    created_at timestamp with time zone default timezone('utc'::text, now()),
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Index tìm kiếm buổi đánh theo ngày
create index if not exists idx_sessions_date on public.sessions (date desc);

-- ====================================================================
-- 3. BẢNG LỊCH SỬ TRẬN ĐẤU & BIẾN ĐỘNG ELO (MATCHES)
-- Phân tách riêng: lưu trữ chi tiết từng trận, liên kết khóa ngoại với buổi đánh
-- ====================================================================
create table if not exists public.matches (
    id text primary key,
    session_id text references public.sessions(id) on delete set null,
    timestamp bigint not null,
    court_number text default 'Sân 1',
    team1 text[] not null, -- Mảng 2 ID thành viên đội 1
    team2 text[] not null, -- Mảng 2 ID thành viên đội 2
    score1 integer not null check (score1 >= 0),
    score2 integer not null check (score2 >= 0),
    elo_change integer default 16,
    is_deuce boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Index truy vấn lịch sử trận đấu theo thời gian và theo buổi đánh
create index if not exists idx_matches_timestamp on public.matches (timestamp desc);
create index if not exists idx_matches_session_id on public.matches (session_id);

-- ====================================================================
-- 4. BẢNG ĐIỂM DANH BUỔI ĐÁNH HÀNG NGÀY (ATTENDANCE)
-- Phân tách riêng: theo dõi ai có mặt tại sân hôm nay, số trận đã đánh hôm nay
-- ====================================================================
create table if not exists public.attendance (
    date text primary key, -- 'YYYY-MM-DD'
    session_id text references public.sessions(id) on delete set null,
    present_ids text[] default '{}',
    games_played_today jsonb default '{}'::jsonb, -- { "member_id": 3 }
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ====================================================================
-- 5. BẢNG TRẬN ĐẤU ĐANG DIỄN RA TRÊN SÂN (LIVE_COURT)
-- BẢNG CỐT LÕI ĐỒNG BỘ REALTIME WEB ĐA THIẾT BỊ:
-- Khi trọng tài hoặc người đánh ghi điểm trên điện thoại ở sân, 
-- tất cả người khác mở web trên điện thoại/laptop sẽ thấy tỷ số nhảy trực tiếp!
-- ====================================================================
create table if not exists public.live_court (
    id text primary key default 'current_court',
    court_number text default 'Sân 1',
    team1 text[] default '{}', -- ID 2 vận động viên đội 1
    team2 text[] default '{}', -- ID 2 vận động viên đội 2
    score1 integer default 0 check (score1 >= 0),
    score2 integer default 0 check (score2 >= 0),
    matchmaker_mode text default 'balanced', -- 'balanced' | 'random' | 'king' | 'mixed'
    status text default 'in_progress', -- 'in_progress' | 'finished' | 'idle'
    diff_elo integer default 0,
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ====================================================================
-- 6. BẢNG CẤU HÌNH VÀ THÔNG BÁO CHUNG CÂU LẠC BỘ (CLUB_SETTINGS)
-- Phân tách riêng: quản lý tên CLB, thông báo dán bảng tin, sân mặc định, hệ số K
-- ====================================================================
create table if not exists public.club_settings (
    id text primary key default 'thai_thinh',
    club_name text default 'CLB Cầu Lông Thái Thịnh',
    announcement text default '',
    default_venue text default 'Sân Cầu Lông Thái Thịnh',
    default_address text default 'Số 123 Thái Thịnh, Đống Đa, Hà Nội',
    k_factor integer default 32,
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- ====================================================================
-- TỰ ĐỘNG CẬP NHẬT CỘT UPDATED_AT BẰNG TRIGGER TRÊN POSTGRESQL
-- ====================================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_members on public.members;
create trigger set_updated_at_members
before update on public.members
for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_sessions on public.sessions;
create trigger set_updated_at_sessions
before update on public.sessions
for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_attendance on public.attendance;
create trigger set_updated_at_attendance
before update on public.attendance
for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_live_court on public.live_court;
create trigger set_updated_at_live_court
before update on public.live_court
for each row execute function public.handle_updated_at();

drop trigger if exists set_updated_at_club_settings on public.club_settings;
create trigger set_updated_at_club_settings
before update on public.club_settings
for each row execute function public.handle_updated_at();

-- ====================================================================
-- VIEW THỐNG KÊ NHANH CHO BẢNG XẾP HẠNG (LEADERBOARD_VIEW)
-- ====================================================================
create or replace view public.leaderboard_view as
select 
    id,
    name,
    nickname,
    gender,
    frequency,
    elo,
    matches_played,
    wins,
    losses,
    case 
        when matches_played > 0 then round((wins::numeric / matches_played::numeric) * 100, 1)
        else 0
    end as win_rate,
    streak,
    avatar,
    phone,
    joined_date
from public.members
order by elo desc;

-- ====================================================================
-- CẤU HÌNH ROW LEVEL SECURITY (RLS) - CHO PHÉP CLB TRUY CẬP ĐẦY ĐỦ TRÊN WEB
-- ====================================================================
alter table public.members enable row level security;
alter table public.sessions enable row level security;
alter table public.matches enable row level security;
alter table public.attendance enable row level security;
alter table public.live_court enable row level security;
alter table public.club_settings enable row level security;

-- Policies cho members
drop policy if exists "members_all_access" on public.members;
create policy "members_all_access" on public.members for all using (true) with check (true);

-- Policies cho sessions
drop policy if exists "sessions_all_access" on public.sessions;
create policy "sessions_all_access" on public.sessions for all using (true) with check (true);

-- Policies cho matches
drop policy if exists "matches_all_access" on public.matches;
create policy "matches_all_access" on public.matches for all using (true) with check (true);

-- Policies cho attendance
drop policy if exists "attendance_all_access" on public.attendance;
create policy "attendance_all_access" on public.attendance for all using (true) with check (true);

-- Policies cho live_court
drop policy if exists "live_court_all_access" on public.live_court;
create policy "live_court_all_access" on public.live_court for all using (true) with check (true);

-- Policies cho club_settings
drop policy if exists "club_settings_all_access" on public.club_settings;
create policy "club_settings_all_access" on public.club_settings for all using (true) with check (true);

-- ====================================================================
-- CẤU HÌNH REPLICA IDENTITY FULL (ĐẢM BẢO REALTIME GỬI TOÀN BỘ DATA DÒNG)
-- ====================================================================
alter table public.members replica identity full;
alter table public.sessions replica identity full;
alter table public.matches replica identity full;
alter table public.attendance replica identity full;
alter table public.live_court replica identity full;
alter table public.club_settings replica identity full;

-- ====================================================================
-- BẬT SUPABASE REALTIME (TỰ ĐỘNG PHÁT SỰ KIỆN TỚI MỌI TRÌNH DUYỆT WEB)
-- ====================================================================
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.attendance;
alter publication supabase_realtime add table public.live_court;
alter publication supabase_realtime add table public.club_settings;

-- ====================================================================
-- CƠ SỞ DỮ LIỆU SẠCH 100% (KHÔNG CÓ THÀNH VIÊN GIẢ MẠO)
-- Toàn bộ bảng bắt đầu rỗng để người dùng tự thêm thành viên thật của CLB!
-- ====================================================================
