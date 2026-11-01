-- Future matches only: an enabled shield is consumed on a win or a loss.
-- Wins receive full Elo; losses retain the existing 50% discount and rounding.
-- Historical playerResults still drive undo, including returning the exact card.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(hashtext('club-all-courts'));
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
    -- per_match_shield_v1: consume one enabled shield for either result.
    if coalesce((player->>'shield')::boolean,false) then
      select * into shield from public.user_inventory where member_id=who and item_id='elo_shield' and quantity>0 order by id limit 1 for update;
      if found then
        used:=true;
        if not won and delta<0 then delta:=least(-1,floor(delta*0.5+0.5)::integer); end if;
      end if;
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
        if not found or shield.quantity<1 then raise exception 'Thẻ bảo vệ đã thay đổi. Vui lòng tải lại.'; end if;
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

commit;
