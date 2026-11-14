import { createClient } from '@supabase/supabase-js';
import type { WaMessage } from '../_shared/plantillas.ts';
import { handle, metaSender } from './handler.ts';

const server = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: { persistSession: false },
  },
);
const token = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const phoneId = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';

Deno.serve((request) =>
  handle(request, {
    secret: Deno.env.get('WHATSAPP_CRON_SECRET') ?? '',
    claim: async () => {
      const { data, error } = await server.rpc('whatsapp_claim', { p_limit: 20 });
      if (error) throw new Error('cola');
      return (data ?? []) as WaMessage[];
    },
    mark: async (id, status, error, providerId) => {
      await server.rpc('whatsapp_mark', {
        p_id: id,
        p_status: status,
        p_error: error ?? null,
        p_provider: providerId ?? null,
      });
    },
    send: token && phoneId ? metaSender(token, phoneId) : null,
  }),
);
