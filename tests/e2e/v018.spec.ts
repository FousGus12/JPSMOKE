// v0.18 (D41–D49) en el panel, contra Supabase LOCAL: menú con grupos, Clientes, Seguridad, anular un
// entregado, Ajustes, Bienvenida y WhatsApp. Crea datos con nombres sin dígitos y celulares 3500000002 y
// 355xxxxxxx, y los borra al terminar. Cobertura y celular del sitio: v018-sitio.spec.ts.
import { expect, test } from '@playwright/test';
import {
  ADMIN_ID,
  RID,
  goTo,
  loginAdmin,
  loginOperator,
  openMenu,
  placeOrderResult,
  placeOrderSql,
  restoreZones,
  snapshotZones,
  sql,
} from './ayudas';

const VOID_PHONE = '3500000002';
const CLIENT_PHONES = ['3550000001', '3550000002'];
const jsonLiteral = (value: string) => `'${value.replace(/'/g, "''")}'::jsonb`;
const lechuga = () =>
  Number(sql(`select stock from public.supplies where restaurant_id = '${RID}' and name = 'Lechuga'`));
// Ingresos de hoy como los cuenta Ventas: todo pedido de hoy que no esté cancelado.
const salesToday = () =>
  Number(
    sql(`select coalesce(sum(total), 0) from public.orders where restaurant_id = '${RID}'
      and status <> 'cancelado'
      and (created_at at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date`),
  );

let zones = '';
let channels = '';
let hours = '';
let introMode = '';
let lechugaStart = 0;
let voidCode = '';

test.beforeAll(() => {
  zones = snapshotZones();
  channels = sql(`select channels::text from public.restaurant_settings where restaurant_id = '${RID}'`);
  hours = sql(`select hours::text from public.restaurant_settings where restaurant_id = '${RID}'`);
  introMode = sql(`select intro_mode from public.restaurant_settings where restaurant_id = '${RID}'`);
  lechugaStart = lechuga();
  // Un pedido entregado hoy: se anula en la prueba de D42 (descuenta 2 lechugas al entrar).
  voidCode = placeOrderSql({ phone: VOID_PHONE, name: 'Anular Prueba', qty: 2 });
  sql(
    `update public.orders set status = 'entregado' where restaurant_id = '${RID}' and code = '${voidCode}'`,
  );
  for (const [index, phone] of CLIENT_PHONES.entries())
    sql(
      `insert into public.customers (restaurant_id, phone, name) values ('${RID}', '${phone}', '${index === 0 ? 'Clienta Buscable' : 'Cliente Otro'}') on conflict do nothing`,
    );
});
test.afterAll(() => {
  restoreZones(zones);
  sql(
    `update public.restaurant_settings set channels = ${jsonLiteral(channels)}, hours = ${jsonLiteral(hours)}, intro_mode = '${introMode}' where restaurant_id = '${RID}'`,
  );
  sql(
    `delete from public.supply_moves where order_id in (select id from public.orders where restaurant_id = '${RID}' and phone = '${VOID_PHONE}')`,
  );
  sql(`delete from public.orders where restaurant_id = '${RID}' and phone = '${VOID_PHONE}'`);
  sql(
    `delete from public.customers where restaurant_id = '${RID}' and phone in ('${VOID_PHONE}', '${CLIENT_PHONES.join("', '")}')`,
  );
  sql(
    `delete from public.blocked_attempts where restaurant_id = '${RID}' and customer_name in ('Frenado Prueba', 'Clienta Buscable')`,
  );
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('menú: cinco fijos y dos grupos desplegables, sin "Pronto" (D41)', async ({ page }) => {
  await loginAdmin(page);
  await openMenu(page);
  const nav = page.locator('.side-nav');
  for (const label of ['Resumen', 'Pedidos', 'Ventas y estadísticas', 'Inventario', 'WhatsApp'])
    await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();

  const head = (label: string) => nav.locator('.nav-group-head', { hasText: label });
  const contenido = [
    'Carta y precios',
    'Editar página',
    'Promociones y cupones',
    'Eventos y banners',
    'Bienvenida',
  ];
  const administracion = ['Equipo y permisos', 'Clientes', 'Ajustes', 'Seguridad'];
  for (const group of ['Contenido', 'Administración'])
    await expect(head(group)).toHaveAttribute('aria-expanded', 'false');
  for (const label of [...contenido, ...administracion])
    await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeHidden();

  await head('Contenido').click();
  await expect(head('Contenido')).toHaveAttribute('aria-expanded', 'true');
  for (const label of contenido)
    await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jps-panel-grupos'))).toContain('"contenido":true');

  await head('Administración').click();
  for (const label of administracion)
    await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  await expect(nav).not.toContainText('Pronto');

  // Plegar de nuevo y entrar directo a una vista de un grupo (como el enlace del Resumen) lo abre solo.
  await head('Administración').click();
  await expect(head('Administración')).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => {
    location.hash = 'seguridad';
  });
  await expect(page.getByRole('heading', { name: 'Seguridad', level: 1 })).toBeVisible();
  await expect(head('Administración')).toHaveAttribute('aria-expanded', 'true');
});

test('el operador no ve Administración ni entra por la dirección (D41)', async ({ page }) => {
  await loginOperator(page);
  await openMenu(page);
  const nav = page.locator('.side-nav');
  await expect(nav.getByRole('button', { name: /Pedidos/ })).toBeVisible();
  for (const label of ['Clientes', 'Seguridad', 'Ajustes', 'Equipo y permisos'])
    await expect(nav.getByRole('button', { name: new RegExp(label) })).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = 'clientes';
  });
  await expect(page.getByRole('heading', { name: 'Resumen', level: 1 })).toBeVisible();
});

