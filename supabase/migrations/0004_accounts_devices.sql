-- Harvestar AI — real accounts own their farms, and ESP32 devices send readings over Wi-Fi
-- Apply after 0003_insight_sections.sql (`npx supabase db push` or the SQL editor). Safe to re-run.
--
-- * farms.owner_id: the account that created the farm. NULL = the shared demo farms from `npm run seed`
--   (only the demo account is shown those). Real accounts see only their own farms, devices and readings.
-- * devices: one row per ESP32. The device authenticates with a token (only its SHA-256 is stored)
--   that it gets by claiming a short pairing code (POST /api/device/pair).
-- * sensor_readings is unique per farm + probe + time (probe ids like "ESP32-1" repeat across farms).
-- * reading_series(): readings bucketed in the database for the charts (GET /api/readings/series).

-- ---------------------------------------------------------------------------
-- Clean up an earlier draft of this schema (a `devices` table without pairing codes, per-user
-- settings, a weather cache table and three functions), so the objects below are created as the
-- app expects them. Nothing here touches farms or readings.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.devices') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'devices' and column_name = 'pairing_code'
  ) then
    drop table public.devices cascade;
  end if;
end $$;
drop table if exists public.user_settings cascade;
drop table if exists public.app_cache cascade;
drop function if exists public.readings_series(text, timestamptz, timestamptz, integer);
drop function if exists public.device_for_key(text);
drop function if exists public.device_report(text, jsonb, jsonb);
drop policy if exists "Owners manage their farms" on public.farms;
drop policy if exists "Owners read their readings" on public.sensor_readings;
drop policy if exists "Owners read their insights" on public.ai_insights;

-- ---------------------------------------------------------------------------
-- Farm ownership
-- ---------------------------------------------------------------------------
alter table public.farms
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;

create index if not exists farms_owner_idx on public.farms (owner_id);

-- Crops the app knows (lib/agronomy-tables.ts); re-created so it matches the app's list.
alter table public.farms drop constraint if exists farms_main_crop_check;
alter table public.farms add constraint farms_main_crop_check
  check (main_crop in ('tomato', 'cucumber', 'sweet_pepper', 'eggplant', 'zucchini', 'alfalfa'));

-- ---------------------------------------------------------------------------
-- Devices (ESP32 probes)
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  farm_id text not null references public.farms (id) on delete cascade,
  name text not null default 'ESP32 probe',
  -- The probe id its readings are stored under (unique per farm), e.g. 'ESP32-1'
  sensor_id text not null,
  lat double precision,
  lng double precision,
  -- How often the device sends a reading; returned to it on every upload
  interval_s integer not null default 10 check (interval_s between 5 and 3600),
  token_hash text not null unique,
  token_hint text not null default '',
  pairing_code text unique,
  pairing_expires_at timestamptz,
  created_at timestamptz not null default now(),
  paired_at timestamptz,
  last_seen_at timestamptz,
  firmware text,
  rssi integer,
  local_ip text,
  readings_count bigint not null default 0,
  unique (farm_id, sensor_id)
);

create index if not exists devices_owner_idx on public.devices (owner_id);

-- ---------------------------------------------------------------------------
-- Readings: unique per farm, probe and time
-- ---------------------------------------------------------------------------
alter table public.sensor_readings drop constraint if exists sensor_readings_sensor_id_timestamp_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname in ('sensor_readings_farm_sensor_time_key', 'sensor_readings_farm_sensor_timestamp_key')
  ) then
    alter table public.sensor_readings
      add constraint sensor_readings_farm_sensor_time_key unique (farm_id, sensor_id, "timestamp");
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: your own farms (plus the shared demo farms, which hold only demo data)
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;

drop policy if exists "Signed-in users can read farms" on public.farms;
drop policy if exists "read own or demo farms" on public.farms;
create policy "read own or demo farms" on public.farms
  for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

