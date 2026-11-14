-- =============================================================================
-- JP Smoke · Usuarios locales de DESARROLLO (no es seed; nunca en remoto).
--   admin.dev@jpsmoke.test     admin de JP Smoke
--   operador.dev@jpsmoke.test  operador de JP Smoke
-- Contraseña local: JpSmokeDev-2026 (solo existe en Supabase local). Idempotente.
-- Lo corre scripts/db-local.sh después de `supabase db reset`.
-- =============================================================================
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('JpSmokeDev-2026', extensions.gen_salt('bf')), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role,
    'restaurant_id', '00000000-0000-4000-8000-0000000000a1'),
  jsonb_build_object('full_name', u.full_name), now(), now(), '', '', '', ''
from (values
  ('00000000-0000-4000-8000-00000000b001'::uuid, 'admin.dev@jpsmoke.test', 'Admin JP', 'admin'),
  ('00000000-0000-4000-8000-00000000b002'::uuid, 'operador.dev@jpsmoke.test', 'Parrillero JP', 'operador')
) as u(id, email, full_name, role)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u
where u.email like '%.dev@jpsmoke.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- Reseñas de muestra de JP Smoke: solo en local (este archivo nunca va a remoto; sin reseñas inventadas en producción).
insert into public.reviews (restaurant_id, author, stars, body, approved)
select '00000000-0000-4000-8000-0000000000a1', v.a, v.s, v.b, true from (values
  ('Camila R.', 5, 'La Ahumadora llegó caliente y oliendo a leña. Se nota que no es parrilla de gas.'),
  ('Andrés P.', 5, 'Pedí por la página, me llamaron a confirmar y en 40 minutos estaba en la puerta.'),
  ('Laura M.', 5, 'Las papas cargadas alcanzan para dos. La costilla se deshace.')
) as v(a, s, b)
where not exists (select 1 from public.reviews r where r.restaurant_id = '00000000-0000-4000-8000-0000000000a1');
commit;
