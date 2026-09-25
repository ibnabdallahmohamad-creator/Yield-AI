-- Yield AI — per-user farms and registered sensors.
-- Apply after 0001_init.sql (`npx supabase db push`, or paste into the SQL editor).
--
-- Farms seeded by `npm run seed` keep owner_id = null: they are the shared demo farms shown to the
-- demo account. Every other account starts empty and only sees the farms it created.

alter table public.farms add column if not exists owner_id text;
create index if not exists farms_owner_idx on public.farms (owner_id);

comment on column public.farms.owner_id is
  'Owner of the farm (Supabase auth user id, or local-… for local accounts). null = shared demo farm.';

-- ---------------------------------------------------------------------------
-- Sensors (probes) registered on a farm, with their position. Readings posted to
-- /api/readings for a registered sensor default to this position.
-- ---------------------------------------------------------------------------
create table if not exists public.sensors (
  id text primary key,
  farm_id text not null references public.farms (id) on delete cascade,
  label text not null default '',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

create index if not exists sensors_farm_idx on public.sensors (farm_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: a signed-in user sees the demo farms and their own farms (and the
-- readings, insights and sensors that belong to them). Writes go through the server with the
-- service role, which bypasses RLS; the insert/delete policies below let a Supabase-authenticated
-- user manage their own farms directly too.
-- ---------------------------------------------------------------------------
alter table public.sensors enable row level security;

drop policy if exists "Signed-in users can read farms" on public.farms;
drop policy if exists "Read demo farms and your own" on public.farms;
create policy "Read demo farms and your own" on public.farms
  for select to authenticated using (owner_id is null or owner_id = auth.uid()::text);

drop policy if exists "Create your own farms" on public.farms;
create policy "Create your own farms" on public.farms
  for insert to authenticated with check (owner_id = auth.uid()::text);

drop policy if exists "Delete your own farms" on public.farms;
create policy "Delete your own farms" on public.farms
  for delete to authenticated using (owner_id = auth.uid()::text);

drop policy if exists "Signed-in users can read readings" on public.sensor_readings;
drop policy if exists "Read readings of visible farms" on public.sensor_readings;
create policy "Read readings of visible farms" on public.sensor_readings
  for select to authenticated using (
    exists (select 1 from public.farms f where f.id = farm_id and (f.owner_id is null or f.owner_id = auth.uid()::text))
  );

drop policy if exists "Signed-in users can read insights" on public.ai_insights;
drop policy if exists "Read insights of visible farms" on public.ai_insights;
create policy "Read insights of visible farms" on public.ai_insights
  for select to authenticated using (
    exists (select 1 from public.farms f where f.id = farm_id and (f.owner_id is null or f.owner_id = auth.uid()::text))
  );

drop policy if exists "Read sensors of visible farms" on public.sensors;
create policy "Read sensors of visible farms" on public.sensors
  for select to authenticated using (
    exists (select 1 from public.farms f where f.id = farm_id and (f.owner_id is null or f.owner_id = auth.uid()::text))
  );

drop policy if exists "Manage sensors on your farms" on public.sensors;
create policy "Manage sensors on your farms" on public.sensors
  for all to authenticated
  using (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()::text))
  with check (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()::text));
