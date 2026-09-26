-- Harvestar AI — saved assistant chats
-- Apply after 0001_init.sql (`npx supabase db push` or the SQL editor). Safe to re-run.
-- Each conversation is private to the user who created it (row-level security).

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  farm_id text references public.farms (id) on delete set null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  -- Last message, trimmed to ~140 chars, for the history list
  preview text not null default '',
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  -- Bumped by the app on every new message, rename and pin
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source text check (source in ('ai-service', 'llm', 'offline')),
  model text,
  as_of date,           -- the day the answer was grounded on
  insight_id text,      -- ai_insights ids can be synthetic in demo mode, so no FK
  feedback text check (feedback in ('up', 'down')),
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security: every user sees and changes only their own chats.
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own conversations" on public.conversations;
create policy "own conversations" on public.conversations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

grant select, insert, update, delete on public.conversations, public.messages to authenticated;
revoke all on public.conversations, public.messages from anon;
