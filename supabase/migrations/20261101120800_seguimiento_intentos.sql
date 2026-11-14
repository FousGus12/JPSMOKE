-- JP Smoke · Seguimiento por código + 4 dígitos (F9): solo cuentan los intentos fallidos contra el límite,
-- así la página puede actualizarse sola sin gastarlo y adivinar sigue frenado (10 fallos por hora por IP).
create function public.rate_count(p_key text, p_seconds integer) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(hits), 0)::int from private.rate_limits
  where key = p_key and window_start >= to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds)
$$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
grant execute on function public.stock_status(text) to anon, authenticated;
revoke execute on function public.rate_count(text, integer) from authenticated;
grant execute on function public.rate_count(text, integer) to service_role;
