-- =============================================================================
-- JP Smoke · Editor de carta y página (F6): fotos en Storage por restaurante, bloques
-- de texto editables (promo y JP on Tour), publicar y auditoría de cambios del admin.
-- =============================================================================

-- Fotos de la carta y de eventos: bucket público; cada restaurante escribe solo en su carpeta <restaurant_id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carta', 'carta', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "admin sube fotos de su carta" on storage.objects for insert to authenticated
  with check (bucket_id = 'carta' and public.my_role() = 'admin' and (storage.foldername(name))[1] = public.my_restaurant()::text);
create policy "admin cambia fotos de su carta" on storage.objects for update to authenticated
  using (bucket_id = 'carta' and public.my_role() = 'admin' and (storage.foldername(name))[1] = public.my_restaurant()::text);
create policy "admin borra fotos de su carta" on storage.objects for delete to authenticated
  using (bucket_id = 'carta' and public.my_role() = 'admin' and (storage.foldername(name))[1] = public.my_restaurant()::text);

-- Bloques de texto que antes estaban fijos en el sitio (promo destacada y JP on Tour).
alter table public.restaurant_settings
  add column blocks jsonb not null default '{}'::jsonb,
  add column published_at timestamptz;

-- Publicar (D52 de Aura): marca la hora y la función llama al deploy hook de Vercel. Una vez por minuto.
create function public.publish_site() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid := public.my_restaurant();
  last timestamptz;
begin
  if rid is null or public.my_role() <> 'admin' then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select published_at into last from public.restaurant_settings where restaurant_id = rid;
  if last is not null and last > now() - interval '1 minute' then
    raise exception 'Espera un minuto entre publicaciones' using errcode = 'P0001', hint = 'muy_seguido';
  end if;
  update public.restaurant_settings set published_at = now() where restaurant_id = rid;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id) values (rid, auth.uid(), 'publicar', 'sitio', null);
  return jsonb_build_object('published_at', now(), 'slug', (select slug from public.restaurants where id = rid));
end;
$$;
grant execute on function public.publish_site() to authenticated;

create function public.unmark_published() returns void
language sql security definer set search_path = ''
as $$ update public.restaurant_settings set published_at = null where restaurant_id = public.my_restaurant() and public.my_role() = 'admin' $$;
grant execute on function public.unmark_published() to authenticated;

-- Auditoría (§7, A09): quién cambió qué en la carta, precios, cupones, zonas, pagos y ajustes.
create function private.audit_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  diff jsonb;
begin
  if auth.uid() is null then return coalesce(new, old); end if; -- migraciones y servidor
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, value) into diff from jsonb_each(new_row)
    where value is distinct from old_row -> key and key not in ('updated_at');
    if diff is null then return new; end if;
  end if;
  insert into public.audit_log (restaurant_id, actor, action, entity, entity_id, detail)
  values ((coalesce(new_row, old_row) ->> 'restaurant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(new_row, old_row) ->> coalesce(nullif(tg_argv[0], ''), 'id'),
          case tg_op when 'UPDATE' then diff when 'DELETE' then jsonb_build_object('nombre', old_row ->> 'name') else null end);
  return coalesce(new, old);
end;
$$;
create trigger audit after insert or update or delete on public.products for each row execute function private.audit_change();
create trigger audit after insert or update or delete on public.categories for each row execute function private.audit_change();
create trigger audit after insert or update or delete on public.coupons for each row execute function private.audit_change();
create trigger audit after insert or update or delete on public.delivery_zones for each row execute function private.audit_change();
create trigger audit after insert or update or delete on public.payment_methods for each row execute function private.audit_change();
create trigger audit after update on public.restaurant_settings for each row execute function private.audit_change('restaurant_id');

revoke execute on all functions in schema public from public, anon;
grant execute on function public.track_order(text, text, text) to anon, authenticated;
