create extension if not exists pg_cron;
create extension if not exists pg_net;

-- substitua <REF> e <SERVICE_ROLE_KEY> ao aplicar (ou use vault)
select cron.unschedule('agenda-gcal-sync') where exists (select 1 from cron.job where jobname = 'agenda-gcal-sync');
select cron.schedule('agenda-gcal-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/agenda-gcal-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);

select cron.unschedule('agenda-reminders') where exists (select 1 from cron.job where jobname = 'agenda-reminders');
select cron.schedule('agenda-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://<REF>.supabase.co/functions/v1/agenda-reminders',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
  );
$$);
