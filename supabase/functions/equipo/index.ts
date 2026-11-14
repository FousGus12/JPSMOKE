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
      if (error) return { id: null, exists: error.code === 'email_exists' || error.status === 422 };
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
      return !error;
    },
    randomPassword,
    allowedOrigins: (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? 'local')
      .split(',')
      .map((origin) => origin.trim()),
  }),
);
