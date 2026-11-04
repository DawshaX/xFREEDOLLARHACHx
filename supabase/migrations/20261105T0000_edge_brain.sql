-- ─────────────────────────────────────────────────────────────────────────────
-- NOVA thinks on the database, not on GitHub's schedule.
--
-- Why: measured 2026-11-04 21:12Z → 23:30Z, the Actions crons for this repo did
-- not fire a single time — no corpus run, no brain run, while a push-triggered
-- run worked instantly. The workflow-driven brain (`scripts/nova-brain.mjs`) can
-- therefore be hours old without anyone noticing, because nothing else writes
-- `state/nova-brain-latest.json`.
--
-- So the brain got a second body: the `nova-brain` edge function, driven by the
-- `nova-brain-tick` pg_cron job every 5 minutes. It stores one document here, in
-- the same shape the workflow writes, so the panel can read either one.
--
-- Applied live 2026-11-04. This file exists so the database can be rebuilt from
-- the repo.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.nova_brain (
  id text primary key,
  doc jsonb not null,
  at timestamptz not null default now()
);

comment on table public.nova_brain is
  'One row (`main`) with the last thing NOVA thought: reply, action, the measured state it was built on, and the failures. Written by the nova-brain edge function.';

-- The server side only. The browser reaches it through the edge function, which
-- holds the service role; nobody else may read or write this table directly.
alter table public.nova_brain enable row level security;
revoke all on public.nova_brain from anon, authenticated;
grant select, insert, update on public.nova_brain to service_role;

-- pg_cron + pg_net are what make the tick possible at all.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 5 minutes, offset by 2 so it does not collide with the corpus ingest
-- (minute 1) or the hunt sync (minute 4).
select cron.unschedule('nova-brain-tick')
where exists (select 1 from cron.job where jobname = 'nova-brain-tick');

select cron.schedule(
  'nova-brain-tick',
  '2-59/5 * * * *',
  $$
  select net.http_post(
    url := 'https://dbaaclqycsiefjwjfavf.supabase.co/functions/v1/nova-brain?force=scheduled',
    body := '{}'::jsonb,
    headers := '{"content-type":"application/json"}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);

-- Verify:
--   select jobname, schedule from cron.job where jobname = 'nova-brain-tick';
--   select net.http_get('https://dbaaclqycsiefjwjfavf.supabase.co/functions/v1/nova-brain');
--   select doc->>'at', doc->>'grounded', doc->'failures' from public.nova_brain;
