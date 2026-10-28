-- Close all new ribbon grants; retain existing female ownership and choices.
-- Male inventory records are retained with quantity zero, not deleted.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtext('club-all-courts'));
create or replace function public.club_gift_october20() returns integer
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  -- ribbon_event_closed_20261028: old clients cannot grant the ended gift.
  return 0;
end $$;
create or replace function public.club_buy_item(p_id text,p_member_id text,p_item_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,club_private as $$
begin
  perform club_private.actor(p_member_id);
  if p_item_id='frame_ribbon_2010' then raise exception 'Sự kiện tặng khung Nơ Hồng đã kết thúc.'; end if;
  return club_private.buy_item(p_id,p_member_id,p_item_id);
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
  meta:=jsonb_build_object('activeFrame','','activeEloShield',false);
  insert into public.members(id,name,nickname,gender,frequency,elo,matches_played,wins,losses,streak,avatar,phone,joined_date)
    values(id,btrim(p_payload->>'name'),left(coalesce(p_payload->>'nickname',''),100),coalesce(p_payload->>'gender','male'),coalesce(p_payload->>'frequency','regular'),initial,0,0,0,0,coalesce(p_payload->>'avatar',''),meta::text,(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text);
  insert into club_private.credentials(member_id,pin_hash) values(id,club_private.pin_hash(p_payload->>'pinCode'));
  insert into public.coin_transactions(id,member_id,amount,balance_after,type,description,operation_key)
    values('tx_welcome_'||id,id,100,100,'welcome','Chào mừng gia nhập CLB','welcome:'||id);
  if not admin then
    token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
    insert into club_private.sessions(token_hash,member_id,expires_at) values(sha256(convert_to(token,'UTF8')),id,clock_timestamp()+interval '7 days');
  end if;
  answer:=jsonb_build_object('success',true,'memberId',id,'token',token);
  insert into club_private.operations(id,actor,kind,arguments,result) values(request_id,actor_id,'register',args,answer);
  return answer;
end $$;
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
  if p_patch->>'activeFrame'='frame_ribbon_2010' and coalesce(p_patch->>'gender',m.gender)<>'female' then
    raise exception 'Khung Nơ Hồng chỉ dành cho thành viên nữ.';
  end if;
  if p_patch->>'gender'='male' then
    update public.user_inventory set quantity=0,updated_at=clock_timestamp() where member_id=m.id and item_id='frame_ribbon_2010' and quantity>0;
    if jsonb_typeof(meta->'inventory')='array' then
      meta:=jsonb_set(meta,'{inventory}',coalesce((select jsonb_agg(i) from jsonb_array_elements(meta->'inventory') i where i->>'itemId' is distinct from 'frame_ribbon_2010'),'[]'::jsonb));
    end if;
    if coalesce(to_jsonb(m)->>'active_frame',meta->>'activeFrame','')='frame_ribbon_2010' or meta->>'activeFrame'='frame_ribbon_2010' then
      p_patch:=p_patch||jsonb_build_object('activeFrame','');
    end if;
  end if;
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
    phone=case when p_patch ? 'activeFrame' or p_patch ? 'activeEloShield' or p_patch ? 'gender' then meta::text else phone end,updated_at=clock_timestamp() where id=m.id;
  if p_patch ? 'activeFrame' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_frame') then execute 'update public.members set active_frame=$1 where id=$2' using frame,m.id; end if;
  if p_patch ? 'activeEloShield' and exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_elo_shield') then execute 'update public.members set active_elo_shield=$1 where id=$2' using shield,m.id; end if;
  return jsonb_build_object('success',true);
end $$;
-- Retain inventory rows for recovery; zero quantity revokes ownership.
update public.user_inventory i set quantity=0,updated_at=clock_timestamp()
from public.members m where i.member_id=m.id and m.gender='male' and i.item_id='frame_ribbon_2010' and i.quantity>0;
do $recall$
declare m public.members; meta jsonb; clean jsonb;
begin
  for m in select * from public.members where gender='male' order by id for update loop
    meta:=public.club_meta(m.phone);clean:=meta;
    if jsonb_typeof(meta->'inventory')='array' then
      clean:=jsonb_set(clean,'{inventory}',coalesce((select jsonb_agg(i) from jsonb_array_elements(meta->'inventory') i where i->>'itemId' is distinct from 'frame_ribbon_2010'),'[]'::jsonb));
    end if;
    if clean->>'activeFrame'='frame_ribbon_2010' then clean:=jsonb_set(clean,'{activeFrame}','""'::jsonb); end if;
    if clean is distinct from meta then update public.members set phone=clean::text,updated_at=clock_timestamp() where id=m.id; end if;
  end loop;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_frame') then
    execute $sql$update public.members set active_frame='',updated_at=clock_timestamp() where gender='male' and active_frame='frame_ribbon_2010'$sql$;
  end if;
end $recall$;

commit;