test('clientes: buscar, bloquear y desbloquear, notas (D41)', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Clientes');
  await expect(page.getByRole('heading', { name: 'Clientes', level: 1 })).toBeVisible();
  const buscar = page.getByLabel('Buscar por nombre o celular');
  const row = page.getByTestId('cliente-3550000001');

  await buscar.fill('Buscable');
  await expect(row).toBeVisible();
  await expect(page.getByTestId('cliente-3550000002')).toHaveCount(0);
  await buscar.fill('3550000002');
  await expect(page.getByTestId('cliente-3550000002')).toBeVisible();
  await expect(row).toHaveCount(0);
  await buscar.fill('zzzz sin nadie');
  await expect(page.getByText('Nadie coincide con esa búsqueda.')).toBeVisible();
  await buscar.fill('Buscable');

  await row.getByRole('button', { name: 'Bloquear' }).click();
  await expect(row).toContainText('Bloqueado');
  expect(
    sql(`select blocked from public.customers where restaurant_id = '${RID}' and phone = '3550000001'`),
  ).toBe('t');
  // Un cliente bloqueado no puede pedir: el intento queda frenado con su detalle (D43).
  expect(placeOrderResult({ phone: '3550000001', name: 'Clienta Buscable' }).reason).toBe('bloqueado');
  await row.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(row).not.toContainText('Bloqueado');
  expect(
    sql(`select blocked from public.customers where restaurant_id = '${RID}' and phone = '3550000001'`),
  ).toBe('f');

  await row.getByRole('button', { name: 'Notas' }).click();
  await page.getByLabel('Notas internas').fill('Entregar en portería');
  await page.getByLabel('Cliente confiable').check();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(row).toContainText('Entregar en portería');
  await expect(row).toContainText('Confiable');
  expect(
    sql(
      `select trusted || '|' || notes from public.customers where restaurant_id = '${RID}' and phone = '3550000001'`,
    ),
  ).toBe('true|Entregar en portería'); // boolean || text da 'true', no 't'
});

