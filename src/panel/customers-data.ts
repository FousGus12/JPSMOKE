// Clientes (D41): lista paginada por RPC (solo admin) y edición de etiquetas y notas.
import { getSupabase } from '../lib/supabase';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  trusted: boolean;
  blocked: boolean;
  notes: string | null;
  created_at: string;
  orders: number;
  spent: number;
  last_order: string | null;
}
export interface CustomerPage {
  total: number;
  rows: CustomerRow[];
}
export const CUSTOMERS_PAGE = 30;

export async function loadCustomers(search: string, offset: number): Promise<CustomerPage> {
  const { data, error } = await getSupabase().rpc('customers_list', {
    p_search: search.trim() || undefined,
    p_limit: CUSTOMERS_PAGE,
    p_offset: offset,
  });
  if (error || !data) throw new Error('No se pudieron cargar los clientes.');
  return data as unknown as CustomerPage;
}

export async function updateCustomer(
  id: string,
  patch: Partial<{ trusted: boolean; blocked: boolean; notes: string | null }>,
): Promise<void> {
  const { error } = await getSupabase().from('customers').update(patch).eq('id', id);
  if (error) throw new Error('No se pudo guardar el cambio.');
}
