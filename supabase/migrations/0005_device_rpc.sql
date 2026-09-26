-- Harvestar AI — ESP32 pairing and ingest that work with only the project's publishable (anon) key
-- Apply after 0004_accounts_devices.sql (`npx supabase db push` or the SQL editor). Safe to re-run.
--
-- An ESP32 is not a signed-in user, so row-level security gives it nothing. When the server has no
-- SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY), lib/account/supabase-store.ts calls these three
-- functions instead. Each one takes the device's own token (192-bit random, hashed here with the same
-- SHA-256 hex as lib/account/secrets.ts) or a live pairing code, so a caller can only ever reach its
-- own device. Only token hashes are stored.
--
-- Also lets a signed-in account insert readings into its own farms (e.g. the test account's probes).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- The device a token belongs to
-- ---------------------------------------------------------------------------
create or replace function public.device_by_token(p_token text)
returns setof public.devices
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
  from public.devices d
  where length(btrim(p_token)) between 20 and 100
    and d.token_hash = encode(extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex')
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Claim a pairing code: the device gets its new token (hashed here), the code is cleared
-- ---------------------------------------------------------------------------
create or replace function public.device_claim_pairing(
  p_code text,
  p_token text,
  p_hint text,
  p_firmware text default null,
  p_rssi integer default null,
  p_local_ip text default null
)
returns setof public.devices
language sql
volatile
security definer
set search_path = ''
as $$
  update public.devices set
    token_hash = encode(extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex'),
    token_hint = left(coalesce(p_hint, ''), 8),
    pairing_code = null,
    pairing_expires_at = null,
    paired_at = now(),
    firmware = coalesce(nullif(left(p_firmware, 40), ''), firmware),
    rssi = coalesce(p_rssi, rssi),
    local_ip = coalesce(nullif(left(p_local_ip, 45), ''), local_ip)
  where length(p_code) = 8
    and length(btrim(p_token)) between 20 and 100
    and pairing_code = upper(p_code)
    and pairing_expires_at > now()
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Store a device's readings under its own farm and probe, and mark it seen.
-- p_readings: [{ timestamp, lat?, lng? (default: the device's, then the farm's position), moisture, temperature, ec, ph, n, p, k, air_temp, air_humidity }]
-- (at most 500, already validated by the app; out-of-range rows are dropped here too).
-- Returns how many readings were new (duplicates of farm, probe and time are skipped).
-- ---------------------------------------------------------------------------
create or replace function public.device_record_readings(
  p_token text,
  p_readings jsonb,
  p_firmware text default null,
  p_rssi integer default null,
  p_local_ip text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  inserted integer := 0;
  farm_lat double precision;
  farm_lng double precision;
begin
  select * into d
  from public.devices
  where length(btrim(p_token)) between 20 and 100
    and token_hash = encode(extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex');
  if not found then
    raise exception 'unknown device token' using errcode = '28000';
  end if;
  if jsonb_typeof(coalesce(p_readings, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_readings, '[]'::jsonb)) > 500 then
    raise exception 'p_readings must be an array of at most 500 readings' using errcode = '22023';
  end if;
  select f.lat, f.lng into farm_lat, farm_lng from public.farms f where f.id = d.farm_id;

  with valid as (
    select r.*
    from jsonb_to_recordset(coalesce(p_readings, '[]'::jsonb)) as r(
      "timestamp" timestamptz, lat double precision, lng double precision,
      moisture real, temperature real, ec real, ph real, n real, p real, k real, air_temp real, air_humidity real
    )
    where r."timestamp" is not null
      and r."timestamp" >= now() - interval '31 days'
      and r."timestamp" <= now() + interval '5 minutes'
      and num_nonnulls(r.moisture, r.temperature, r.ec, r.ph, r.n, r.p, r.k, r.air_temp, r.air_humidity) > 0
      and (r.moisture is null or r.moisture between 0 and 100)
      and (r.temperature is null or r.temperature between -20 and 80)
      and (r.ec is null or r.ec between 0 and 100)
      and (r.ph is null or r.ph between 0 and 14)
      and (r.n is null or r.n between 0 and 5000)
      and (r.p is null or r.p between 0 and 5000)
      and (r.k is null or r.k between 0 and 10000)
      and (r.air_temp is null or r.air_temp between -20 and 70)
      and (r.air_humidity is null or r.air_humidity between 0 and 100)
  ),
  ins as (
    insert into public.sensor_readings
      (farm_id, sensor_id, lat, lng, "timestamp", moisture, temperature, ec, ph, n, p, k, air_temp, air_humidity)
    select d.farm_id, d.sensor_id, coalesce(v.lat, d.lat, farm_lat, 0), coalesce(v.lng, d.lng, farm_lng, 0), v."timestamp",
           v.moisture, v.temperature, v.ec, v.ph, v.n, v.p, v.k, v.air_temp, v.air_humidity
    from valid v
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into inserted from ins;

  update public.devices set
    last_seen_at = now(),
    paired_at = coalesce(paired_at, now()),
    pairing_code = null,
    pairing_expires_at = null,
    readings_count = readings_count + inserted,
    firmware = coalesce(nullif(left(p_firmware, 40), ''), firmware),
    rssi = coalesce(p_rssi, rssi),
    local_ip = coalesce(nullif(left(p_local_ip, 45), ''), local_ip)
  where id = d.id;

  return inserted;
end;
$$;

revoke all on function public.device_by_token(text) from public;
revoke all on function public.device_claim_pairing(text, text, text, text, integer, text) from public;
revoke all on function public.device_record_readings(text, jsonb, text, integer, text) from public;
grant execute on function public.device_by_token(text) to anon, authenticated, service_role;
grant execute on function public.device_claim_pairing(text, text, text, text, integer, text) to anon, authenticated, service_role;
grant execute on function public.device_record_readings(text, jsonb, text, integer, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A signed-in account may add readings to its own farms
-- ---------------------------------------------------------------------------
drop policy if exists "insert readings into own farms" on public.sensor_readings;
create policy "insert readings into own farms" on public.sensor_readings
  for insert to authenticated
  with check (exists (
    select 1 from public.farms f
    where f.id = sensor_readings.farm_id and f.owner_id = (select auth.uid())
  ));

grant select, insert on public.sensor_readings to authenticated;
