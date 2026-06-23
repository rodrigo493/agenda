-- Corrige os jobs criados pelo 0002 (aplicado com placeholders <REF>/<SERVICE_ROLE_KEY>).
-- As funções reminders/gcal-sync são deployadas com --no-verify-jwt, então o cron
-- as chama sem header Authorization (nenhum segredo fica no SQL/git).
-- REF do projeto: uhvwywdspjuxlfaitcic.

select cron.unschedule('agenda-gcal-sync') from cron.job where jobname = 'agenda-gcal-sync';
select cron.unschedule('agenda-reminders')  from cron.job where jobname = 'agenda-reminders';

select cron.schedule('agenda-gcal-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://uhvwywdspjuxlfaitcic.supabase.co/functions/v1/agenda-gcal-sync',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
$$);

select cron.schedule('agenda-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://uhvwywdspjuxlfaitcic.supabase.co/functions/v1/agenda-reminders',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
$$);
