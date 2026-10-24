-- Automatic gifts update only inventory/cosmetics, never cached Elo or stats.
begin;
create or replace function public.club_gift_october20() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.members; meta jsonb; items jsonb; gift jsonb; total integer:=0;
begin
  for m in select * from public.members where gender='female' order by id for update loop
    meta:=public.club_meta(m.phone);
    items:=case when jsonb_typeof(meta->'inventory')='array' then meta->'inventory' else '[]'::jsonb end;
    gift:=jsonb_build_object('id','inv_'||m.id||'_frame_ribbon_2010','memberId',m.id,
      'itemId','frame_ribbon_2010','itemType','frame','quantity',1,'status','available',
      'createdAt','2026-10-20T00:00:00.000Z','updatedAt',clock_timestamp());
    if not exists(select 1 from jsonb_array_elements(items) i where i->>'itemId'='frame_ribbon_2010') then
      meta:=jsonb_set(meta,'{inventory}',items||jsonb_build_array(gift));
    end if;
    if coalesce(meta->>'activeFrame','')='' then
      meta:=jsonb_set(meta,'{activeFrame}','"frame_ribbon_2010"'::jsonb);
    end if;
    if meta is distinct from public.club_meta(m.phone) then
      update public.members set phone=meta::text where id=m.id;
    end if;
    insert into public.user_inventory(id,member_id,item_id,item_type,quantity,status)
    select 'inv_'||m.id||'_frame_ribbon_2010',m.id,'frame_ribbon_2010','frame',1,'available'
    where not exists(select 1 from public.user_inventory where member_id=m.id and item_id='frame_ribbon_2010')
    on conflict(id) do nothing;
    total:=total+1;
  end loop;
  return total;
end $$;
revoke all on function public.club_gift_october20() from public;
grant execute on function public.club_gift_october20() to anon,authenticated;
notify pgrst, 'reload schema';
commit;
