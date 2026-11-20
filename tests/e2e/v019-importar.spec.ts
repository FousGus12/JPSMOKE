// D64: importar ventas de Rappi/DiDi por CSV contra Supabase LOCAL. Crea un pedido manual de Rappi (celular 37…)
// y ventas externas con ids E2E-*; todo se borra al final.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

const today = () => sql("select (now() at time zone 'America/Bogota')::date");
const latin = (iso: string) => iso.split('-').reverse().join('/');
const clean = () => {
  sql(`delete from public.import_batches where restaurant_id = '${RID}'
       and id in (select batch_id from public.external_sales where external_id like 'E2E-%')`);
  sql(`delete from public.orders where restaurant_id = '${RID}' and customer_name = 'Importar E2E'`);
  sql(`update public.restaurant_settings set import_maps = '{}'::jsonb where restaurant_id = '${RID}'`);
};

test.beforeAll(() => {
  clean();
  sql(`insert into public.orders (restaurant_id, number, code, track_hash, customer_name, phone, address, zone_name, payment_label, subtotal, total, status, channel)
       values ('${RID}', 9101, 'JP-9101', 'e2e', 'Importar E2E', '3791010000', 'Calle 1 # 2-3', 'Engativá', 'Efectivo', 45000, 45000, 'entregado', 'rappi')`);
});
test.afterAll(() => {
  clean();
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('importar Rappi: mapeo propuesto, vista previa, importar, repetidas y revertir', async ({ page }) => {
  const day = latin(today());
  // Excel en español: punto y coma, BOM, CRLF, comillas y montos con miles.
  const csv = [
    'ID pedido;Fecha;Total;Comisión;Estado',
    `E2E-1;${day} 12:30;"$ 45.000";9.000;Entregado`,
    `E2E-2;${day} 13:10;30.000;6.000;Entregado`,
    `E2E-3;31/02/2026;10.000;;Entregado`,
    `E2E-4;${day};20.000;;Cancelado`,
  ].join('\r\n');
  const file = { name: 'rappi-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(`\uFEFF${csv}`, 'utf8') };

  await loginAdmin(page);
  await goTo(page, 'Ventas y estadísticas');
  await expect(page.getByRole('region', { name: 'Plataformas' })).toBeVisible();
  await page.getByRole('button', { name: 'Ventas de Rappi y DiDi' }).click();
  await expect(page.getByTestId('imp-nota')).toContainText('el mapeo se ajusta una vez y queda guardado');

  await page.getByLabel('Archivo CSV').setInputFiles(file);
  await expect(page.getByLabel('Id del pedido')).toHaveValue('ID pedido');
  await expect(page.getByLabel('Comisión (opcional)')).toHaveValue('Comisión');
  await expect(page.getByTestId('imp-validas')).toHaveText('2');
  await expect(page.getByTestId('imp-errores')).toHaveText('1');
  await expect(page.getByTestId('imp-anuladas')).toHaveText('1');
  await expect(page.getByTestId('imp-ya-registradas')).toHaveText('1');
  await expect(page.getByTestId('imp-nuevas')).toHaveText('1');

  await page.getByRole('button', { name: 'Importar 2 ventas' }).click();
  await expect(page.getByTestId('imp-resultado')).toContainText('1 nueva · 1 ya registrada a mano');
  expect(sql(`select count(*) from public.external_sales where external_id like 'E2E-%'`)).toBe('2');
  expect(
    sql(
      `select import_maps -> 'rappi' ->> 'external_id' from public.restaurant_settings where restaurant_id = '${RID}'`,
    ),
  ).toBe('ID pedido');

  // El mismo archivo otra vez: todo repetido, no crea lote.
  await page.getByLabel('Archivo CSV').setInputFiles(file);
  await expect(page.getByTestId('imp-repetidas')).toHaveText('2');
  await page.getByRole('button', { name: 'Importar 2 ventas' }).click();
  await expect(page.getByTestId('imp-resultado')).toContainText('2 repetidas');

  await expect(page.getByTestId('plataformas-total')).toHaveText('$30.000');
  const lots = page.getByRole('region', { name: 'Lotes importados' });
  await expect(lots.getByRole('row')).toHaveCount(2);
  page.once('dialog', (dialog) => void dialog.accept());
  await lots.getByRole('button', { name: 'Revertir' }).click();
  await expect(lots.getByText('Aún no hay importaciones.')).toBeVisible();
  expect(sql(`select count(*) from public.external_sales where external_id like 'E2E-%'`)).toBe('0');
});