drop policy if exists "write own farms" on public.farms;
create policy "write own farms" on public.farms
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Signed-in users can read readings" on public.sensor_readings;
drop policy if exists "read readings of visible farms" on public.sensor_readings;
create policy "read readings of visible farms" on public.sensor_readings
  for select to authenticated
  using (exists (
    select 1 from public.farms f
    where f.id = sensor_readings.farm_id and (f.owner_id is null or f.owner_id = (select auth.uid()))
  ));

drop policy if exists "Signed-in users can read insights" on public.ai_insights;
drop policy if exists "read insights of visible farms" on public.ai_insights;
create policy "read insights of visible farms" on public.ai_insights
  for select to authenticated
  using (exists (
    select 1 from public.farms f
    where f.id = ai_insights.farm_id and (f.owner_id is null or f.owner_id = (select auth.uid()))
  ));

drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.farms, public.devices to authenticated;
revoke all on public.devices from anon;

-- ---------------------------------------------------------------------------
-- Chart buckets: count, mean, min and max per probe and time bucket (aligned to Qatar time)
-- ---------------------------------------------------------------------------
create or replace function public.reading_series(
  p_farm_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_seconds integer
)
returns table (
  sensor_id text,
  bucket timestamptz,
  n integer,
  first_ts timestamptz,
  last_ts timestamptz,
  moisture_n integer, moisture_avg double precision, moisture_min double precision, moisture_max double precision,
  temperature_n integer, temperature_avg double precision, temperature_min double precision, temperature_max double precision,
  ec_n integer, ec_avg double precision, ec_min double precision, ec_max double precision,
  ph_n integer, ph_avg double precision, ph_min double precision, ph_max double precision,
  n_n integer, n_avg double precision, n_min double precision, n_max double precision,
  p_n integer, p_avg double precision, p_min double precision, p_max double precision,
  k_n integer, k_avg double precision, k_min double precision, k_max double precision,
  air_temp_n integer, air_temp_avg double precision, air_temp_min double precision, air_temp_max double precision,
  air_humidity_n integer, air_humidity_avg double precision, air_humidity_min double precision, air_humidity_max double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.sensor_id,
    date_bin(make_interval(secs => greatest(p_bucket_seconds, 1)), r."timestamp", timestamptz '2000-01-01 00:00:00+03') as bucket,
    count(*)::integer,
    min(r."timestamp"),
    max(r."timestamp"),
    count(r.moisture)::integer, avg(r.moisture)::float8, min(r.moisture)::float8, max(r.moisture)::float8,
    count(r.temperature)::integer, avg(r.temperature)::float8, min(r.temperature)::float8, max(r.temperature)::float8,
    count(r.ec)::integer, avg(r.ec)::float8, min(r.ec)::float8, max(r.ec)::float8,
    count(r.ph)::integer, avg(r.ph)::float8, min(r.ph)::float8, max(r.ph)::float8,
    count(r.n)::integer, avg(r.n)::float8, min(r.n)::float8, max(r.n)::float8,
    count(r.p)::integer, avg(r.p)::float8, min(r.p)::float8, max(r.p)::float8,
    count(r.k)::integer, avg(r.k)::float8, min(r.k)::float8, max(r.k)::float8,
    count(r.air_temp)::integer, avg(r.air_temp)::float8, min(r.air_temp)::float8, max(r.air_temp)::float8,
    count(r.air_humidity)::integer, avg(r.air_humidity)::float8, min(r.air_humidity)::float8, max(r.air_humidity)::float8
  from public.sensor_readings r
  where r.farm_id = p_farm_id and r."timestamp" >= p_from and r."timestamp" < p_to
  group by 1, 2
  order by 2, 1
  limit 200000;
$$;

-- Functions are executable by PUBLIC by default: allow only signed-in users and the server.
revoke all on function public.reading_series(text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.reading_series(text, timestamptz, timestamptz, integer) to authenticated, service_role;
