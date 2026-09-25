-- Yield AI — ESP32 ingest that needs only the project's publishable (anon) key.
-- Apply after 0002_accounts_devices.sql.
--
-- An ESP32 is not a signed-in user, so row-level security gives it no rows. These two functions
-- are its way in: every call carries the device key itself, which is hashed here and compared
-- with devices.token_hash. Only hashes are stored, so a copy of the database still cannot be used
-- to post readings. They are callable by `anon` on purpose (the app server calls them with the
-- publishable key when SUPABASE_SERVICE_ROLE_KEY is not set); keys are 192-bit random, so the
-- lookup cannot be guessed.

-- ---------------------------------------------------------------------------
-- The device a key belongs to, with its owner's reading interval.
-- ---------------------------------------------------------------------------
create or replace function public.device_for_key(p_key text)
returns table (
  id text,
  owner_id uuid,
  farm_id text,
  name text,
  sensor_id text,
  lat double precision,
  lng double precision,
  token_hint text,
  created_at timestamptz,
  last_seen_at timestamptz,
  last_reading_at timestamptz,
  last_ip text,
  rssi integer,
  firmware text,
  last_error text,
  last_reading jsonb,
  reading_interval_s integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id, d.owner_id, d.farm_id, d.name, d.sensor_id, d.lat, d.lng, d.token_hint, d.created_at,
    d.last_seen_at, d.last_reading_at, d.last_ip, d.rssi, d.firmware, d.last_error, d.last_reading,
    coalesce(s.reading_interval_s, 10)
  from public.devices d
  left join public.user_settings s on s.user_id = d.owner_id
  where length(p_key) between 20 and 100
    and d.token_hash = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Store a device's readings under its own farm and probe, and record the contact.
--
-- p_readings: [{ timestamp, moisture, temperature, ec, ph, n, p, k, air_temp, air_humidity }]
--             (at most 500; the app has already validated them — rows outside the same ranges
--             are dropped here too, for callers that skip the app)
-- p_contact:  { ip, rssi, firmware, error }
-- Returns how many readings were new (duplicates of farm, probe and timestamp are skipped).
-- ---------------------------------------------------------------------------
create or replace function public.device_report(p_key text, p_readings jsonb, p_contact jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  readings jsonb := coalesce(p_readings, '[]'::jsonb);
  contact jsonb := coalesce(p_contact, '{}'::jsonb);
  inserted integer;
  latest jsonb;
begin
  select * into d
  from public.devices
  where length(p_key) between 20 and 100
    and token_hash = encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex');
  if not found then
    raise exception 'unknown device key' using errcode = '28000';
  end if;
  if (case when jsonb_typeof(readings) = 'array' then jsonb_array_length(readings) > 500 else true end) then
    raise exception 'p_readings must be an array of at most 500 readings' using errcode = '22023';
  end if;
  if jsonb_typeof(contact) <> 'object' then
    raise exception 'p_contact must be an object' using errcode = '22023';
  end if;

  with valid as (
    select r.*
    from jsonb_to_recordset(readings) as r(
      "timestamp" timestamptz,
      moisture real,
      temperature real,
      ec real,
      ph real,
      n real,
      p real,
      k real,
      air_temp real,
      air_humidity real
    )
    where r."timestamp" >= now() - interval '60 days'
      and r."timestamp" <= now() + interval '5 minutes'
      and num_nonnulls(r.moisture, r.temperature, r.ec, r.ph, r.n, r.p, r.k, r.air_temp, r.air_humidity) > 0
      and (r.moisture is null or r.moisture between 0 and 100)
      and (r.temperature is null or r.temperature between -40 and 80)
      and (r.ec is null or r.ec between 0 and 100)
      and (r.ph is null or r.ph between 0 and 14)
      and (r.n is null or r.n between 0 and 5000)
      and (r.p is null or r.p between 0 and 5000)
      and (r.k is null or r.k between 0 and 10000)
      and (r.air_temp is null or r.air_temp between -40 and 70)
      and (r.air_humidity is null or r.air_humidity between 0 and 100)
  ),
  ins as (
    insert into public.sensor_readings
      (farm_id, sensor_id, lat, lng, "timestamp", moisture, temperature, ec, ph, n, p, k, air_temp, air_humidity)
    select d.farm_id, d.sensor_id, d.lat, d.lng, v."timestamp", v.moisture, v.temperature, v.ec, v.ph, v.n, v.p, v.k,
           v.air_temp, v.air_humidity
    from valid v
    on conflict (farm_id, sensor_id, "timestamp") do nothing
    returning 1
  )
  select
    (select count(*)::integer from ins),
    (select to_jsonb(v) from valid v order by v."timestamp" desc limit 1)
  into inserted, latest;

  update public.devices set
    last_seen_at = now(),
    last_ip = left(contact ->> 'ip', 64),
    last_error = left(contact ->> 'error', 200),
    rssi = coalesce(round((contact ->> 'rssi')::numeric)::integer, rssi),
    firmware = coalesce(nullif(left(contact ->> 'firmware', 40), ''), firmware),
    last_reading_at = case
      when latest is not null and (last_reading_at is null or (latest ->> 'timestamp')::timestamptz > last_reading_at)
        then (latest ->> 'timestamp')::timestamptz
      else last_reading_at
    end,
    last_reading = case
      when latest is not null and (last_reading_at is null or (latest ->> 'timestamp')::timestamptz >= last_reading_at)
        then latest
      else last_reading
    end
  where id = d.id;

  return inserted;
end;
$$;

revoke all on function public.device_for_key(text) from public;
revoke all on function public.device_report(text, jsonb, jsonb) from public;
grant execute on function public.device_for_key(text) to anon, authenticated, service_role;
grant execute on function public.device_report(text, jsonb, jsonb) to anon, authenticated, service_role;