test('seguridad: un intento frenado aparece con su detalle y se filtra por motivo (D43)', async ({
  page,
}) => {
  // Zona apagada: la base lo frena como "fuera de zona" y guarda nombre, últimos 4, zona y productos.
  expect(placeOrderResult({ phone: '3600000001', name: 'Frenado Prueba', zoneName: 'Kennedy' }).reason).toBe(
    'fuera_de_zona',
  );
  expect(
    sql(
      `select phone_last4 || '|' || zone_name || '|' || items_count from public.blocked_attempts where restaurant_id = '${RID}' and customer_name = 'Frenado Prueba'`,
    ),
  ).toBe('0001|Kennedy|1');

  await loginAdmin(page);
  await goTo(page, 'Seguridad');
  await expect(page.getByRole('heading', { name: 'Seguridad', level: 1 })).toBeVisible();
  const frenado = page.getByRole('row', { name: /Frenado Prueba/ });
  await expect(frenado).toBeVisible();
  await expect(frenado).toContainText('Fuera de zona de entrega');
  await expect(frenado).toContainText('••••0001'); // solo los últimos 4 dígitos
  await expect(frenado).toContainText('Kennedy');
  await expect(page.locator('main')).not.toContainText('3600000001'); // el celular completo no se guarda ni se ve

  await page.getByLabel('Motivo').selectOption('bloqueado');
  await expect(frenado).toHaveCount(0);
  await page.getByLabel('Motivo').selectOption('fuera_de_zona');
  await expect(frenado).toBeVisible();

  // Código de dos pasos del equipo y registro de auditoría.
  await expect(page.getByRole('heading', { name: 'Código de dos pasos' })).toBeVisible();
  await expect(page.locator('.seg-team li', { hasText: 'admin.dev@jpsmoke.test' })).toContainText('Activo');
  await expect(page.getByRole('heading', { name: 'Registro de auditoría' })).toBeVisible();
  await expect(
    page.locator('.seg-audit li').first().or(page.getByText('Aún no hay movimientos.')),
  ).toBeVisible();
});

