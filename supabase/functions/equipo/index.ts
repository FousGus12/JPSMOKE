import { createClient } from '@supabase/supabase-js';
import { handle, randomPassword } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
// Con el JWT de quien llama: la base decide si es admin con dos pasos y de qué restaurante.
const asCaller = (authorization: string) =>
  createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });

Deno.serve((request) =>
  handle(request, {
    callerRestaurant: (authorization) => asCaller(authorization).rpc('team_restaurant'),
    callerId: async (authorization) => {
      const { data } = await service.auth.getUser(authorization.replace(/^Bearer /, ''));
      return data.user?.id ?? null;
    },
    createUser: async (email, password, fullName) => {
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) return { id: null, exists: error.code === 'email_exists' };
      return { id: data.user?.id ?? null, exists: false };
    },
    deleteUser: async (id) => {
      await service.auth.admin.deleteUser(id);
    },
    insertStaff: async (row) => {
      const { error } = await service.from('staff').insert({
        user_id: row.user_id,
        restaurant_id: row.restaurant_id,
        full_name: row.full_name,
        role: row.role,
        permissions: row.permissions,
        must_change_password: true,
      });
      return !error;
    },
    staffRestaurant: async (userId) => {
      const { data } = await service
        .from('staff')
        .select('restaurant_id')
        .eq('user_id', userId)
        .maybeSingle();
      return (data?.restaurant_id as string | undefined) ?? null;
    },
    setPassword: async (userId, password) => {
      const { error } = await service.auth.admin.updateUserById(userId, { password });
      if (error) return false;
      // Clave temporal (D39): la persona debe cambiarla antes de volver a entrar al panel.
      const { error: mark } = await service
        .from('staff')
        .update({ must_change_password: true })
        .eq('user_id', userId);
      if (mark) return false;
      // La clave anterior pudo estar comprometida: se cierran sus sesiones abiertas.
      const { error: revoke } = await service.rpc('revoke_sessions', { p_user: userId });
      return !revoke;
    },
    randomPassword,
    callerInfo: async (authorization) => {
      const token = authorization.replace(/^Bearer /, '');
      const { data } = await service.auth.getUser(token);
      const user = data.user;
      if (!user) return null;
      // El token ya fue validado por Auth: se lee el nivel aal de sus claims.
      let aal = 'aal1';
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
          aal?: string;
        };
        aal = payload.aal ?? 'aal1';
      } catch {
        aal = 'aal1';
      }
      const hasTotp = (user.factors ?? []).some((factor) => factor.status === 'verified');
      const { data: staff } = await service
        .from('staff')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .maybeSingle();
      return { id: user.id, aal, hasTotp, isStaff: Boolean(staff) };
    },
    changeOwnPassword: async (userId, password) => {
      const { error } = await service.auth.admin.updateUserById(userId, { password });
      if (error) return false;
      const { error: clear } = await service
        .from('staff')
        .update({ must_change_password: false })
        .eq('user_id', userId);
      return !clear;
    },
    allowedOrigins: (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? 'local')
      .split(',')
      .map((origin) => origin.trim()),
  }),
);
