-- Yield AI — accounts own their data, ESP32 devices, settings and the weather cache.
-- Apply after 0001_init.sql (`npx supabase db push`, or paste into the SQL editor).
--
-- * Every farm belongs to one account (owner_id); accounts only see their own farms, readings,
--   insights and devices. The shared demo account uses the app's built-in demo dataset, so the
--   8 demo farms that `npm run seed` used to load are removed here.
-- * ESP32 devices authenticate with a per-device key; only its SHA-256 is stored.

-- ---------------------------------------------------------------------------
-- Farm ownership
-- ---------------------------------------------------------------------------
alter table public.farms add column if not exists owner_id uuid references auth.users (id) on delete cascade;
create index if not exists farms_owner_idx on public.farms (owner_id);

-- Remove the old seeded demo farms (their readings and insights cascade).
delete from public.farms
where owner_id is null
  and id in (
    'khor-north', 'khor-pivot', 'shamal-greenhouses', 'shamal-east',
    'ummsalal-west', 'ummsalal-east', 'sheehaniya-west', 'sheehaniya-south'
  );

-- Probe ids are unique per farm, not globally (two accounts can both have "AKF-01").
alter table public.sensor_readings drop constraint if exists sensor_readings_sensor_id_timestamp_key;
alter table public.sensor_readings drop constraint if exists sensor_readings_farm_sensor_timestamp_key;
alter table public.sensor_readings
  add constraint sensor_readings_farm_sensor_timestamp_key unique (farm_id, sensor_id, "timestamp");
create index if not exists sensor_readings_farm_id_idx on public.sensor_readings (farm_id, id);

-- ---------------------------------------------------------------------------
-- ESP32 devices
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  farm_id text not null references public.farms (id) on delete cascade,
  name text not null,
  sensor_id text not null,
  lat double precision not null,
  lng double precision not null,
  token_hash text not null unique,
  token_hint text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_reading_at timestamptz,
  last_ip text,
  rssi integer,
  firmware text,
  last_error text,
  -- The latest measurement, for status cards: { timestamp, moisture, temperature, ec, ph, n, p, k, ... }
  last_reading jsonb,
  unique (farm_id, sensor_id)
);
create index if not exists devices_owner_idx on public.devices (owner_id);

-- ---------------------------------------------------------------------------
-- Account settings
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- How often devices report and the dashboard refreshes (seconds).
  reading_interval_s integer not null default 10 check (reading_interval_s between 5 and 3600),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Small server cache (the 12-hourly weather forecast). Server (service role) only.
-- ---------------------------------------------------------------------------
create table if not exists public.app_cache (
  key text primary key,
  fetched_at timestamptz not null,
  payload jsonb not null
);

-- ---------------------------------------------------------------------------
-- Reading series for the readings explorer: means per probe and time bucket.
-- Mirrors bucketReadings() in lib/data/series.ts.
-- ---------------------------------------------------------------------------
create or replace function public.readings_series(
  p_farm_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_s integer
)
returns table (
  sensor_id text,
  t timestamptz,
  count integer,
  moisture double precision,
  temperature double precision,
  ec double precision,
  ph double precision,
  n double precision,
  p double precision,
  k double precision,
  air_temp double precision,
  air_humidity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.sensor_id,
    to_timestamp(floor(extract(epoch from r."timestamp") / greatest(p_bucket_s, 1)) * greatest(p_bucket_s, 1)) as t,
    count(*)::integer,
    avg(r.moisture)::double precision,
    avg(r.temperature)::double precision,
    avg(r.ec)::double precision,
    avg(r.ph)::double precision,
    avg(r.n)::double precision,
    avg(r.p)::double precision,
    avg(r.k)::double precision,
    avg(r.air_temp)::double precision,
    avg(r.air_humidity)::double precision
  from public.sensor_readings r
  where r.farm_id = p_farm_id
    and r."timestamp" >= p_from
    and r."timestamp" < p_to
  group by r.sensor_id, 2
  order by 2, r.sensor_id;
$$;

revoke all on function public.readings_series(text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.readings_series(text, timestamptz, timestamptz, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security: each account reads and writes only its own rows. Device ingest and
-- the weather cache go through the server's service role.
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.user_settings enable row level security;
alter table public.app_cache enable row level security;

drop policy if exists "Signed-in users can read farms" on public.farms;
drop policy if exists "Owners manage their farms" on public.farms;
create policy "Owners manage their farms" on public.farms
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Signed-in users can read readings" on public.sensor_readings;
drop policy if exists "Owners read their readings" on public.sensor_readings;
create policy "Owners read their readings" on public.sensor_readings
  for select to authenticated
  using (farm_id in (select f.id from public.farms f where f.owner_id = (select auth.uid())));

drop policy if exists "Signed-in users can read insights" on public.ai_insights;
drop policy if exists "Owners read their insights" on public.ai_insights;
create policy "Owners read their insights" on public.ai_insights
  for select to authenticated
  using (farm_id in (select f.id from public.farms f where f.owner_id = (select auth.uid())));

drop policy if exists "Owners manage their devices" on public.devices;
create policy "Owners manage their devices" on public.devices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and farm_id in (select f.id from public.farms f where f.owner_id = (select auth.uid()))
  );

drop policy if exists "Owners manage their settings" on public.user_settings;
create policy "Owners manage their settings" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
