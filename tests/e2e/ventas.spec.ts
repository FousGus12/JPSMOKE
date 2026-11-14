// Ventas y estadísticas (F8) contra Supabase LOCAL. Crea pedidos entregados con celulares 37xxxxxxxx y los borra.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

const today = () => sql("select (now() at time zone 'America/Bogota')::date");
test.beforeAll(() => {
  sql(`delete from public.cash_closings where restaurant_id = '${RID}'`);
  for (const [num, pay, total] of [
    [9001, 'Efectivo', 41000],
    [9002, 'Efectivo', 30000],
    [9003, 'Nequi', 50000],
  ] as const) {
    sql(`insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total, status)
         values ('${RID}', ${num}, 'JP-${num}', 'e2e', 'Ventas E2E', '37${num}0000', 'Calle 1 # 2-3', 'Engativá', '${pay}', ${total}, ${total}, 'entregado')`);
  }
});
test.afterAll(() => {
  sql(`delete from public.orders where restaurant_id = '${RID}' and customer_name = 'Ventas E2E'`);
  sql(`delete from public.cash_closings where restaurant_id = '${RID}'`);
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('ventas: indicadores, CSV sin datos personales, cierre de caja e informe', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Ventas y estadísticas');
  await page.getByRole('button', { name: 'Hoy' }).click();
  await expect(page.getByTestId('kpi-ingresos')).not.toHaveText('$0');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV' }).click(),
  ]);
  const csv = readFileSync((await download.path()) ?? '', 'utf8');
  expect(csv).toContain('JP-9001');
  expect(csv).not.toMatch(/37900[0-9]0000|Calle 1/);
  expect(
    sql(`select count(*) from public.audit_log where restaurant_id = '${RID}' and action = 'exportar'`),
  ).not.toBe('0');

  await expect(page.getByTestId('caja-esperado')).toHaveText('$71.000');
  await page.getByLabel('Efectivo contado').fill('70000');
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByText('Caja cerrada con faltante de $1.000')).toBeVisible();
  expect(
    sql(`select difference from public.cash_closings where restaurant_id = '${RID}' and day = '${today()}'`),
  ).toBe('-1000');

  await expect(page.getByTestId('informe-semanal')).toContainText('JP Smoke · semana del');
});
