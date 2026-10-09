-- Run as the database owner AFTER the private backend has been deployed and tested.
-- Enable Cron (pg_cron), pg_net and Vault in the Supabase dashboard first.
-- Store these three secrets in Vault (do not put their values in this file):
--   waypoint_backend_url: https://YOUR-PRODUCTION-ENGINE.vercel.app (no trailing slash)
--   waypoint_service_token: the same WAYPOINT_SERVICE_TOKEN as both Vercel projects
--   waypoint_backend_bypass_secret: WAYPOINT_BACKEND_BYPASS_SECRET for the engine project
-- Schedules below are UTC and cover both US daylight-saving offsets.
-- Backend /jobs/tick checks the exchange calendar and skips holidays/closed sessions.

select cron.schedule('waypoint-quotes', '* 13-21 * * 1-5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_url') || '/api/jobs/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_service_token'),
      'x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_bypass_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  );
$$);

-- Morning research and hourly refreshes during US sessions. Cached SEC data,
-- daily bulk earnings, and hourly FX keep the request count within the free allowance.
select cron.schedule('waypoint-morning-research', '5 8 * * 1-5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_url') || '/api/jobs/refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_service_token'),
      'x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_bypass_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  );
$$);

select cron.schedule('waypoint-session-research', '5 13-21 * * 1-5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_url') || '/api/jobs/refresh',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_service_token'),
      'x-vercel-protection-bypass', (select decrypted_secret from vault.decrypted_secrets where name = 'waypoint_backend_bypass_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  );
$$);

-- Inspect cron history AND net._http_response: enqueue success isn't HTTP success.
-- Enable retention for Waypoint cron logs only; financial records are untouched.
select cron.schedule('waypoint-job-log-retention', '20 8 * * 1', $$
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname like 'waypoint-%')
    and end_time < now() - interval '14 days';
$$);
