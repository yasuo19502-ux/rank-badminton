-- Additive upgrade. No UPDATE/DELETE/backfill of existing club records.
begin;
-- Verify all existing public records inside the same transaction. A difference
-- aborts the entire upgrade instead of accepting an unintended data change.
create temporary table club_v3_preservation(table_name text primary key,rows_count bigint,digest text) on commit drop;
do $$ declare t text; n bigint; h text; begin
  foreach t in array array['members','matches','bets','coin_transactions','user_inventory','live_court','attendance','sessions','club_settings'] loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)::text) from public.%I r',t) into n,h;
    insert into club_v3_preservation values(t,n,h);
  end loop;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists club_private;
revoke all on schema club_private from public,anon,authenticated;
create table if not exists club_private.credentials (
  member_id text primary key references public.members(id) on delete cascade,
  pin_hash text, attempts integer not null default 0, locked_until timestamptz
);
create table if not exists club_private.sessions (
  token_hash bytea primary key, member_id text not null references public.members(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists club_private.operations (
  id text primary key, actor text not null, kind text not null, arguments jsonb not null,
  result jsonb, created_at timestamptz not null default clock_timestamp()
);
revoke all on all tables in schema club_private from public,anon,authenticated;

create or replace function club_private.pin_hash(pin text, previous text default null) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare ns text; answer text;
begin
  select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if previous is null then execute format('select %I.crypt($1,%I.gen_salt(''bf'',10))',ns,ns) into answer using pin;
  else execute format('select %I.crypt($1,$2)',ns) into answer using pin,previous; end if;
  return answer;
end $$;
create or replace function club_private.actor(target text default null, admin_only boolean default false) returns text
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare token text; who text;
begin
  token:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-club-session';
  select member_id into who from club_private.sessions where token_hash=sha256(convert_to(token,'UTF8')) and expires_at>clock_timestamp();
  if who is null then raise exception 'Vui lòng đăng nhập lại để thực hiện thao tác.' using errcode='28000'; end if;
  if (admin_only or (target is not null and target<>who)) and who<>'mem_1789569517045' then
    raise exception 'Bạn không có quyền thực hiện thao tác này.' using errcode='42501';
  end if;
  return who;
end $$;
create or replace function public.club_login(p_member_id text,p_pin text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare m public.members; c club_private.credentials; expected text; token text;
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then return jsonb_build_object('success',false,'message','Vui lòng nhập đúng 4 chữ số.'); end if;
  select * into m from public.members where id=p_member_id;
  if not found then return jsonb_build_object('success',false,'message','Tài khoản hoặc PIN không đúng.'); end if;
  insert into club_private.credentials(member_id) values(m.id) on conflict do nothing;
  select * into c from club_private.credentials where member_id=m.id for update;
  if c.locked_until>clock_timestamp() then return jsonb_build_object('success',false,'message','Đã nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.'); end if;
  expected:=coalesce(nullif(to_jsonb(m)->>'pin_code',''),public.club_meta(m.phone)->>'pinCode');
  if c.pin_hash is null and coalesce(expected,'')='' then
    return jsonb_build_object('success',false,'message','Tài khoản chưa có PIN. Nhờ quản trị viên thiết lập PIN trước.');
  end if;
  if (c.pin_hash is not null and club_private.pin_hash(p_pin,c.pin_hash)<>c.pin_hash)
    or (c.pin_hash is null and p_pin is distinct from expected) then
    update club_private.credentials set attempts=case when c.locked_until is not null then 1 else attempts+1 end,
      locked_until=case when (case when c.locked_until is not null then 1 else attempts+1 end)>=5 then clock_timestamp()+interval '15 minutes' else null end where member_id=m.id;
    return jsonb_build_object('success',false,'message','Tài khoản hoặc PIN không đúng.');
  end if;
  update club_private.credentials set pin_hash=coalesce(pin_hash,club_private.pin_hash(p_pin)),attempts=0,locked_until=null where member_id=m.id;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into club_private.sessions(token_hash,member_id,expires_at) values(sha256(convert_to(token,'UTF8')),m.id,clock_timestamp()+interval '7 days');
  return jsonb_build_object('success',true,'memberId',m.id,'token',token);
end $$;
create or replace function public.club_logout() returns void
language plpgsql security definer set search_path=pg_catalog,club_private as $$
declare token text;
begin
  token:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-club-session';
  delete from club_private.sessions where token_hash=sha256(convert_to(token,'UTF8'));
end $$;
create or replace function public.club_members_public() returns jsonb
language sql stable security definer set search_path=pg_catalog,public,club_private as $$
  select coalesce(jsonb_agg((to_jsonb(m)-'phone'-'pin_code')||jsonb_build_object(
    'active_frame',coalesce(to_jsonb(m)->>'active_frame',public.club_meta(m.phone)->>'activeFrame',''),
    'active_elo_shield',coalesce((to_jsonb(m)->>'active_elo_shield')::boolean,(public.club_meta(m.phone)->>'activeEloShield')::boolean,false),
    'has_pin',exists(select 1 from club_private.credentials c where c.member_id=m.id and c.pin_hash is not null)
      or coalesce(nullif(to_jsonb(m)->>'pin_code',''),public.club_meta(m.phone)->>'pinCode','')<>'',
    'role',case when m.id='mem_1789569517045' then 'admin' else 'member' end
  ) order by m.elo desc,m.id),'[]'::jsonb) from public.members m;
$$;
create or replace function public.club_patch_member(p_member_id text,p_patch jsonb,p_expected_updated_at text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare m public.members; meta jsonb; k text; who text; frame text; shield boolean;
begin
  who:=club_private.actor(p_member_id);
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'Thông tin không hợp lệ.'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name','nickname','gender','frequency','avatar','activeFrame','activeEloShield','pinCode','initialElo') then raise exception 'Không được thay đổi Elo, xu hoặc thống kê qua hồ sơ.'; end if;
  end loop;
  select * into strict m from public.members where id=p_member_id for update;
  if p_expected_updated_at is null or m.updated_at is distinct from p_expected_updated_at::timestamptz then raise exception 'Hồ sơ đã thay đổi. Vui lòng tải lại rồi thử lại.'; end if;
  if p_patch ? 'initialElo' then
    perform club_private.actor(null,true);
    if m.matches_played<>0 or coalesce((p_patch->>'initialElo')::integer,0) not between 500 and 3000 then raise exception 'Chỉ được chỉnh mốc khởi đầu trước trận đầu tiên.'; end if;
  end if;
  if p_patch ? 'name' and (length(btrim(coalesce(p_patch->>'name',''))) not between 1 and 100) then raise exception 'Tên phải có 1–100 ký tự.'; end if;
  if p_patch ? 'nickname' and length(p_patch->>'nickname')>100 then raise exception 'Biệt danh quá dài.'; end if;
  if p_patch ? 'gender' and coalesce(p_patch->>'gender','') not in ('male','female') then raise exception 'Giới tính không hợp lệ.'; end if;
  if p_patch ? 'frequency' and coalesce(p_patch->>'frequency','') not in ('regular','occasional') then raise exception 'Tần suất không hợp lệ.'; end if;
  meta:=public.club_meta(m.phone);
  if p_patch ? 'activeFrame' then
    frame:=coalesce(p_patch->>'activeFrame','');
    if frame<>'' and not exists(select 1 from public.user_inventory where member_id=m.id and item_id=frame and item_type='frame' and quantity>0) then raise exception 'Bạn chưa sở hữu khung này.'; end if;
    meta:=jsonb_set(meta,'{activeFrame}',to_jsonb(frame));
  end if;
  if p_patch ? 'activeEloShield' then
    shield:=(p_patch->>'activeEloShield')::boolean;
    if shield is null then raise exception 'Trạng thái khiên không hợp lệ.'; end if;
    if shield and not exists(select 1 from public.user_inventory where member_id=m.id and item_id='elo_shield' and quantity>0) then raise exception 'Bạn chưa có khiên bảo vệ.'; end if;
    meta:=jsonb_set(meta,'{activeEloShield}',to_jsonb(shield));
  end if;
  if p_patch ? 'pinCode' then
    if coalesce(p_patch->>'pinCode','') !~ '^\d{4}$' then raise exception 'PIN phải có đúng 4 chữ số.'; end if;
    insert into club_private.credentials(member_id,pin_hash) values(m.id,club_private.pin_hash(p_patch->>'pinCode'))
      on conflict(member_id) do update set pin_hash=excluded.pin_hash,attempts=0,locked_until=null;
    delete from club_private.sessions where member_id=m.id and token_hash<>sha256(convert_to(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-club-session','UTF8'));
  end if;
  update public.members set name=case when p_patch ? 'name' then btrim(p_patch->>'name') else name end,
    nickname=case when p_patch ? 'nickname' then p_patch->>'nickname' else nickname end,
    gender=case when p_patch ? 'gender' then p_patch->>'gender' else gender end,
    frequency=case when p_patch ? 'frequency' then p_patch->>'frequency' else frequency end,
    avatar=case when p_patch ? 'avatar' then p_patch->>'avatar' else avatar end,
    elo=case when p_patch ? 'initialElo' then (p_patch->>'initialElo')::integer else elo end,
    phone=case when p_patch ? 'activeFrame' or p_patch ? 'activeEloShield' then meta::text else phone end,updated_at=clock_timestamp() where id=m.id;
  if p_patch ? 'activeFrame' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_frame') then execute 'update public.members set active_frame=$1 where id=$2' using frame,m.id; end if;
  if p_patch ? 'activeEloShield' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_elo_shield') then execute 'update public.members set active_elo_shield=$1 where id=$2' using shield,m.id; end if;
  return jsonb_build_object('success',true);
end $$;

-- Keep existing implementations private; all new entry points enforce identity.
do $$ begin
  if to_regprocedure('club_private.buy_item(text,text,text)') is null then
    alter function public.club_buy_item(text,text,text) set schema club_private;
    alter function club_private.club_buy_item(text,text,text) rename to buy_item;
    alter function public.club_place_bet(text,text,text,text,text,integer,numeric) set schema club_private;
    alter function club_private.club_place_bet(text,text,text,text,text,integer,numeric) rename to place_bet;
    alter function public.club_save_court(jsonb,text) set schema club_private;
    alter function club_private.club_save_court(jsonb,text) rename to save_court;
  end if;
end $$;
create or replace function public.club_buy_item(p_id text,p_member_id text,p_item_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin perform club_private.actor(p_member_id); return club_private.buy_item(p_id,p_member_id,p_item_id); end $$;

create or replace function public.club_claim_grip(p_id text,p_member_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare inv public.user_inventory; who text; prior club_private.operations; answer jsonb;
begin
  who:=club_private.actor(p_member_id);
  if p_id is null or length(p_id)<12 then raise exception 'Mã nhận không hợp lệ.'; end if;
  perform 1 from public.members where id=p_member_id for update;
  select * into prior from club_private.operations where id=p_id;
  if found then
    if prior.actor<>who or prior.kind<>'claim_grip' or prior.arguments<>jsonb_build_object('member',p_member_id) then raise exception 'Mã thao tác không hợp lệ.'; end if;
    return prior.result;
  end if;
  select * into inv from public.user_inventory where member_id=p_member_id and item_id='grip' and quantity>0 order by id limit 1 for update;
  if not found then raise exception 'Bạn không có cuốn cán nào để nhận.'; end if;
  update public.user_inventory set quantity=quantity-1,updated_at=clock_timestamp() where id=inv.id;
  answer:=jsonb_build_object('success',true,'remaining',inv.quantity-1);
  insert into club_private.operations(id,actor,kind,arguments,result) values(p_id,who,'claim_grip',jsonb_build_object('member',p_member_id),answer);
  return answer;
end $$;

create or replace function public.club_save_court(p_payload jsonb,p_expected_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare c public.live_court; people text[]; same_lineup boolean;
begin
  perform club_private.actor();
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  if jsonb_typeof(p_payload->'team1') is distinct from 'array' or jsonb_typeof(p_payload->'team2') is distinct from 'array'
    or jsonb_array_length(p_payload->'team1')>2 or jsonb_array_length(p_payload->'team2')>2 then raise exception 'Mỗi đội chỉ có hai vị trí.'; end if;
  select * into c from public.live_court where id=p_payload->>'id' for update;
  people:=array(select jsonb_array_elements_text(coalesce(p_payload->'team1','[]')) union all select jsonb_array_elements_text(coalesce(p_payload->'team2','[]')));
  if (select count(*) from unnest(people) p where p<>'')<>(select count(distinct p) from unnest(people) p where p<>'') then raise exception 'Một người chỉ được ở một vị trí.'; end if;
  if exists(select 1 from public.live_court other where other.id<>p_payload->>'id' and other.team1||other.team2 && array_remove(people,'')) then raise exception 'Có người đang ở sân khác. Vui lòng tải lại.'; end if;
  if exists(select 1 from public.matches where id=p_payload->>'match_id') or exists(select 1 from public.live_court where id<>p_payload->>'id' and match_id=p_payload->>'match_id') then raise exception 'Mã trận đã được sử dụng. Vui lòng xếp lại trận.'; end if;
  perform club_private.player(id,(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date) from unnest(people) id where id<>'';
  same_lineup:=c.team1=array(select jsonb_array_elements_text(p_payload->'team1')) and c.team2=array(select jsonb_array_elements_text(p_payload->'team2'));
  if same_lineup and ((p_payload->>'score1')::integer is distinct from c.score1 or (p_payload->>'score2')::integer is distinct from c.score2) then raise exception 'Vui lòng ghi điểm bằng thao tác điểm, không ghi đè tỷ số.'; end if;
  if not coalesce(same_lineup,false) then p_payload:=p_payload||jsonb_build_object('score1',0,'score2',0); end if;
  p_payload:=p_payload||jsonb_build_object('status',case when (select count(*) from unnest(people) p where p<>'')<4 then 'idle' when (p_payload->>'score1')::integer>0 or (p_payload->>'score2')::integer>0 then 'in_progress' else 'ready' end);
  return club_private.save_court(p_payload,p_expected_id);
end $$;

create or replace function public.club_save_courts(p_id text,p_payloads jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare who text; spec jsonb; c public.live_court; people text[]; prior club_private.operations; args jsonb; answer jsonb:='[]';
begin
  who:=club_private.actor();
  if p_id is null or length(p_id)<12 or jsonb_array_length(p_payloads)<>2 then raise exception 'Yêu cầu xếp sân không hợp lệ.'; end if;
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  args:=jsonb_build_object('courts',p_payloads,'expected',p_expected);
  select * into prior from club_private.operations where id=p_id;
  if found then
    if prior.actor<>who or prior.kind<>'courts' or prior.arguments<>args then raise exception 'Mã thao tác không hợp lệ.'; end if;
    return prior.result;
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_payloads) x where x->>'id' in ('court_1','court_2'))<>2 then raise exception 'Cần đúng hai sân.'; end if;
  select array_agg(person) into people from jsonb_array_elements(p_payloads) x cross join lateral jsonb_array_elements_text((x->'team1')||(x->'team2')) person;
  if cardinality(people)<>8 or ''=any(people) or (select count(distinct p) from unnest(people) p)<>8 then raise exception 'Cần tám vận động viên khác nhau.'; end if;
  for spec in select value from jsonb_array_elements(p_payloads) order by value->>'id' loop
    select * into c from public.live_court where id=spec->>'id' for update;
    if found and c.match_id is distinct from p_expected->>(spec->>'id') and not(p_expected->>(spec->>'id') is null and c.status='idle' and cardinality(c.team1)=0 and cardinality(c.team2)=0) then raise exception 'Sân đã thay đổi trên thiết bị khác. Vui lòng tải lại.'; end if;
  end loop;
  -- Both refunds and both new lineups commit together, including people moving
  -- from one existing court to the other.
  update public.live_court set team1='{}',team2='{}',score1=0,score2=0,status='idle' where id in ('court_1','court_2');
  for spec in select value from jsonb_array_elements(p_payloads) order by value->>'id' loop
    answer:=answer||jsonb_build_array(public.club_save_court(spec,(select match_id from public.live_court where id=spec->>'id')));
  end loop;
  insert into club_private.operations(id,actor,kind,arguments,result) values(p_id,who,'courts',args,answer);
  return answer;
end $$;
create or replace function public.club_score(p_id text,p_court_id text,p_match_id text,p_action text,p_values jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare c public.live_court; who text; prior club_private.operations; args jsonb; s1 integer; s2 integer; answer jsonb;
begin
  who:=club_private.actor();
  if p_id is null or length(p_id)<12 then raise exception 'Mã thao tác không hợp lệ.'; end if;
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  select * into strict c from public.live_court where id=p_court_id for update;
  args:=jsonb_build_object('court',p_court_id,'match',p_match_id,'action',p_action,'values',p_values);
  select * into prior from club_private.operations where id=p_id;
  if found then
    if prior.actor<>who or prior.kind<>'score' or prior.arguments<>args then raise exception 'Mã thao tác không hợp lệ.'; end if;
    return prior.result;
  end if;
  if c.match_id is distinct from p_match_id or cardinality(c.team1)<>2 or cardinality(c.team2)<>2 or ''=any(c.team1||c.team2) or c.status not in ('ready','in_progress') then raise exception 'Trận đã thay đổi hoặc chưa đủ bốn người. Vui lòng tải lại sân.'; end if;
  s1:=c.score1;s2:=c.score2;
  if p_action='delta' then
    if coalesce(p_values->>'team','') not in ('team1','team2') or (p_values->>'delta')::integer not in (-1,1) then raise exception 'Điểm không hợp lệ.'; end if;
    if p_values->>'team'='team1' then s1:=s1+(p_values->>'delta')::integer; else s2:=s2+(p_values->>'delta')::integer; end if;
  elsif p_action='set' then
    if (p_values->>'expected1')::integer is distinct from c.score1 or (p_values->>'expected2')::integer is distinct from c.score2 then raise exception 'Tỷ số đã được cập nhật trên thiết bị khác. Vui lòng xem lại.'; end if;
    s1:=(p_values->>'score1')::integer;s2:=(p_values->>'score2')::integer;
  else raise exception 'Thao tác điểm không hợp lệ.'; end if;
  if s1 is null or s2 is null or s1 not between 0 and 30 or s2 not between 0 and 30 then raise exception 'Điểm phải trong khoảng 0–30.'; end if;
  update public.live_court set score1=s1,score2=s2,status='in_progress',updated_at=clock_timestamp() where id=c.id returning * into c;
  answer:=to_jsonb(c);
  insert into club_private.operations(id,actor,kind,arguments,result) values(p_id,who,'score',args,answer);
  return answer;
end $$;

create or replace function club_private.player(who text,day date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare m public.members; guest jsonb;
begin
  select * into m from public.members where id=who;
  if found then return jsonb_build_object('id',m.id,'elo',m.elo,'matchesPlayed',m.matches_played,
    'shield',coalesce((to_jsonb(m)->>'active_elo_shield')::boolean,(public.club_meta(m.phone)->>'activeEloShield')::boolean,false)); end if;
  select g into guest from public.attendance a cross join lateral jsonb_array_elements(coalesce(a.games_played_today->'_guest_profiles','[]')) g where a.date=day::text and g->>'id'=who;
  if guest is null then raise exception 'Vận động viên không còn trong buổi đánh. Vui lòng tải lại sân.'; end if;
  return guest;
end $$;
create or replace function club_private.elo_delta(t1 jsonb,t2 jsonb,s1 integer,s2 integer) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare e1 double precision; e2 double precision; games double precision; k integer; prob double precision; margin double precision; maxloss integer; d integer;
begin
  select avg((p->>'elo')::numeric) into e1 from jsonb_array_elements(t1) p;
  select avg((p->>'elo')::numeric) into e2 from jsonb_array_elements(t2) p;
  select avg(coalesce((p->>'matchesPlayed')::numeric,0)) into games from jsonb_array_elements(case when s1>s2 then t1 else t2 end) p;
  k:=case when games<10 then 40 when games<20 then 30 else 24 end;
  prob:=1/(1+power(10.0,(case when s1>s2 then e2-e1 else e1-e2 end)/400));
  margin:=0.9+(greatest(1,least(abs(s1-s2),15))-1)/14.0*0.6;
  select min(greatest(0,(p->>'elo')::integer-500)) into maxloss from jsonb_array_elements(case when s1>s2 then t2 else t1 end) p;
  d:=least(greatest(5,least(floor(k*(1-prob)*margin+0.5)::integer,round(k*1.2)::integer)),maxloss);
  return case when s1>s2 then d else -d end;
end $$;
create or replace function public.club_place_bet(p_id text,p_court_id text,p_match_id text,p_member_id text,p_team text,p_amount integer,p_odds numeric) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare c public.live_court; e1 numeric; e2 numeric; prob double precision; odds numeric; day date:=(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  perform club_private.actor(p_member_id);
  select * into strict c from public.live_court where id=p_court_id for update;
  -- A successful retry keeps the original accepted quote, even if Elo changed.
  if exists(select 1 from public.bets where id=p_id) then return club_private.place_bet(p_id,p_court_id,p_match_id,p_member_id,p_team,p_amount,p_odds); end if;
  if cardinality(c.team1)<>2 or cardinality(c.team2)<>2 or ''=any(c.team1||c.team2) then raise exception 'Đội hình chưa đủ bốn người.'; end if;
  select avg((club_private.player(who,day)->>'elo')::numeric) into e1 from unnest(c.team1) who;
  select avg((club_private.player(who,day)->>'elo')::numeric) into e2 from unnest(c.team2) who;
  prob:=1/(1+power(10.0,(e2-e1)/400));
  odds:=greatest(1.20,least(3.00,round((0.95/greatest(0.01,case when p_team='team1' then prob else 1-prob end))::numeric,2)));
  if p_odds is null or p_odds<>odds then raise exception 'Kèo đã thay đổi. Vui lòng tải lại kèo trước khi đặt cược.'; end if;
  return club_private.place_bet(p_id,p_court_id,p_match_id,p_member_id,p_team,p_amount,odds);
end $$;

create or replace function public.club_finish_match(p_match_id text,p_score1 integer,p_score2 integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare c public.live_court; who text; actor text; day date:=(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  a public.attendance; t1 jsonb; t2 jsonb; player jsonb; results jsonb:='{}'; guests jsonb; games jsonb;
  base integer; delta integer; won boolean; shield public.user_inventory; used boolean; answer public.matches;
begin
  actor:=club_private.actor();
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  select * into answer from public.matches where id=p_match_id;
  if found then
    if answer.score1<>p_score1 or answer.score2<>p_score2 then raise exception 'Trận đã được chốt với tỷ số khác. Vui lòng tải lại.'; end if;
    return to_jsonb(answer);
  end if;
  if p_score1 is null or p_score2 is null or p_score1 not between 0 and 30 or p_score2 not between 0 and 30
    or p_score1=p_score2 or greatest(p_score1,p_score2)<11
    or (least(p_score1,p_score2)>=20 and greatest(p_score1,p_score2)<30 and abs(p_score1-p_score2)<2) then raise exception 'Tỷ số chưa đủ điều kiện kết thúc trận.'; end if;
  select * into strict c from public.live_court where match_id=p_match_id for update;
  if c.status not in ('ready','in_progress') or cardinality(c.team1)<>2 or cardinality(c.team2)<>2
    or ''=any(c.team1||c.team2) or (select count(distinct p) from unnest(c.team1||c.team2) p)<>4 then raise exception 'Trận chưa đủ bốn vận động viên khác nhau.'; end if;
  if c.score1<>p_score1 or c.score2<>p_score2 then raise exception 'Tỷ số máy chủ đã thay đổi hoặc chưa lưu xong. Vui lòng xem lại trước khi chốt.'; end if;
  insert into public.attendance(date,present_ids,games_played_today) values(day::text,'{}','{}') on conflict do nothing;
  select * into a from public.attendance where date=day::text for update;
  perform 1 from public.members where id=any(c.team1||c.team2) or id in(select member_id from public.bets where match_id=p_match_id) order by id for update;
  select jsonb_agg(club_private.player(id,day) order by ord) into t1 from unnest(c.team1) with ordinality p(id,ord);
  select jsonb_agg(club_private.player(id,day) order by ord) into t2 from unnest(c.team2) with ordinality p(id,ord);
  base:=club_private.elo_delta(t1,t2,p_score1,p_score2);
  games:=coalesce(a.games_played_today,'{}');guests:=coalesce(games->'_guest_profiles','[]');
  for who in select unnest(c.team1||c.team2) loop
    player:=club_private.player(who,day);won:=(who=any(c.team1))=(p_score1>p_score2);
    delta:=case when who=any(c.team1) then base else -base end;used:=false;shield:=null;
    if not won and delta<0 and coalesce((player->>'shield')::boolean,false) then
      select * into shield from public.user_inventory where member_id=who and item_id='elo_shield' and quantity>0 order by id limit 1 for update;
      if found then used:=true;delta:=least(-1,floor(delta*0.5+0.5)::integer); end if;
    end if;
    results:=jsonb_set(results,array[who],jsonb_build_object('eloBefore',(player->>'elo')::integer,
      'eloAfter',(player->>'elo')::integer+delta,'eloDelta',delta,'shieldUsed',used,'shieldItemId',shield.id));
    games:=jsonb_set(games,array[who],to_jsonb(coalesce((games->>who)::integer,0)+1));
    if who like 'guest_%' then
      select jsonb_agg(case when g->>'id'=who then g||jsonb_build_object('elo',(player->>'elo')::integer+delta,
        'matchesPlayed',coalesce((g->>'matchesPlayed')::integer,0)+1,'wins',coalesce((g->>'wins')::integer,0)+case when won then 1 else 0 end,
        'losses',coalesce((g->>'losses')::integer,0)+case when won then 0 else 1 end,
        'streak',case when won then greatest(coalesce((g->>'streak')::integer,0),0)+1 else least(coalesce((g->>'streak')::integer,0),0)-1 end) else g end) into guests from jsonb_array_elements(guests) g;
    end if;
  end loop;
  insert into public.matches(id,timestamp,court_number,team1,team2,score1,score2,elo_change,is_deuce)
    values(p_match_id,floor(extract(epoch from clock_timestamp())*1000)::bigint,
      c.court_number||'|ref:'||actor||'|'||(select name from public.members where id=actor)||'|audit_v1:'||
      (select string_agg(case when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 then chr(b) else '%'||upper(lpad(to_hex(b),2,'0')) end,'' order by i)
       from (select i,get_byte(bytes,i) b from (select convert_to(jsonb_build_object('deltaTeam1',base,'deltaTeam2',-base,'playerResults',results)::text,'UTF8') bytes) raw,
       lateral generate_series(0,length(bytes)-1) i) encoded),
      c.team1,c.team2,p_score1,p_score2,abs(base),(least(p_score1,p_score2)>=20 or abs(p_score1-p_score2)<=2)) returning * into answer;
  update public.attendance set games_played_today=jsonb_set(games,'{_guest_profiles}',guests),updated_at=clock_timestamp() where date=day::text;
  return to_jsonb(answer);
end $$;

create or replace function public.club_undo_match(p_match_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare m public.matches; day date; a public.attendance; games jsonb; guests jsonb; who text; p jsonb; audit jsonb; delta integer; won boolean;
begin
  perform club_private.actor(null,true);
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  select * into m from public.matches where id=p_match_id for update;
  if not found then return false; end if;
  day:=(to_timestamp(m.timestamp/1000.0) at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into a from public.attendance where date=day::text for update;
  games:=coalesce(a.games_played_today,'{}');guests:=coalesce(games->'_guest_profiles','[]');audit:=public.club_match_audit(m.court_number);
  -- Old unlinked rewards must not be guessed when there are multiple candidates.
  if exists(select 1 from unnest(m.team1||m.team2) participant(id) where
    not exists(select 1 from public.coin_transactions where member_id=participant.id and match_id=m.id and type in ('match_win','match_loss'))
    and (select count(*) from public.coin_transactions where member_id=participant.id and type in ('match_win','match_loss') and abs(extract(epoch from created_at)*1000-m.timestamp)<60000)>1) then
    raise exception 'Trận cũ có giao dịch thưởng chưa xác định rõ. Cần đối soát trước khi hoàn tác.';
  end if;
  delete from public.matches where id=m.id;
  for who in select unnest(m.team1||m.team2) loop
    if games ? who then games:=jsonb_set(games,array[who],to_jsonb(greatest(0,(games->>who)::integer-1))); end if;
    if who like 'guest_%' then
      p:=audit->'playerResults'->who;
      won:=(who=any(m.team1))=(m.score1>m.score2);
      delta:=coalesce((p->>'eloDelta')::integer,case when won then m.elo_change when m.id like 'match_zs_%' then -m.elo_change else -greatest(1,round(m.elo_change*0.8)::integer) end);
      select coalesce(jsonb_agg(case when g->>'id'=who then g||jsonb_build_object('elo',greatest(500,(g->>'elo')::integer-delta),
        'matchesPlayed',greatest(0,coalesce((g->>'matchesPlayed')::integer,0)-1),'wins',greatest(0,coalesce((g->>'wins')::integer,0)-case when won then 1 else 0 end),
        'losses',greatest(0,coalesce((g->>'losses')::integer,0)-case when won then 0 else 1 end),'streak',public.club_member_streak(who)) else g end),'[]') into guests from jsonb_array_elements(guests) g;
    end if;
  end loop;
  if a.date is not null then update public.attendance set games_played_today=jsonb_set(games,'{_guest_profiles}',guests),updated_at=clock_timestamp() where date=a.date; end if;
  return true;
end $$;

create or replace function public.club_attendance_action(p_id text,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare who text; a public.attendance; day text:=(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text;
  target text; guests jsonb; games jsonb; present text[]; g jsonb; answer jsonb; prior club_private.operations;
begin
  who:=club_private.actor();
  if p_id is null or length(p_id)<12 then raise exception 'Mã thao tác không hợp lệ.'; end if;
  perform pg_advisory_xact_lock(hashtext('club-all-courts'));
  insert into public.attendance(date,present_ids,games_played_today) values(day,array(select id from public.members where frequency='regular'),'{}') on conflict do nothing;
  select * into a from public.attendance where date=day for update;
  select * into prior from club_private.operations where id=p_id;
  if found then
    if prior.actor<>who or prior.kind<>p_action or prior.arguments<>p_payload then raise exception 'Mã thao tác không hợp lệ.'; end if;
    return prior.result;
  end if;
  guests:=coalesce(a.games_played_today->'_guest_profiles','[]');games:=coalesce(a.games_played_today,'{}');present:=coalesce(a.present_ids,'{}');target:=p_payload->>'memberId';
  if p_action='present' then
    if not exists(select 1 from public.members where id=target) and not exists(select 1 from jsonb_array_elements(guests) entry where entry->>'id'=target) then raise exception 'Không tìm thấy thành viên.'; end if;
    if (p_payload->>'present')::boolean then present:=array(select distinct unnest(present||array[target])); else present:=array_remove(present,target); end if;
  elsif p_action='roster' then
    perform club_private.actor(null,true);
    present:=array(select jsonb_array_elements_text(p_payload->'presentIds'));
    if exists(select 1 from unnest(present) id where not exists(select 1 from public.members m where m.id=id)) then raise exception 'Danh sách thành viên không hợp lệ.'; end if;
  elsif p_action='guest_add' then
    g:=p_payload->'guest';target:=g->>'id';
    if coalesce(target,'') !~ '^guest_[A-Za-z0-9_-]+$' or length(btrim(coalesce(g->>'name',''))) not between 1 and 100 or coalesce((g->>'elo')::integer,0) not between 500 and 3000 or coalesce(g->>'gender','') not in ('male','female') then raise exception 'Thông tin khách không hợp lệ.'; end if;
    if exists(select 1 from jsonb_array_elements(guests) x where x->>'id'=target) then raise exception 'Khách đã tồn tại. Vui lòng tải lại.'; end if;
    guests:=guests||jsonb_build_array(jsonb_build_object('id',target,'name',btrim(g->>'name'),'gender',g->>'gender','elo',(g->>'elo')::integer,'matchesPlayed',0,'wins',0,'losses',0,'streak',0,'isGuest',true,'role','guest','avatar','','createdAt',clock_timestamp()));
    present:=present||array[target];
  elsif p_action='guest_remove' then
    if target is null or not exists(select 1 from jsonb_array_elements(guests) entry where entry->>'id'=target) then raise exception 'Khách không tồn tại.'; end if;
    if exists(select 1 from public.live_court where target=any(team1||team2)) then raise exception 'Khách đang trên sân. Vui lòng dọn vị trí trước.'; end if;
    select coalesce(jsonb_agg(x),'[]') into guests from jsonb_array_elements(guests) x where x->>'id'<>target;
    present:=array_remove(present,target);games:=games-target;
  else raise exception 'Thao tác điểm danh không hợp lệ.'; end if;
  update public.attendance set present_ids=present,games_played_today=jsonb_set(games,'{_guest_profiles}',guests),updated_at=clock_timestamp() where date=day returning * into a;
  answer:=to_jsonb(a);
  insert into club_private.operations(id,actor,kind,arguments,result) values(p_id,who,p_action,p_payload,answer);
  return answer;
end $$;

create or replace function public.club_rsvp(p_session_id text,p_member_id text,p_status text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare answer public.sessions;
begin
  perform club_private.actor(p_member_id);
  if coalesce(p_status,'') not in ('attending','maybe','declined') then raise exception 'Trạng thái đăng ký không hợp lệ.'; end if;
  select * into strict answer from public.sessions where id=p_session_id for update;
  update public.sessions set rsvps=jsonb_set(coalesce(rsvps,'{}'),array[p_member_id],to_jsonb(p_status)),updated_at=clock_timestamp() where id=p_session_id returning * into answer;
  return to_jsonb(answer);
end $$;

-- Prevent old browsers from changing protected data through old endpoints.
create or replace function public.club_gift_october20() returns integer
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  -- Existing gifts and frame choices stay exactly as stored. New female members
  -- receive the gift during registration; opening an app is read-only.
  return 0;
end $$;

create or replace function public.club_create_member(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare id text:='mem_'||replace(gen_random_uuid()::text,'-',''); initial integer:=1000; meta jsonb; token text; admin boolean:=false; actor_id text; request_id text; args jsonb; prior club_private.operations; answer jsonb;
begin
  begin admin:=club_private.actor(null,true)='mem_1789569517045'; exception when invalid_authorization_specification or insufficient_privilege then admin:=false; end;
  actor_id:=case when admin then 'mem_1789569517045' else 'registration' end;
  request_id:=p_payload->>'requestId';
  if request_id is null or request_id !~ '^register_[a-zA-Z0-9_-]{12,80}$' then raise exception 'Mã đăng ký không hợp lệ.'; end if;
  args:=jsonb_build_object('hash',encode(sha256(convert_to((p_payload-'requestId')::text,'UTF8')),'hex'));
  perform pg_advisory_xact_lock(hashtext(request_id));
  select * into prior from club_private.operations op where op.id=request_id;
  if found then
    if prior.kind<>'register' or prior.actor<>actor_id or prior.arguments<>args then raise exception 'Yêu cầu đăng ký đã thay đổi. Vui lòng thử lại.'; end if;
    return prior.result;
  end if;
  if coalesce(p_payload->>'pinCode','') !~ '^\d{4}$' or length(btrim(coalesce(p_payload->>'name',''))) not between 1 and 100 then raise exception 'Tên và PIN 4 số là bắt buộc.'; end if;
  if coalesce(p_payload->>'gender','male') not in ('male','female') or coalesce(p_payload->>'frequency','regular') not in ('regular','occasional') then raise exception 'Thông tin thành viên không hợp lệ.'; end if;
  if admin then initial:=coalesce((p_payload->>'elo')::integer,1000); end if;
  if initial is null or initial not between 500 and 3000 then raise exception 'Elo khởi đầu phải từ 500 đến 3000.'; end if;
  meta:=jsonb_build_object('activeFrame',case when p_payload->>'gender'='female' then 'frame_ribbon_2010' else '' end,'activeEloShield',false);
  insert into public.members(id,name,nickname,gender,frequency,elo,matches_played,wins,losses,streak,avatar,phone,joined_date)
    values(id,btrim(p_payload->>'name'),left(coalesce(p_payload->>'nickname',''),100),coalesce(p_payload->>'gender','male'),coalesce(p_payload->>'frequency','regular'),initial,0,0,0,0,coalesce(p_payload->>'avatar',''),meta::text,(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text);
  insert into club_private.credentials(member_id,pin_hash) values(id,club_private.pin_hash(p_payload->>'pinCode'));
  insert into public.coin_transactions(id,member_id,amount,balance_after,type,description,operation_key)
    values('tx_welcome_'||id,id,100,100,'welcome','Chào mừng gia nhập CLB','welcome:'||id);
  if p_payload->>'gender'='female' then insert into public.user_inventory(id,member_id,item_id,item_type,quantity,status) values('inv_'||id||'_frame_ribbon_2010',id,'frame_ribbon_2010','frame',1,'available'); end if;
  if not admin then
    token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
    insert into club_private.sessions(token_hash,member_id,expires_at) values(sha256(convert_to(token,'UTF8')),id,clock_timestamp()+interval '7 days');
  end if;
  answer:=jsonb_build_object('success',true,'memberId',id,'token',token);
  insert into club_private.operations(id,actor,kind,arguments,result) values(request_id,actor_id,'register',args,answer);
  return answer;
end $$;
create or replace function public.club_delete_member(p_member_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  perform club_private.actor(null,true);
  if p_member_id='mem_1789569517045' or exists(select 1 from public.matches where p_member_id=any(team1||team2)) or exists(select 1 from public.coin_transactions where member_id=p_member_id) or exists(select 1 from public.live_court where p_member_id=any(team1||team2)) then raise exception 'Thành viên có lịch sử hoặc đang trên sân; không thể xóa để bảo toàn dữ liệu.'; end if;
  delete from public.members where id=p_member_id;
  return found;
end $$;
create or replace function public.club_save_session(p_payload jsonb,p_expected_updated_at text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
declare s public.sessions;
begin
  perform club_private.actor(null,true);
  select * into s from public.sessions where id=p_payload->>'id' for update;
  if found and (p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at::timestamptz) then raise exception 'Lịch đã thay đổi. Vui lòng tải lại.'; end if;
  if coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or length(btrim(coalesce(p_payload->>'title',''))) not between 1 and 150 then raise exception 'Lịch không hợp lệ.'; end if;
  insert into public.sessions(id,title,date,start_time,end_time,venue_name,venue_address,court_numbers,fee_note,rsvps)
    values(p_payload->>'id',p_payload->>'title',p_payload->>'date',p_payload->>'start_time',p_payload->>'end_time',p_payload->>'venue_name',p_payload->>'venue_address',p_payload->>'court_numbers',p_payload->>'fee_note','{}')
    on conflict(id) do update set title=excluded.title,date=excluded.date,start_time=excluded.start_time,end_time=excluded.end_time,venue_name=excluded.venue_name,venue_address=excluded.venue_address,court_numbers=excluded.court_numbers,fee_note=excluded.fee_note,updated_at=clock_timestamp() returning * into s;
  return to_jsonb(s);
end $$;
create or replace function public.club_delete_session(p_session_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin perform club_private.actor(null,true); delete from public.sessions where id=p_session_id;return found;end $$;
create or replace function public.club_save_settings(p_payload jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  perform club_private.actor(null,true);
  insert into public.club_settings(id,club_name,announcement,default_venue,default_address,k_factor)
    values('thai_thinh',p_payload->>'club_name',p_payload->>'announcement',p_payload->>'default_venue',p_payload->>'default_address',coalesce((p_payload->>'k_factor')::integer,32))
    on conflict(id) do update set club_name=excluded.club_name,announcement=excluded.announcement,default_venue=excluded.default_venue,default_address=excluded.default_address,k_factor=excluded.k_factor;
  return true;
end $$;

create or replace function public.club_export_snapshot() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  perform club_private.actor(null,true);
  return jsonb_build_object('version','3.0-cloud','exportedAt',clock_timestamp(),
    'members',public.club_members_public(),'matches',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.matches m),
    'sessions',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.sessions s),
    'attendance',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.attendance a),
    'coinTransactions',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.coin_transactions t),
    'bets',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.bets b),
    'inventory',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.user_inventory i),
    'courts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.live_court c),
    'settings',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.club_settings s));
end $$;
create or replace function public.club_wallet_version() returns integer language sql stable as $$ select 3 $$;
-- No public table writes; future changes go through checked operations only.
revoke insert,update,delete on public.members,public.matches,public.user_inventory,public.attendance,public.sessions,public.club_settings from anon,authenticated;
revoke select on public.members from anon,authenticated;
do $$ begin
  if to_regclass('public.leaderboard_view') is not null then revoke all on public.leaderboard_view from anon,authenticated; end if;
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='members') then
    alter publication supabase_realtime drop table public.members;
  end if;
end $$;
revoke all on all functions in schema club_private from public,anon,authenticated;
revoke all on function public.club_login(text,text),public.club_logout(),public.club_members_public(),public.club_patch_member(text,jsonb,text),public.club_claim_grip(text,text),public.club_score(text,text,text,text,jsonb) from public;
grant execute on function public.club_login(text,text),public.club_logout(),public.club_members_public(),public.club_patch_member(text,jsonb,text),public.club_claim_grip(text,text),public.club_score(text,text,text,text,jsonb) to anon,authenticated;
revoke all on function public.club_buy_item(text,text,text),public.club_place_bet(text,text,text,text,text,integer,numeric),public.club_save_court(jsonb,text),public.club_finish_match(text,integer,integer),public.club_undo_match(text),public.club_attendance_action(text,text,jsonb),public.club_rsvp(text,text,text) from public;
grant execute on function public.club_buy_item(text,text,text),public.club_place_bet(text,text,text,text,text,integer,numeric),public.club_save_court(jsonb,text),public.club_finish_match(text,integer,integer),public.club_undo_match(text),public.club_attendance_action(text,text,jsonb),public.club_rsvp(text,text,text) to anon,authenticated;
revoke all on function public.club_create_member(jsonb),public.club_delete_member(text),public.club_save_session(jsonb,text),public.club_delete_session(text),public.club_save_settings(jsonb) from public;
grant execute on function public.club_create_member(jsonb),public.club_delete_member(text),public.club_save_session(jsonb,text),public.club_delete_session(text),public.club_save_settings(jsonb) to anon,authenticated;
revoke all on function public.club_export_snapshot() from public;
grant execute on function public.club_export_snapshot() to anon,authenticated;
revoke all on function public.club_save_courts(text,jsonb,jsonb) from public;
grant execute on function public.club_save_courts(text,jsonb,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
do $$ declare original record; n bigint; h text; begin
  for original in select * from club_v3_preservation loop
    execute format('select count(*),md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)::text) from public.%I r',original.table_name) into n,h;
    if n is distinct from original.rows_count or h is distinct from original.digest then
      raise exception 'Upgrade cancelled: existing records changed in %',original.table_name;
    end if;
  end loop;
end $$;
select table_name,rows_count,true as existing_data_unchanged from club_v3_preservation order by table_name;
commit;
