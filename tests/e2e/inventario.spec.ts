// Inventario de insumos (F8b) contra Supabase LOCAL. Guarda y restaura el stock que toca.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

// Guarda por insumo: existencia, inicial, costo y base del costo; y el margen objetivo.
let snapshot = '';
let margin = '65';
test.beforeAll(() => {
  snapshot = sql(
    `select string_agg(id || ':' || stock || ':' || coalesce(initial_stock::text, 'null') || ':' || coalesce(cost::text, 'null') || ':' || cost_basis, ',') from public.supplies where restaurant_id = '${RID}'`,
  );
  margin = sql(`select target_margin from public.restaurant_settings where restaurant_id = '${RID}'`);
});
test.afterAll(() => {
  for (const pair of snapshot.split(',')) {
    const [id, stock, initial, cost, basis] = pair.split(':');
    sql(
      `update public.supplies set stock = ${stock}, initial_stock = ${initial}, cost = ${cost}, cost_basis = '${basis}' where id = '${id}'`,
    );
  }
  sql(
    `update public.supplies set initial_at = null where restaurant_id = '${RID}' and initial_stock is null`,
  );
  sql(`update public.supplies set cost_at = null where restaurant_id = '${RID}' and cost is null`);
  sql(`update public.restaurant_settings set target_margin = ${margin} where restaurant_id = '${RID}'`);
  sql(
    `delete from public.supply_moves where restaurant_id = '${RID}' and kind in ('compra', 'ajuste', 'merma', 'inicial')`,
  );
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('compra con equivalencia, inicial que agota y recetas', async ({ page }) => {
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

  // D46: "Inicial" fija la existencia de partida y se guarda aparte.
  await row.getByRole('button', { name: 'Inicial', exact: true }).click();
  await page.getByLabel('¿Con cuántos unidad arrancas?').fill('0');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(row).toContainText('Agotado');
  expect(
    sql(
      `select initial_stock || '|' || stock from public.supplies where restaurant_id = '${RID}' and name = 'Gaseosa 400 ml'`,
    ),
  ).toBe('0.00|0.00');
  expect(
    sql(
      `select count(*) from public.supply_moves m join public.supplies s on s.id = m.supply_id where s.restaurant_id = '${RID}' and s.name = 'Gaseosa 400 ml' and m.kind = 'inicial'`,
    ),
  ).toBe('1');

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

test('la compra actualiza el costo y Recetas calcula margen y precio sugerido', async ({ page }) => {
  const supply = (column: string) =>
    sql(`select ${column} from public.supplies where restaurant_id = '${RID}' and name = 'Gaseosa 400 ml'`);
  const initial = supply('initial_stock');
  await loginAdmin(page);
  await goTo(page, 'Inventario');
  const row = page.getByTestId('insumo-Gaseosa 400 ml');
  await expect(row).toContainText('Sin costo');

  // Compra de 2 pacas pagando $24.000 por paca (12 unidades): el costo por unidad queda en $2.000.
  await row.getByRole('button', { name: 'Compra' }).click();
  await page.getByLabel('¿Cuántos paca compraste?').fill('2');
  await page.getByLabel('Actualizar costo').check();
  await page.getByLabel('Valor pagado por paca (COP)').fill('24000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Gaseosa 400 ml: quedan 24 unidad')).toBeVisible();
  await expect(row).not.toContainText('Sin costo');
  expect(supply('cost')).toBe('24000.00');
  expect(supply('cost_at is not null')).toBe('t');
  expect(supply('initial_stock')).toBe(initial); // la compra no toca el inicial

  await page.getByRole('tab', { name: 'Recetas' }).click();
  await page.getByLabel('Producto').selectOption({ label: 'Gaseosa 400 ml' });
  const cost = page.getByTestId('costo-plato');
  await expect(cost).toContainText('$2.000'); // costo por unidad
  await expect(cost).toContainText('$5.000'); // precio de venta
  await expect(cost).toContainText('$3.000 · 60 %'); // margen
  const suggested = Math.ceil((2000 * 100) / (100 - Number(margin)) / 100) * 100;
  await expect(cost).toContainText(`$${String(suggested).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`);

  // El margen objetivo es editable y cambia el sugerido.
  await page.getByLabel('Margen objetivo').fill('50');
  await page.getByLabel('Margen objetivo').press('Enter');
  await expect(page.getByText('Margen objetivo: 50 %')).toBeVisible();
  await expect(cost).toContainText('$4.000');
  expect(sql(`select target_margin from public.restaurant_settings where restaurant_id = '${RID}'`)).toBe(
    '50',
  );

  // Un producto con insumos sin costo avisa que el margen sale incompleto.
  await page.getByLabel('Producto').selectOption({ label: 'La Ahumadora' });
  await expect(page.getByText(/Falta el costo de/)).toBeVisible();
  await expect(page.getByTestId('costo-combo')).toBeVisible();
});
