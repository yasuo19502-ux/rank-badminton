-- Run once in the SQL editor of the existing club project. Keeps all current
-- balances and historical rows; it does not recalculate or reimburse old coins.
begin;

create or replace function public.club_meta(value text) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if jsonb_typeof(value::jsonb) = 'object' then return value::jsonb; end if;
  return '{}'::jsonb;
exception when others then return '{}'::jsonb;
end $$;

alter table public.members add column if not exists coins integer;
update public.members set coins = greatest(0, coalesce((public.club_meta(phone)->>'coins')::integer,100)) where coins is null;
alter table public.members alter column coins set default 100;
alter table public.members alter column coins set not null;
alter table public.live_court add column if not exists match_id text;
update public.live_court set match_id = 'match_zs_' || gen_random_uuid()::text where match_id is null;
alter table public.coin_transactions add column if not exists operation_key text;
alter table public.coin_transactions add column if not exists match_id text;
alter table public.coin_transactions add column if not exists bet_id text;
create unique index if not exists coin_operation_once on public.coin_transactions(operation_key);
create unique index if not exists bet_one_per_match on public.bets(member_id,match_id) where match_id is not null and status <> 'refunded';

-- Persist which daily bonuses were already paid before enabling server rewards.
create table if not exists public.club_daily_rewards (
  member_id text not null references public.members(id) on delete cascade,
  reward_date date not null,
  active boolean not null default true,
  generation integer not null default 1,
  primary key(member_id,reward_date)
);
insert into public.club_daily_rewards(member_id,reward_date,active)
select member_id, coalesce(substring(description from 'ngày (\d{4}-\d{2}-\d{2})')::date,
  (created_at at time zone 'Asia/Ho_Chi_Minh')::date), sum(amount)>0
from public.coin_transactions where type in ('session_checkin','session_checkin_undo')
group by 1,2 on conflict do nothing;
alter table public.club_daily_rewards enable row level security;

create or replace function public.club_keep_wallet() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op='INSERT' then new.coins := 100;
  elsif current_setting('club.wallet_write',true) is distinct from 'on' then new.coins := old.coins;
  end if;
  new.phone := jsonb_set(public.club_meta(new.phone),'{coins}',to_jsonb(new.coins),true)::text;
  return new;
end $$;
drop trigger if exists club_keep_wallet on public.members;
create trigger club_keep_wallet before insert or update on public.members for each row execute function public.club_keep_wallet();

-- Only internal operations may change a wallet. Lock + idempotency + ledger insert
-- are one transaction, so a retry or another phone cannot overwrite the balance.
create or replace function public.club_apply_coin(
  who text, delta integer, kind text, detail text, op text,
  match_ref text default null, bet_ref text default null, floor_zero boolean default false
) returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare balance integer; previous_flag text;
begin
  select coins into strict balance from public.members where id=who for update;
  if exists(select 1 from public.coin_transactions where operation_key=op) then return balance; end if;
  if floor_zero then delta := greatest(-balance,delta); end if;
  if balance+delta < 0 then raise exception 'Số dư xu không đủ'; end if;
  previous_flag := current_setting('club.wallet_write',true);
  perform set_config('club.wallet_write','on',true);
  update public.members set coins=balance+delta where id=who;
  perform set_config('club.wallet_write',coalesce(previous_flag,''),true);
  insert into public.coin_transactions(id,member_id,amount,balance_after,type,description,operation_key,match_id,bet_id,created_at)
  values('tx_v2_'||md5(op),who,delta,balance+delta,kind,detail,op,match_ref,bet_ref,
    greatest(clock_timestamp(),(select max(created_at)+interval '1 microsecond' from public.coin_transactions where member_id=who and operation_key is not null)));
  return balance+delta;
end $$;
revoke all on function public.club_apply_coin(text,integer,text,text,text,text,text,boolean) from public,anon,authenticated;

