// Datos de ventas (F8). Solo admin con dos pasos; la base calcula todo en hora de Bogotá.
import { getSupabase } from '../lib/supabase';
import type { VoidedAfterClose, WeeklyReport } from '../core/sales';

export interface SalesSummary {
  days: number;
  total: number;
  orders: number;
  ticket: number;
  previous_total: number;
  previous_orders: number;
  cancelled: number;
  discounts: number;
  delivery_fees: number;
  by_day: Array<{ day: string; total: number; orders: number }>;
  by_channel: Array<{ key: string; total: number; orders: number }>;
  by_payment: Array<{ key: string; total: number; orders: number }>;
  by_hour: Array<{ hour: number; orders: number }>;
  top_products: Array<{ name: string; qty: number; total: number }>;
  customers: number;
  recurrent_pct: number;
  blocked: number;
  /** D42: entregados anulados después del cierre de caja de su día (puede faltar en una base vieja). */
  voided_after_close?: VoidedAfterClose[];
}

export async function loadSales(days: number): Promise<SalesSummary> {
  const { data, error } = await getSupabase().rpc('sales_summary', { p_days: days });
  if (error || !data) throw new Error('No pudimos cargar las ventas.');
  return data as SalesSummary;
}

export async function exportSales(days: number): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await getSupabase().rpc('sales_export', { p_days: days });
  if (error) throw new Error('No se pudo exportar.');
  return (data ?? []) as Array<Record<string, unknown>>;
}

export interface CashDay {
  day: string;
  expected: number;
  orders: number;
  closed: { counted: number; difference: number; notes: string | null; closed_at: string } | null;
}
export async function loadCash(day?: string): Promise<CashDay> {
  const { data, error } = await getSupabase().rpc('cash_expected', { p_day: day ?? null });
  if (error || !data) throw new Error('No pudimos calcular la caja.');
  return data as CashDay;
}
export async function closeCash(
  day: string,
  counted: number,
  notes: string,
): Promise<{ difference: number }> {
  const { data, error } = await getSupabase().rpc('close_cash', {
    p_day: day,
    p_counted: counted,
    p_notes: notes,
  });
  if (error || !data) throw new Error('No se pudo cerrar la caja.');
  return data as { difference: number };
}
export async function loadWeekly(): Promise<WeeklyReport> {
  const { data, error } = await getSupabase().rpc('weekly_report');
  if (error || !data) throw new Error('No pudimos armar el informe.');
  return data as WeeklyReport;
}
