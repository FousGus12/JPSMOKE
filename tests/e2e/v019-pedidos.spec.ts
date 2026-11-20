// Pedidos v0.19 contra Supabase LOCAL (D59, D60): anular con mensaje para el cliente e insumos, WhatsApp
// prellenado, deshacer entregado (10 s, pagehide y otro dispositivo), Cancelados de hoy y una sola región
// aria-live. Celulares 3580000001–3580000007 y nombres sin dígitos; todo se borra al terminar.
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, loginOperator, placeOrderSql, sql } from './ayudas';

const PHONES = [
  '3580000001',
  '3580000002',
  '3580000003',
  '3580000004',
  '3580000005',
  '3580000006',
  '3580000007',
];
const [ANULAR, OPERADOR, DESHACER, VENCE, CERRAR, OTRO, VIEJO] = PHONES as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const codes: Record<string, string> = {};
function codeOf(phone: string): string {
  const code = codes[phone];
  if (!code) throw new Error(`Sin pedido sembrado para ${phone}`);
  return code;
}
const where = (code: string) => `restaurant_id = '${RID}' and code = '${code}'`;
const statusOf = (code: string) => sql(`select status from public.orders where ${where(code)}`);
const setDbStatus = (code: string, status: string) =>
  sql(`update public.orders set status = '${status}' where ${where(code)}`);

