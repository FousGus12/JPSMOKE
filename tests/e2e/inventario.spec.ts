// Inventario de insumos (F8b) contra Supabase LOCAL. Guarda y restaura el stock que toca.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

let snapshot = '';
test.beforeAll(() => {
  snapshot = sql(
    `select string_agg(id || ':' || stock, ',') from public.supplies where restaurant_id = '${RID}'`,
  );
});
test.afterAll(() => {
  for (const pair of snapshot.split(',')) {
    const [id, stock] = pair.split(':');
    sql(`update public.supplies set stock = ${stock} where id = '${id}'`);
  }
  sql(
    `delete from public.supply_moves where restaurant_id = '${RID}' and kind in ('compra', 'ajuste', 'merma')`,
  );
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('compra con equivalencia, conteo que agota y recetas', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Inventario');
  const row = page.getByTestId('insumo-Gaseosa 400 ml');
  const before = Number(
    sql(`select stock from public.supplies where restaurant_id = '${RID}' and name = 'Gaseosa 400 ml'`),
  );

  await row.getByRole('button', { name: 'Compra' }).click();
  await page.getByLabel('¿Cuántos paca compraste?').fill('2');
  await expect(page.getByText('Suma 24 unidad al inventario.')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`Gaseosa 400 ml: quedan ${before + 24} unidad`)).toBeVisible();

  await row.getByRole('button', { name: 'Conteo' }).click();
  await page.getByLabel('¿Cuántos unidad hay contados?').fill('0');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(row).toContainText('Agotado');

  // En la página: la gaseosa sola sale agotada y los combos no se pueden pedir.
  const site = await page.context().newPage();
  await site.goto('/?intro=ninguna');
  await site.locator('#carta').scrollIntoViewIfNeeded();
  await expect(
    site
      .locator('[data-product] [data-add]')
      .filter({ hasText: /Agregar/ })
      .first(),
  ).toBeVisible();
  await expect
    .poll(async () => site.locator('#carta-list [data-add][data-combo="1"]:disabled').count())
    .toBeGreaterThan(0);
  const gaseosa = site.locator('#carta-list .item', { hasText: 'Gaseosa 400 ml' });
  await expect(gaseosa.locator('[data-add]')).toBeDisabled();
  await site.close();

  await page.getByRole('tab', { name: 'Recetas' }).click();
  await page.getByLabel('Producto').selectOption({ label: 'La Ahumadora' });
  await expect(page.getByTestId('alcanza')).toContainText('0 en combo');
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await expect(page.getByRole('cell', { name: 'Compra' }).first()).toBeVisible();
});

test('un pedido descuenta insumos y cancelarlo los devuelve', async () => {
  const lechuga = () =>
    sql(`select stock from public.supplies where restaurant_id = '${RID}' and name = 'Lechuga'`);
  const start = Number(lechuga());
  const code =
    sql(`select public.place_order(jsonb_build_object('restaurant', 'jp-smoke', 'token', 'token-inventario-e2e-1',
    'customer', jsonb_build_object('name', 'Inventario E2E', 'phone', '3500000001', 'address', 'Calle 68 # 60-71',
      'zone_id', (select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1)),
    'payment_code', 'nequi', 'items', jsonb_build_array(jsonb_build_object('product_id',
      (select id from public.products where restaurant_id = '${RID}' and slug = 'la-clasica'), 'qty', 2)))) ->> 'code'`);
  expect(Number(lechuga())).toBe(start - 2);
  sql(
    `update public.orders set status = 'cancelado', cancel_reason = 'Prueba' where restaurant_id = '${RID}' and code = '${code}'`,
  );
  expect(Number(lechuga())).toBe(start);
  sql(`delete from public.orders where restaurant_id = '${RID}' and code = '${code}'`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone = '3500000001'`);
});
