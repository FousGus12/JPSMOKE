import { createClient } from '@supabase/supabase-js';
import { envLimit, turnstileVerifier } from '../_shared/publico.ts';
import { handle } from './handler.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: { persistSession: false },
  },
);

Deno.serve((request) =>
  handle(request, {
    rpc: (fn, args) => supabase.rpc(fn, args),
    verifyTurnstile: turnstileVerifier(Deno.env.get('TURNSTILE_SECRET') ?? ''),
    allowedOrigins: (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? 'local')
      .split(',')
      .map((origin) => origin.trim()),
    salt: Deno.env.get('IP_SALT') ?? 'jp-smoke',
    maxPerHourIp: envLimit(Deno.env.get('MAX_PER_HOUR_IP'), 5),
  }),
);
