import { createClient } from '@supabase/supabase-js';
import { handle, hookFor } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const hooks = Deno.env.get('VERCEL_DEPLOY_HOOKS') ?? '';
// Con el JWT de quien llama: la base decide si es admin con dos pasos.
const asCaller = (authorization: string) =>
  createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });

Deno.serve((request) =>
  handle(request, {
    publish: (authorization) => asCaller(authorization).rpc('publish_site'),
    unmark: (authorization) => asCaller(authorization).rpc('unmark_published'),
    // Sin hook en local se simula; en el remoto falta = error (nunca "publicado" sin regenerar).
    callHook: async (slug) => {
      const hook = hookFor(slug, hooks);
      if (hook) return (await fetch(hook, { method: 'POST' })).ok;
      return !url.includes('.supabase.co');
    },
    allowedOrigins: (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? 'local')
      .split(',')
      .map((origin) => origin.trim()),
  }),
);