function cleanup() {
  const list = `('${PHONES.join("', '")}')`;
  sql(
    `delete from public.supply_moves where order_id in (select id from public.orders where restaurant_id = '${RID}' and phone in ${list})`,
  );
  sql(`delete from public.orders where restaurant_id = '${RID}' and phone in ${list}`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone in ${list}`);
  sql(`delete from public.consents where restaurant_id = '${RID}' and phone in ${list}`);
}

// Sembrar y anular mueve insumos: se guarda el stock al empezar y se repone al final.
let stockSnapshot = '';
test.beforeAll(() => {
  cleanup();
  stockSnapshot = sql(
    `select string_agg(id || ':' || stock, ',') from public.supplies where restaurant_id = '${RID}'`,
  );
  codes[ANULAR] = placeOrderSql({ phone: ANULAR, name: 'Anula Mensaje', qty: 2 });
  setDbStatus(codeOf(ANULAR), 'en_cocina');
  codes[OPERADOR] = placeOrderSql({ phone: OPERADOR, name: 'Cancela Operador', qty: 2 });
  setDbStatus(codeOf(OPERADOR), 'confirmado');
  codes[DESHACER] = placeOrderSql({ phone: DESHACER, name: 'Deshacer Entrega', qty: 2 });
  setDbStatus(codeOf(DESHACER), 'en_camino');
  codes[VENCE] = placeOrderSql({ phone: VENCE, name: 'Vence Entrega', qty: 2 });
  setDbStatus(codeOf(VENCE), 'en_camino');
  codes[CERRAR] = placeOrderSql({ phone: CERRAR, name: 'Cierra Pestana', qty: 2 });
  setDbStatus(codeOf(CERRAR), 'en_camino');
  codes[OTRO] = placeOrderSql({ phone: OTRO, name: 'Otro Dispositivo', qty: 2 });
  setDbStatus(codeOf(OTRO), 'en_camino');
  // Pedido de hace 2 días anulado hoy: fuera de las 36 h que carga el tablero (D60).
  codes[VIEJO] = placeOrderSql({ phone: VIEJO, name: 'Pedido Viejo', qty: 2 });
  sql(`update public.orders set status = 'cancelado', cancel_reason = 'Pedido duplicado', voided_from = 'nuevo',
    created_at = now() - interval '2 days' where ${where(codeOf(VIEJO))}`);
  sql(`update public.order_events set at = now() - interval '2 days'
    where order_id = (select id from public.orders where ${where(codeOf(VIEJO))})`);
  sql(`insert into public.order_events (order_id, restaurant_id, status, by_user, at)
    select id, restaurant_id, 'cancelado', '${ADMIN_ID}', now() - interval '1 minute' from public.orders where ${where(codeOf(VIEJO))}`);
});
test.afterAll(() => {
  cleanup();
  for (const pair of stockSnapshot.split(',').filter(Boolean)) {
    const [id, stock] = pair.split(':');
    sql(`update public.supplies set stock = ${stock} where id = '${id}'`);
  }
});
test.describe.configure({ mode: 'serial' });

async function openBoard(page: Page, as: 'admin' | 'operador' = 'admin') {
  if (as === 'admin') await loginAdmin(page);
  else await loginOperator(page);
  await goTo(page, 'Pedidos');
  await expect(page.getByTestId(`pedido-${codeOf(DESHACER)}`)).toBeVisible({ timeout: 25_000 });
}

/** Abre el pedido y lo pasa a Entregado con el botón del cajón (sin arrastre). */
async function deliverFromDrawer(page: Page, code: string) {
  await page.getByTestId(`pedido-${code}`).click();
  await page.getByRole('button', { name: 'Entregado →' }).click();
  await expect(
    page.getByRole('region', { name: 'Entregados hoy' }).getByTestId(`pedido-${code}`),
  ).toBeVisible();
}

test('admin anula desde En el barril con mensaje para el cliente, sin devolver insumos (D59)', async ({
  page,
}) => {
  const code = codeOf(ANULAR);
  await openBoard(page);
  await page.getByTestId(`pedido-${code}`).click();
  await page.getByRole('button', { name: 'Anular pedido' }).click();
  const modal = page.getByRole('dialog', { name: `Anular ${code}` });
  await modal.getByLabel('El cliente canceló').check();
  await modal.getByLabel('Mensaje para el cliente (opcional)').selectOption('No llegamos a tu zona');
  // Desde En el barril pregunta por insumos y por defecto no los devuelve.
  await expect(modal.getByLabel('No, ya se usaron')).toBeChecked();
  await expect(modal).toContainText('Los insumos no vuelven al inventario.');
  await modal.getByRole('button', { name: 'Anular pedido' }).click();

  const done = page.getByRole('dialog', { name: `${code} anulado` });
  await expect(done).toContainText('No llegamos a tu zona');
  const href = await done.getByRole('link', { name: 'Avisar por WhatsApp' }).getAttribute('href');
  expect(href).toContain(`https://wa.me/57${ANULAR}?text=`);
  const text = decodeURIComponent((href ?? '').split('text=')[1] ?? '');
  expect(text).toContain(code);
  expect(text).toContain('No llegamos a tu zona');
  await done.getByRole('button', { name: 'Listo' }).click();

  expect(
    sql(
      `select status || '|' || cancel_public || '|' || supplies_restored || '|' || voided_from from public.orders where ${where(code)}`,
    ),
  ).toBe('cancelado|No llegamos a tu zona|false|en_cocina');
  expect(
    sql(
      `select count(*) from public.supply_moves m join public.orders o on o.id = m.order_id where o.restaurant_id = '${RID}' and o.code = '${code}' and m.kind = 'devolucion'`,
    ),
  ).toBe('0');

  // Cancelados de hoy: motivo interno, público, estado previo y quién.
  const section = page.getByRole('region', { name: 'Cancelados de hoy' });
  await section.getByRole('button', { name: /Cancelados de hoy/ }).click();
  const row = section.getByTestId(`cancelado-${code}`);
  await expect(row).toContainText('El cliente canceló');
  await expect(row).toContainText('No llegamos a tu zona');
  await expect(row).toContainText('En el barril');
  await expect(row).toContainText('No volvieron');
  await expect(row.locator('dd').last()).not.toHaveText('—'); // quién: nombre del admin
});

