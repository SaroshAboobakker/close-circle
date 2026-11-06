-- Close Circle shared data and media setup (safe to run more than once).
create table if not exists public.circle_state (
  id text primary key check (id = 'main'),
  state jsonb not null default '{"posts":[],"events":[],"ideas":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.circle_state enable row level security;
grant select, insert, update on public.circle_state to anon, authenticated;

drop policy if exists "Circle members can read shared state" on public.circle_state;
create policy "Circle members can read shared state"
  on public.circle_state for select to anon, authenticated using (id = 'main');
drop policy if exists "Circle members can create shared state" on public.circle_state;
create policy "Circle members can create shared state"
  on public.circle_state for insert to anon, authenticated with check (id = 'main');
drop policy if exists "Circle members can update shared state" on public.circle_state;
create policy "Circle members can update shared state"
  on public.circle_state for update to anon, authenticated using (id = 'main') with check (id = 'main');

create or replace function public.merge_circle_records(old_rows jsonb, new_rows jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  result jsonb := coalesce(old_rows, '[]'::jsonb);
  candidate jsonb;
  previous jsonb;
  merged jsonb;
  merged_votes jsonb;
  merged_voters jsonb;
  idx integer;
begin
  for candidate in select value from jsonb_array_elements(coalesce(new_rows, '[]'::jsonb)) loop
    previous := null;
    for idx in 0..jsonb_array_length(result) - 1 loop
      if (result -> idx ->> 'id') = (candidate ->> 'id') then
        previous := result -> idx;
        exit;
      end if;
    end loop;

    if previous is null then
      result := result || jsonb_build_array(candidate);
    else
      merged := previous || candidate;
      if jsonb_typeof(previous -> 'votes') = 'object' or jsonb_typeof(candidate -> 'votes') = 'object' then
        merged_votes := coalesce(previous -> 'votes', '{}'::jsonb) || coalesce(candidate -> 'votes', '{}'::jsonb);
        merged := jsonb_set(merged, '{votes}', merged_votes, true);
      end if;
      if jsonb_typeof(previous -> 'voters') = 'array' or jsonb_typeof(candidate -> 'voters') = 'array' then
        select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into merged_voters
        from (
          select distinct value #>> '{}' as v
          from jsonb_array_elements(coalesce(previous -> 'voters', '[]'::jsonb) || coalesce(candidate -> 'voters', '[]'::jsonb)) as voter(value)
        ) as distinct_voters;
        merged := jsonb_set(merged, '{voters}', merged_voters, true);
        merged := jsonb_set(merged, '{votes}', to_jsonb(jsonb_array_length(merged_voters)), true);
      end if;
      if jsonb_typeof(previous #> '{event,votes}') = 'object' or jsonb_typeof(candidate #> '{event,votes}') = 'object' then
        merged_votes := coalesce(previous #> '{event,votes}', '{}'::jsonb) || coalesce(candidate #> '{event,votes}', '{}'::jsonb);
        merged := jsonb_set(merged, '{event,votes}', merged_votes, true);
      end if;
      select coalesce(jsonb_agg(value order by ordinality desc), '[]'::jsonb) into merged_votes
      from jsonb_array_elements(result) with ordinality as entry(value, ordinality)
      where (value ->> 'id') <> (candidate ->> 'id');
      result := merged_votes || jsonb_build_array(merged);
    end if;
  end loop;

  select coalesce(jsonb_agg(value order by coalesce(value ->> 'createdAt', value ->> 'id') desc), '[]'::jsonb)
    into result from jsonb_array_elements(result) as entry(value);
  return result;
end;
$$;

create or replace function public.merge_circle_state(incoming_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_state jsonb;
begin
  insert into public.circle_state (id, state, updated_at)
  values ('main', coalesce(incoming_state, '{"posts":[],"events":[],"ideas":[]}'::jsonb), now())
  on conflict (id) do update
  set state = jsonb_build_object(
    'posts', public.merge_circle_records(public.circle_state.state -> 'posts', incoming_state -> 'posts'),
    'events', public.merge_circle_records(public.circle_state.state -> 'events', incoming_state -> 'events'),
    'ideas', public.merge_circle_records(public.circle_state.state -> 'ideas', incoming_state -> 'ideas')
  ), updated_at = now()
  returning state into saved_state;
  return saved_state;
end;
$$;

grant execute on function public.merge_circle_records(jsonb, jsonb) to anon, authenticated;
grant execute on function public.merge_circle_state(jsonb) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'circle_state'
  ) then
    alter publication supabase_realtime add table public.circle_state;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'circle-media', 'circle-media', true, 52428800,
  array['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm']
)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Circle can upload media" on storage.objects;
create policy "Circle can upload media"
  on storage.objects for insert to anon, authenticated with check (bucket_id = 'circle-media');