create or replace function public.club_refund_pending(match_ref text, reason text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare b public.bets;
begin
  perform 1 from public.members where id in(select member_id from public.bets where match_id=match_ref and status='pending') order by id for update;
  for b in select * from public.bets where match_id=match_ref and status='pending' order by id for update loop
    perform public.club_apply_coin(b.member_id,b.amount,'bet_refund',reason,'refund:'||b.id,match_ref,b.id);
    update public.bets set status='refunded' where id=b.id;
  end loop;
end $$;
revoke all on function public.club_refund_pending(text,text) from public,anon,authenticated;

-- A match identity belongs to its lineup and survives score updates/reloads.
create or replace function public.club_live_identity() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare changed boolean := false;
begin
  if tg_op='INSERT' then
    new.match_id := coalesce(new.match_id,'match_zs_'||gen_random_uuid()::text);
  else
    changed := new.team1 is distinct from old.team1 or new.team2 is distinct from old.team2;
    if changed then
      new.match_id := case when new.match_id is not null and new.match_id is distinct from old.match_id then new.match_id else 'match_zs_'||gen_random_uuid()::text end;
    elsif new.match_id is distinct from old.match_id then
      if new.score1<>0 or new.score2<>0 then raise exception 'Đội hình/trận đã thay đổi. Vui lòng tải lại sân.'; end if;
      new.match_id := coalesce(new.match_id,'match_zs_'||gen_random_uuid()::text);
    else new.match_id := old.match_id;
    end if;
    if old.status='finished' and new.match_id=old.match_id then new.status:='finished'; end if;
    if new.match_id is distinct from old.match_id then
      perform public.club_refund_pending(old.match_id,'Hoàn cược: đội hình hoặc trận đấu đã thay đổi');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists club_live_identity on public.live_court;
create trigger club_live_identity before insert or update on public.live_court for each row execute function public.club_live_identity();

create or replace function public.club_save_court(p_payload jsonb,p_expected_id text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.live_court; saved public.live_court;
begin
  if p_payload->>'id' not in ('court_1','court_2') then raise exception 'Sân không hợp lệ'; end if;
  -- Serialize the first creation too, before a row exists to lock.
  perform pg_advisory_xact_lock(hashtext('club-court:'||(p_payload->>'id')));
  select * into c from public.live_court where id=p_payload->>'id' for update;
  if found and c.match_id is distinct from p_expected_id and not(p_expected_id is null and c.status='idle' and cardinality(c.team1)=0 and cardinality(c.team2)=0) then
    raise exception 'Sân đã thay đổi trên thiết bị khác. Vui lòng tải lại sân.';
  end if;
  insert into public.live_court(id,court_number,team1,team2,score1,score2,matchmaker_mode,status,diff_elo,match_id)
  values(p_payload->>'id',case when p_payload->>'id'='court_2' then 'Sân 2' else 'Sân 1' end,
    array(select jsonb_array_elements_text(p_payload->'team1')),array(select jsonb_array_elements_text(p_payload->'team2')),
    (p_payload->>'score1')::integer,(p_payload->>'score2')::integer,p_payload->>'matchmaker_mode',p_payload->>'status',
    (p_payload->>'diff_elo')::integer,p_payload->>'match_id')
  on conflict(id) do update set team1=excluded.team1,team2=excluded.team2,score1=excluded.score1,score2=excluded.score2,
    status=excluded.status,matchmaker_mode=excluded.matchmaker_mode,diff_elo=excluded.diff_elo,match_id=excluded.match_id
  returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.club_wallet_version() returns integer
language sql stable as $$ select 2 $$;

create or replace function public.club_match_audit(court text) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare decoded text;
begin
  select convert_from(string_agg(case when part[1] like '\%%' then decode(substr(part[1],2),'hex') else convert_to(part[1],'UTF8') end,''::bytea),'UTF8')
  into decoded from regexp_matches(split_part(court,'|audit_v1:',2),'(%[0-9A-Fa-f]{2}|[^%]+)','g') part;
  return decoded::jsonb;
exception when others then return null;
end $$;

create or replace function public.club_member_streak(who text) returns integer
language plpgsql stable set search_path=pg_catalog,public as $$
declare m record; first_won boolean; won boolean; streak integer:=0;
begin
  for m in select * from public.matches where who=any(team1) or who=any(team2) order by timestamp desc,id desc loop
    won:=(who=any(m.team1))=(m.score1>m.score2);
    if first_won is null then first_won:=won; end if;
    exit when won<>first_won;
    streak:=streak+case when won then 1 else -1 end;
  end loop;
  return streak;
end $$;

create or replace function public.club_place_bet(
  p_id text,p_court_id text,p_match_id text,p_member_id text,p_team text,p_amount integer,p_odds numeric
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.live_court; b public.bets; balance integer;
begin
  select * into strict c from public.live_court where id=p_court_id for update;
  select * into b from public.bets where id=p_id;
  if found then
    if b.member_id<>p_member_id or b.match_id<>p_match_id or b.amount<>p_amount or b.predicted_team<>p_team then raise exception 'Mã vé cược không hợp lệ'; end if;
    return to_jsonb(b);
  end if;
  if c.match_id is distinct from p_match_id or c.status not in ('ready','in_progress')
    or cardinality(c.team1)<>2 or cardinality(c.team2)<>2 or ''=any(c.team1||c.team2)
    or (select count(distinct x) from unnest(c.team1||c.team2) x)<>4 then
    raise exception 'Trận/đội hình đã thay đổi. Vui lòng tải lại sân.';
  end if;
  if c.score1>=10 or c.score2>=10 then raise exception 'Trận đã chạm 10 điểm, không thể đặt cược'; end if;
  if p_member_id=any(c.team1||c.team2) then raise exception 'Người đang thi đấu không được đặt cược'; end if;
  if p_team not in ('team1','team2') or p_amount not in (10,20,30) or p_odds<1.2 or p_odds>3 or p_odds is null then raise exception 'Vé cược không hợp lệ'; end if;
  if exists(select 1 from public.bets where member_id=p_member_id and match_id=p_match_id and status<>'refunded') then raise exception 'Bạn đã đặt cược trận này'; end if;
  insert into public.bets(id,court_id,match_id,member_id,predicted_team,amount,odds,potential_payout,status)
  values(p_id,p_court_id,p_match_id,p_member_id,p_team,p_amount,round(p_odds,2),round(p_amount*round(p_odds,2)),'pending') returning * into b;
  balance := public.club_apply_coin(p_member_id,-p_amount,'bet_placed','Đặt cược '||p_amount||' Xu cho '||p_team||' ('||c.court_number||', Kèo '||b.odds||'x)','stake:'||p_id,p_match_id,p_id);
  return to_jsonb(b)||jsonb_build_object('balance_after',balance);
end $$;

-- Insert the result, reward players and settle ALL server bets for this ID.
create or replace function public.club_match_coins() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.live_court; who text; winner text; day date; daily public.club_daily_rewards;
  b public.bets; reward integer; original integer; audit jsonb; personal jsonb;
  current_elo integer; shield public.user_inventory; player_won boolean; delta integer;
begin
  day := (to_timestamp(coalesce(new.timestamp,old.timestamp)/1000.0) at time zone 'Asia/Ho_Chi_Minh')::date;
  if tg_op='INSERT' then
    select * into c from public.live_court where match_id=new.id for update;
    if not found or c.status='finished' or c.team1<>new.team1 or c.team2<>new.team2 or c.court_number<>split_part(new.court_number,'|',1) then
      raise exception 'Trận/đội hình đã thay đổi hoặc đã chốt. Vui lòng tải lại sân.';
    end if;
    if new.score1=new.score2 then raise exception 'Trận đấu chưa có người thắng'; end if;
    winner := case when new.score1>new.score2 then 'team1' else 'team2' end;
    audit := public.club_match_audit(new.court_number);
    perform 1 from public.members where id=any(new.team1||new.team2) or id in(select member_id from public.bets where match_id=new.id) order by id for update;
    for who in select id from public.members where id=any(new.team1||new.team2) order by id loop
      player_won := (who=any(new.team1))=(winner='team1');
      personal := audit->'playerResults'->who;
      select elo into current_elo from public.members where id=who;
      if personal is null or (personal->>'eloBefore')::integer is distinct from current_elo
        or (personal->>'eloAfter')::integer is distinct from current_elo+(personal->>'eloDelta')::integer
        or (personal->>'eloAfter')::integer<500 then
        raise exception 'Điểm thành viên đã thay đổi. Vui lòng tải lại sân trước khi chốt.';
      end if;
      if coalesce((personal->>'shieldUsed')::boolean,false) then
        if not (select coalesce((to_jsonb(m)->>'active_elo_shield')::boolean,(public.club_meta(m.phone)->>'activeEloShield')::boolean,false) from public.members m where id=who) then
          raise exception 'Thẻ bảo vệ chưa bật hoặc đã thay đổi. Vui lòng tải lại.';
        end if;
        select * into shield from public.user_inventory where id=personal->>'shieldItemId' and member_id=who and item_id='elo_shield' for update;
        if not found or shield.quantity<1 or player_won then raise exception 'Thẻ bảo vệ đã thay đổi. Vui lòng tải lại.'; end if;
        update public.user_inventory set quantity=quantity-1,updated_at=clock_timestamp() where id=shield.id;
        if shield.quantity=1 then
          update public.members set phone=jsonb_set(public.club_meta(phone),'{activeEloShield}','false')::text where id=who;
          if exists(select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='active_elo_shield') then
            execute 'update public.members set active_elo_shield=false where id=$1' using who;
          end if;
        end if;
      end if;
      update public.members set elo=(personal->>'eloAfter')::integer,matches_played=coalesce(matches_played,0)+1,
        wins=coalesce(wins,0)+case when player_won then 1 else 0 end,
        losses=coalesce(losses,0)+case when player_won then 0 else 1 end,
        streak=case when player_won then greatest(coalesce(streak,0),0)+1 else least(coalesce(streak,0),0)-1 end where id=who;
      insert into public.club_daily_rewards(member_id,reward_date,active) values(who,day,false) on conflict do nothing;
      select * into daily from public.club_daily_rewards where member_id=who and reward_date=day for update;
      if not daily.active then
        perform public.club_apply_coin(who,50,'session_checkin','Thưởng điểm danh & thi đấu trận đầu tiên ngày '||day,'daily:'||who||':'||day||':'||daily.generation,new.id);
        update public.club_daily_rewards set active=true where member_id=who and reward_date=day;
      end if;
      reward := case when (who=any(new.team1))=(winner='team1') then 20 else 5 end;
      perform public.club_apply_coin(who,reward,case when reward=20 then 'match_win' else 'match_loss' end,
        'Hoàn thành trận '||c.court_number||' ('||new.score1||'-'||new.score2||')','match:'||new.id||':'||who,new.id);
    end loop;
    for b in select * from public.bets where match_id=new.id and status='pending' order by id for update loop
      if b.predicted_team=winner then
        perform public.club_apply_coin(b.member_id,b.potential_payout,'bet_win','Thắng cược trận '||c.court_number||': +'||b.potential_payout||' Xu','payout:'||b.id,new.id,b.id);
      end if;
      update public.bets set status=case when b.predicted_team=winner then 'won' else 'lost' end where id=b.id;
    end loop;
    update public.live_court set status='idle',team1='{}',team2='{}',score1=0,score2=0 where id=c.id;
    return new;
  end if;

  -- Deleting a result uses compensating transactions, never deletes its ledger.
  audit := public.club_match_audit(old.court_number);
  perform 1 from public.members where id=any(old.team1||old.team2) or id in(select member_id from public.bets where match_id=old.id) order by id for update;
  for who in select id from public.members where id=any(old.team1||old.team2) order by id loop
    player_won := (who=any(old.team1))=(old.score1>old.score2);
    personal := audit->'playerResults'->who;
    delta := coalesce((personal->>'eloDelta')::integer,case when player_won then old.elo_change
      when old.id like 'match_zs_%' then -old.elo_change else -greatest(1,round(old.elo_change*0.8)::integer) end);
    update public.members set elo=greatest(500,elo-delta),matches_played=greatest(0,matches_played-1),
      wins=greatest(0,wins-case when player_won then 1 else 0 end),losses=greatest(0,losses-case when player_won then 0 else 1 end),
      streak=public.club_member_streak(who) where id=who;
    if coalesce((personal->>'shieldUsed')::boolean,false) then
      update public.user_inventory set quantity=quantity+1,updated_at=clock_timestamp() where id=personal->>'shieldItemId' and member_id=who and item_id='elo_shield';
    end if;
    select amount into original from public.coin_transactions where member_id=who and match_id=old.id and type in ('match_win','match_loss') limit 1;
    if original is null then
      select amount into original from public.coin_transactions where member_id=who and type in ('match_win','match_loss')
        and abs(extract(epoch from created_at)*1000-old.timestamp)<60000 order by abs(extract(epoch from created_at)*1000-old.timestamp) limit 1;
    end if;
    if original is not null then
      perform public.club_apply_coin(who,-original,'match_undo','Hoàn tác trận đấu: Thu hồi xu thi đấu','undo:'||old.id||':'||who,old.id,null,true);
    end if;
    if not exists(select 1 from public.matches m where (who=any(m.team1) or who=any(m.team2))
      and (to_timestamp(m.timestamp/1000.0) at time zone 'Asia/Ho_Chi_Minh')::date=day) then
      select * into daily from public.club_daily_rewards where member_id=who and reward_date=day for update;
      if found and daily.active then
        perform public.club_apply_coin(who,-50,'session_checkin_undo','Hoàn tác trận đấu: Thu hồi 50 Xu điểm danh ngày '||day,'daily_undo:'||who||':'||day||':'||daily.generation,old.id,null,true);
        update public.club_daily_rewards set active=false,generation=generation+1 where member_id=who and reward_date=day;
      end if;
    end if;
  end loop;
  for b in select * from public.bets where match_id=old.id and status<>'refunded' order by id for update loop
    reward := case when b.status='won' then b.amount-b.potential_payout else b.amount end;
    perform public.club_apply_coin(b.member_id,reward,'bet_refund','Hoàn tác trận đấu: Hoàn cược và thu hồi thưởng','bet_undo:'||b.id,old.id,b.id,true);
    update public.bets set status='refunded' where id=b.id;
  end loop;
  return old;
end $$;
drop trigger if exists club_match_coins on public.matches;
create trigger club_match_coins after insert or delete on public.matches for each row execute function public.club_match_coins();

create or replace function public.club_buy_item(p_id text,p_member_id text,p_item_id text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare price integer; kind text; inv public.user_inventory; balance integer;
begin
  select p,k into price,kind from (values
    ('grip',150,'consumable'),('elo_shield',120,'perk'),('frame_carbon',500,'frame'),
    ('frame_rainbow',600,'frame'),('frame_sakura',700,'frame'),('frame_moon',800,'frame'),
    ('frame_neon',1100,'frame'),('frame_water',1300,'frame'),('frame_fire',1500,'frame'),
    ('frame_diamond',1650,'frame'),('frame_gold',1800,'frame'),('frame_glory_wings',2000,'frame'),
    ('frame_master_econ',9999,'frame'),('frame_ribbon_2010',0,'frame')) catalog(id,p,k) where id=p_item_id;
  if price is null or length(p_id)<8 then raise exception 'Vật phẩm/yêu cầu không hợp lệ'; end if;
  perform 1 from public.members where id=p_member_id for update;
  if exists(select 1 from public.coin_transactions where operation_key='purchase:'||p_id and member_id=p_member_id) then
    return jsonb_build_object('balance_after',(select coins from public.members where id=p_member_id));
  end if;
  select * into inv from public.user_inventory where member_id=p_member_id and item_id=p_item_id order by id limit 1 for update;
  if found and kind='frame' then raise exception 'Bạn đã sở hữu khung Avatar này'; end if;
  balance := public.club_apply_coin(p_member_id,-price,'shop_purchase','Mua vật phẩm Cửa hàng: '||p_item_id,'purchase:'||p_id);
  if inv.id is null then
    insert into public.user_inventory(id,member_id,item_id,item_type,quantity,status)
    values('inv_'||gen_random_uuid()::text,p_member_id,p_item_id,kind,1,'available');
  else update public.user_inventory set quantity=quantity+1,updated_at=now() where id=inv.id;
  end if;
  return jsonb_build_object('balance_after',balance);
end $$;

-- Existing clients cannot bypass settlement or overwrite an already paid ledger.
revoke insert,update,delete on public.coin_transactions,public.bets from anon,authenticated;
revoke insert,update,delete on public.live_court from anon,authenticated;
revoke all on public.club_daily_rewards from anon,authenticated;
revoke all on function public.club_place_bet(text,text,text,text,text,integer,numeric) from public;
revoke all on function public.club_buy_item(text,text,text) from public;
revoke all on function public.club_save_court(jsonb,text) from public;
grant execute on function public.club_place_bet(text,text,text,text,text,integer,numeric) to anon,authenticated;
grant execute on function public.club_buy_item(text,text,text) to anon,authenticated;
grant execute on function public.club_save_court(jsonb,text) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
