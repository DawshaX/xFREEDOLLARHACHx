-- ─────────────────────────────────────────────────────────────────────────────
-- The database pulls the hunt result; CI does not push it.
--
-- Why this shape: the hunt workflow runs on GitHub Actions and has no Supabase
-- service key (`gh secret set` returns 403 for this integration), so it can only
-- commit `state/hunt-latest.json` to the repo. Measured consequence: `hunt_runs`
-- held exactly one row (14:44Z) while four scans had finished, and the panel's
-- "آخر صيد" tab read that stale row.
--
-- So the direction is reversed: pg_cron fetches the published file over HTTP
-- (pg_net), and the *next* call reads the response it already has and upserts.
-- Two steps because pg_net is asynchronous — the same pattern `nova_corpus_step`
-- uses, and it survives a slow or failed request without blocking the job.
--
-- Applied live 2026-11-04 (function + cron job `nova-hunt-sync`, every 10 min).
-- This file exists so the database can be rebuilt from the repo.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.nova_hunt_step()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $$
declare
  src text := 'https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/state/hunt-latest.json';
  cur jsonb;
  prev bigint;
  prev_status int;
  body text;
  doc jsonb;
  rid bigint;
  run_at timestamptz;
  rid_run bigint;
  rows_in int := 0;
  newest timestamptz;
begin
  select value into cur from corpus_meta where key = 'hunt';

  -- Second half of the previous call: read the response pg_net already fetched.
  if cur ? 'req' then
    prev := (cur->>'req')::bigint;
    select status_code, content into prev_status, body from net._http_response where id = prev;
    if prev_status = 200 and body is not null then
      begin
        doc := body::jsonb;
      exception when others then
        doc := null;
      end;
      if doc is not null and doc ? 'at' then
        begin
          run_at := (doc->>'at')::timestamptz;
        exception when others then
          run_at := null;
        end;
        -- Idempotent on the run timestamp: the same file fetched twice must not
        -- create two runs, and two scans must not collapse into one.
        if run_at is not null and not exists (select 1 from hunt_runs where at = run_at) then
          insert into hunt_runs (at, tools, totals, says_ar, targets, raw)
            values (
              run_at,
              coalesce(doc->'tools', '{}'::jsonb),
              coalesce(doc->'totals', '{}'::jsonb),
              doc->>'says_ar',
              coalesce(doc->'targets', '[]'::jsonb),
              doc
            )
            returning id into rid_run;

          insert into hunt_findings (run_id, host, template, template_id, severity, matched_at, cve, cwe, evidence, verified)
            select
              rid_run,
              coalesce(f->>'host', f->>'matchedAt'),
              coalesce(f->>'template', ''),
              f->>'id',
              f->>'severity',
              f->>'matchedAt',
              case
                when jsonb_typeof(f->'cve') = 'array' then array(select jsonb_array_elements_text(f->'cve'))
                when jsonb_typeof(f->'cve') = 'string' then array[f->>'cve']
                else null
              end,
              case
                when jsonb_typeof(f->'cwe') = 'array' then array(select jsonb_array_elements_text(f->'cwe'))
                when jsonb_typeof(f->'cwe') = 'string' then array[f->>'cwe']
                else null
              end,
              f->'evidence',
              -- a template match is a lead, not a confirmed vulnerability
              false
            from jsonb_array_elements(coalesce(doc->'findings', '[]'::jsonb)) f;

          get diagnostics rows_in = row_count;
        end if;
      end if;
    end if;
  end if;

  rid := net.http_get(url := src, timeout_milliseconds := 20000);
  insert into corpus_meta (key, value, updated_at)
    values ('hunt', jsonb_build_object('req', rid, 'at', now(), 'prev_status', prev_status), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  select max(at) into newest from hunt_runs;
  return jsonb_build_object(
    'req', rid,
    'prev_status', prev_status,
    'inserted_findings', rows_in,
    'newest_run', newest
  );
end
$$;

select cron.schedule('nova-hunt-sync', '4-59/10 * * * *', 'select public.nova_hunt_step()');
