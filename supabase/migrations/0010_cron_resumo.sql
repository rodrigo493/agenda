-- Resumo diário às 07:00 de São Paulo (= 10:00 UTC, Brasil sem horário de verão).
select cron.unschedule('agenda-resumo-diario') from cron.job where jobname = 'agenda-resumo-diario';
select cron.schedule('agenda-resumo-diario', '0 10 * * *', $$
  select net.http_post(
    url := 'https://uhvwywdspjuxlfaitcic.supabase.co/functions/v1/agenda-resumo-diario',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
$$);
