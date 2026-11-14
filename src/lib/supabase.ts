import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readPublicEnv } from './env';

let client: SupabaseClient | undefined;

/** Cliente único con la clave pública (anon). Toda la autorización real vive en RLS (§7). */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = readPublicEnv();
    client = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}
