// Clientes (D41, D65): lista paginada por RPC (solo admin), edición de etiquetas y notas y exportación de promociones.
import type { PromoCustomer } from '../core/security';
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

/** D65: clientes con autorización vigente de promociones. Solo admin; la base deja la exportación en auditoría. */
export async function exportPromoCustomers(): Promise<PromoCustomer[]> {
  const { data, error } = await getSupabase().rpc('customers_promo_export');
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Solo la administración puede exportar clientes.' : 'No se pudo exportar.',
    );
  }
  return (data ?? []) as PromoCustomer[];
}