test('operador cancela con "Otro" mensaje y recibe el enlace de WhatsApp (D59)', async ({ page }) => {
  const code = codeOf(OPERADOR);
  await openBoard(page, 'operador');
  await page.getByTestId(`pedido-${code}`).click();
  await page.getByLabel('Cancelar pedido').selectOption('Producto agotado');
  // Confirmado: aún no entra al barril, no pregunta por insumos.
  await expect(page.getByText('¿Devolver insumos al inventario?')).toHaveCount(0);
  await page.getByLabel('Mensaje para el cliente (opcional)').selectOption('Otro');
  await page.getByRole('button', { name: 'Cancelar con motivo' }).click();
  await expect(page.getByText('Escribe el mensaje para el cliente').first()).toBeVisible();
  await page.getByLabel('Qué le decimos al cliente').fill('Se nos acabó el pan de hoy');
  await page.getByRole('button', { name: 'Cancelar con motivo' }).click();

  const done = page.getByRole('dialog', { name: `${code} cancelado` });
  await expect(done.getByRole('link', { name: 'Avisar por WhatsApp' })).toHaveAttribute(
    'href',
    new RegExp(`^https://wa\\.me/57${OPERADOR}\\?text=`),
  );
  expect(
    sql(`select cancel_public || '|' || supplies_restored from public.orders where ${where(code)}`),
  ).toBe('Se nos acabó el pan de hoy|true');

  await done.getByRole('button', { name: 'Listo' }).click();

  // Cancelados de hoy sale de la RPC (todo el equipo): incluye el pedido viejo anulado hoy, que el tablero no carga.
  const section = page.getByRole('region', { name: 'Cancelados de hoy' });
  await section.getByRole('button', { name: /Cancelados de hoy/ }).click();
  await expect(section.getByTestId(`cancelado-${code}`)).toBeVisible(); // recargó al cancelar
  const old = section.getByTestId(`cancelado-${codeOf(VIEJO)}`);
  await expect(old).toContainText('Pedido duplicado');
  await expect(old.locator('dd').last()).not.toHaveText('—');
  await expect(page.getByTestId(`pedido-${codeOf(VIEJO)}`)).toHaveCount(0);
});

test('Entregado espera 10 s con Deshacer; deshacer no envía nada (D60)', async ({ page }) => {
  test.setTimeout(60_000);
  const code = codeOf(DESHACER);
  await openBoard(page);
  await deliverFromDrawer(page, code);
  const card = page.getByTestId(`pedido-${code}`);
  const undo = card.getByRole('button', { name: /Deshacer \(\d+ s\)/ });
  await expect(undo).toBeVisible();
  // Un solo anuncio por cambio: la única región aria-live del panel.
  await expect(page.locator('[aria-live]')).toHaveCount(1);
  await expect(page.getByTestId('panel-live')).toContainText(`${code} se marca como entregado`);
  await undo.click();
  await expect(page.getByRole('region', { name: 'En camino' }).getByTestId(`pedido-${code}`)).toBeVisible();
  await page.waitForTimeout(11_000);
  expect(statusOf(code)).toBe('en_camino');
});

test('sin deshacer, a los 10 s queda entregado (D60)', async ({ page }) => {
  test.setTimeout(60_000);
  const code = codeOf(VENCE);
  await openBoard(page);
  await deliverFromDrawer(page, code);
  expect(statusOf(code)).toBe('en_camino'); // todavía no sale
  await expect.poll(() => statusOf(code), { timeout: 16_000 }).toBe('entregado');
  await expect(page.getByTestId(`pedido-${code}`).getByRole('button', { name: /Deshacer/ })).toHaveCount(0);
});

test('cerrar la pestaña envía la entrega de inmediato (keepalive, D60)', async ({ page }) => {
  const code = codeOf(CERRAR);
  await openBoard(page);
  await deliverFromDrawer(page, code);
  await page.waitForTimeout(500); // el token de la sesión se guarda al programar
  await page.goto('about:blank');
  // Mucho antes de los 10 s.
  await expect.poll(() => statusOf(code), { timeout: 5_000 }).toBe('entregado');
});

test('si otro dispositivo cambia el pedido durante los 10 s, avisa y no lo pisa (D60)', async ({ page }) => {
  test.setTimeout(60_000);
  const code = codeOf(OTRO);
  await openBoard(page);
  await deliverFromDrawer(page, code);
  sql(
    `update public.orders set status = 'cancelado', cancel_reason = 'Otro dispositivo' where ${where(code)}`,
  );
  // Si el cambio llega en vivo antes de los 10 s avisa "cambió en otro dispositivo"; si no, la base rechaza
  // el envío y la tarjeta vuelve. En ambos casos no se pisa: lo que manda es la base.
  await expect(
    page.locator('.toast').filter({ hasText: new RegExp(`${code} (cambió en otro dispositivo|volvió a)`) }),
  ).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(11_000);
  expect(statusOf(code)).toBe('cancelado');
});