test('operador: el entregado se ve compacto, se despliega y no ofrece anular (D42)', async ({ page }) => {
  await loginOperator(page);
  await goTo(page, 'Pedidos');
  const card = page.getByTestId(`pedido-${voidCode}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const toggle = card.locator('.ocard-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText(voidCode);
  await expect(toggle).toContainText('$');
  await expect(card.locator('.ocard-more')).toHaveCount(0); // solo código y total

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.ocard-more')).toContainText('Anular Prueba');
  await toggle.click();
  await expect(card.locator('.ocard-more')).toHaveCount(0);
  await toggle.click();

  await card.getByRole('button', { name: 'Ver pedido' }).click();
  const drawer = page.getByRole('dialog', { name: new RegExp(`${voidCode} · Entregado`) });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Anular pedido' })).toHaveCount(0);
  await expect(drawer.getByLabel('Cancelar pedido')).toHaveCount(0);
});

test('admin anula un entregado como "Pedido de prueba": insumos vuelven y sale de ventas (D42)', async ({
  page,
}) => {
  const total = Number(
    sql(`select total from public.orders where restaurant_id = '${RID}' and code = '${voidCode}'`),
  );
  expect(lechuga()).toBe(lechugaStart - 2); // el pedido ya descontó sus insumos
  const money = async () => {
    const text = await page
      .getByTestId('kpi-ingresos')
      .textContent({ timeout: 1000 })
      .catch(() => '');
    return Number((text ?? '').replace(/\D/g, '') || -1);
  };

  await loginAdmin(page);
  await goTo(page, 'Ventas y estadísticas');
  await page.getByRole('button', { name: 'Hoy' }).click();
  const before = salesToday();
  expect(before).toBeGreaterThanOrEqual(total);
  await expect.poll(money).toBe(before);

  await goTo(page, 'Pedidos');
  const card = page.getByTestId(`pedido-${voidCode}`);
  await card.locator('.ocard-toggle').click();
  await card.getByRole('button', { name: 'Ver pedido' }).click();
  await page.getByRole('button', { name: 'Anular pedido' }).click();
  const modal = page.getByRole('dialog', { name: `Anular ${voidCode}` });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Anular pedido' }).click();
  await expect(modal.getByRole('alert')).toContainText('Elige un motivo');
  await modal.getByLabel('Pedido de prueba').check();
  await expect(modal).toContainText('tampoco cuenta como cancelado');
  await modal.getByRole('button', { name: 'Anular pedido' }).click();
  // El aviso sale en el toast y, oculto, en la región role=status del tablero (lectores de pantalla).
  await expect(page.locator('.toast').getByText(`${voidCode} anulado`)).toBeVisible();
  await expect(page.getByTestId(`pedido-${voidCode}`)).toHaveCount(0);

  expect(
    sql(
      `select status || '|' || is_test || '|' || cancel_reason from public.orders where restaurant_id = '${RID}' and code = '${voidCode}'`,
    ),
  ).toMatch(/^cancelado\|true\|Pedido de prueba/);
  expect(lechuga()).toBe(lechugaStart); // los insumos volvieron
  expect(
    sql(
      `select count(*) from public.order_events e join public.orders o on o.id = e.order_id where o.restaurant_id = '${RID}' and o.code = '${voidCode}' and e.status = 'cancelado'`,
    ),
  ).toBe('1'); // no se borra: queda en el historial
  expect(salesToday()).toBe(before - total);

  await goTo(page, 'Ventas y estadísticas');
  await page.getByRole('button', { name: 'Hoy' }).click();
  await expect.poll(money).toBe(before - total);
});

test('ajustes: canal Rappi encendido con https y horario (D41, D45)', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Ajustes');
  await expect(page.getByRole('heading', { name: 'Ajustes', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canales' })).toBeVisible();
  const url = page.getByLabel('Enlace de Rappi');
  const save = page.getByRole('button', { name: 'Guardar', exact: true });
  const rappi = () =>
    sql(
      `select (channels -> 'rappi' ->> 'visible') || '|' || (channels -> 'rappi' ->> 'url') from public.restaurant_settings where restaurant_id = '${RID}'`,
    );

  // Sin https no se guarda ni se enciende.
  await url.fill('http://www.rappi.com.co/jp-smoke');
  await expect(page.getByText('Debe empezar por https://')).toBeVisible();
  await page.getByLabel('Mostrar Rappi en la página').check();
  await save.click();
  await expect(page.getByText('El enlace de Rappi debe empezar por https://')).toBeVisible();
  expect(rappi()).not.toContain('jp-smoke');

  await url.fill('https://www.rappi.com.co/jp-smoke');
  await save.click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  expect(rappi()).toBe('true|https://www.rappi.com.co/jp-smoke');
  await expect(page.getByLabel('Mostrar DiDi Food en la página')).not.toBeChecked();

  // Un canal encendido sin enlace no se deja.
  await url.fill('');
  await save.click();
  await expect(page.getByText('Pega el enlace de Rappi para mostrarlo.')).toBeVisible();

  // Horario: el mismo editor (ya no está en Editar página).
  await url.fill('https://www.rappi.com.co/jp-smoke');
  await page.getByLabel('Días 1', { exact: true }).fill('Todos los días de prueba');
  await save.click();
  await expect
    .poll(() => sql(`select hours -> 0 ->> 0 from public.restaurant_settings where restaurant_id = '${RID}'`))
    .toBe('Todos los días de prueba');
});

test('bienvenida: apagarla y encenderla desde su apartado (D41)', async ({ page }) => {
  sql(`update public.restaurant_settings set intro_mode = 'completa' where restaurant_id = '${RID}'`);
  await loginAdmin(page);
  await goTo(page, 'Bienvenida');
  await expect(page.getByRole('heading', { name: 'Bienvenida', level: 1 })).toBeVisible();
  const block = page.getByTestId('bienvenida');
  await expect(block).toContainText('Se muestra una vez por visita');

  await block.getByRole('button', { name: 'Apagar bienvenida' }).click();
  await expect(page.getByText('Bienvenida apagada')).toBeVisible();
  await expect(block).toContainText('Apagada: la gente entra directo a la página.');
  await expect(block.getByRole('button', { name: 'Encender bienvenida' })).toBeVisible();
  expect(sql(`select intro_mode from public.restaurant_settings where restaurant_id = '${RID}'`)).toBe(
    'ninguna',
  );

  // La página entra directo. Aquí se fuerza con ?intro=ninguna: el modo guardado llega a la página al
  // publicar (la prueba con el modo horneado está en v018-sitio.spec.ts).
  const site = await page.context().newPage();
  await site.goto('/?intro=ninguna');
  await expect(site.locator('.hcard').first()).toBeVisible();
  await site.waitForTimeout(600);
  await expect(site.locator('#intro')).toBeHidden();
  await expect(site.locator('#popup')).toBeHidden();
  await site.close();

  await block.getByRole('button', { name: 'Encender bienvenida' }).click();
  await expect(page.getByText('Bienvenida: Pantalla completa')).toBeVisible();
  expect(sql(`select intro_mode from public.restaurant_settings where restaurant_id = '${RID}'`)).toBe(
    'completa',
  );
});
