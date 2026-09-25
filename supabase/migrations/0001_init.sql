-- Yield AI — database schema
-- Apply with the Supabase CLI (`npx supabase db push`) or paste into the SQL editor,
-- then apply 0002_accounts_devices.sql (accounts own their farms; ESP32 devices; settings).

-- ---------------------------------------------------------------------------
-- Farms
-- ---------------------------------------------------------------------------
create table if not exists public.farms (
  id text primary key,
  name text not null,
  owner text not null default '',
  lat double precision not null,
  lng double precision not null,
  area_ha double precision not null check (area_ha > 0),
  main_crop text not null
    check (main_crop in ('tomato', 'cucumber', 'sweet_pepper', 'eggplant', 'zucchini', 'alfalfa')),
  -- GeoJSON Polygon, coordinates in [lng, lat] order
  polygon jsonb not null,
  -- Agronomy settings used by the FAO-56 / FAO-29 engine (lib/agronomy.ts)
  region text not null default '',
  planting_date date not null default current_date,
  soil_type text not null default 'sand' check (soil_type in ('sand', 'loamy_sand')),
  theta_fc double precision check (theta_fc is null or (theta_fc > 0 and theta_fc < 1)),
  theta_wp double precision check (theta_wp is null or (theta_wp > 0 and theta_wp < 1)),
  elevation_m double precision not null default 10,
  ec_calibration_factor double precision not null default 3.0 check (ec_calibration_factor > 0),
  irrigation_water_ec double precision not null default 1.5 check (irrigation_water_ec >= 0),
  created_at timestamptz not null default now()
);

comment on column public.farms.ec_calibration_factor is
  'ECe (saturated paste) ≈ factor × probe bulk EC; fit from paired lab samples';
comment on column public.farms.irrigation_water_ec is 'Irrigation water salinity ECw, dS/m';

-- ---------------------------------------------------------------------------
-- Probe readings
-- ---------------------------------------------------------------------------
create table if not exists public.sensor_readings (
  id bigint generated always as identity primary key,
  farm_id text not null references public.farms (id) on delete cascade,
  sensor_id text not null,
  lat double precision not null,
  lng double precision not null,
  "timestamp" timestamptz not null,
  moisture real,        -- volumetric water content, %
  temperature real,     -- soil temperature, °C
  ec real,              -- bulk soil EC, dS/m (= mS/cm)
  ph real,
  n real,               -- mg/kg
  p real,               -- mg/kg
  k real,               -- mg/kg
  air_temp real,        -- optional mast air sensor, °C
  air_humidity real,    -- optional mast air sensor, %
  unique (sensor_id, "timestamp")
);

create index if not exists sensor_readings_farm_time_idx on public.sensor_readings (farm_id, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- AI insights (written by the AI service / seed script)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  farm_id text not null references public.farms (id) on delete cascade,
  created_at timestamptz not null default now(),
  risk_score integer not null check (risk_score between 0 and 100),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  summary text not null,
  -- [{ "title": text, "detail": text, "priority": "high" | "medium" | "low" }]
  recommendations jsonb not null default '[]'::jsonb,
  -- { "crop": text, "reason": text, "market_note": text }
  crop_suggestion jsonb
);

create index if not exists ai_insights_farm_created_idx on public.ai_insights (farm_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Daily aggregates per probe (local Asia/Qatar days). Mirrors lib/data/aggregate.ts.
-- ---------------------------------------------------------------------------
create or replace view public.sensor_daily
with (security_invoker = true) as
select
  r.farm_id,
  r.sensor_id,
  (r."timestamp" at time zone 'Asia/Qatar')::date as day,
  (array_agg(r.lat order by r."timestamp" desc))[1] as lat,
  (array_agg(r.lng order by r."timestamp" desc))[1] as lng,
  count(*)::integer as n_readings,
  avg(r.moisture)::double precision as moisture,
  avg(r.temperature)::double precision as temperature,
  avg(r.ec)::double precision as ec,
  avg(r.ph)::double precision as ph,
  avg(r.n)::double precision as n,
  avg(r.p)::double precision as p,
  avg(r.k)::double precision as k,
  max(r.air_temp)::double precision as air_tmax,
  min(r.air_temp)::double precision as air_tmin,
  max(r.air_humidity)::double precision as rh_max,
  min(r.air_humidity)::double precision as rh_min,
  min(r."timestamp") as first_ts,
  max(r."timestamp") as last_ts
from public.sensor_readings r
group by r.farm_id, r.sensor_id, (r."timestamp" at time zone 'Asia/Qatar')::date;

-- ---------------------------------------------------------------------------
-- Row Level Security: every signed-in user can read; writes go through the server
-- (service role), the ingest endpoint or the AI service.
-- ---------------------------------------------------------------------------
alter table public.farms enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.ai_insights enable row level security;

drop policy if exists "Signed-in users can read farms" on public.farms;
create policy "Signed-in users can read farms" on public.farms
  for select to authenticated using (true);

drop policy if exists "Signed-in users can read readings" on public.sensor_readings;
create policy "Signed-in users can read readings" on public.sensor_readings
  for select to authenticated using (true);

drop policy if exists "Signed-in users can read insights" on public.ai_insights;
create policy "Signed-in users can read insights" on public.ai_insights
  for select to authenticated using (true);

grant select on public.sensor_daily to authenticated;
revoke all on public.sensor_daily from anon;
