-- Yield AI — report sections on ai_insights
-- Apply after 0002_conversations.sql (`npx supabase db push` or the SQL editor). Safe to re-run.
-- Shapes are defined in lib/ai/contract.ts (FindingSchema, WarningSchema, ForecastSchema,
-- EconomicsSchema, HarvestSchema). Every column is optional, so older rows and writers that leave
-- a section out still parse.

alter table public.ai_insights
  -- [{ "title": text, "detail": text }] — what the readings say
  add column if not exists insights jsonb not null default '[]'::jsonb,
  -- [{ "severity": "critical" | "warning" | "watch", "title": text, "detail": text, "when": text }]
  add column if not exists warnings jsonb not null default '[]'::jsonb,
  -- { "summary": text, "days": [{ "date": "YYYY-MM-DD", "label": text, "level": "ok" | "watch" | "warning" }] }
  add column if not exists forecast jsonb,
  -- { "summary": text, "lines": [{ "label": text, "value": text, "detail": text }], "assumptions": [text] } (QAR, indicative)
  add column if not exists economics jsonb,
  -- { "status": text, "summary": text, "window": { "start": date, "end": date | null } | null,
  --   "next_crops": [{ "crop": text, "reason": text, "plant_window": text }] }
  add column if not exists harvest jsonb;
