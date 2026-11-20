// v0.19 en el sitio público (D58, D61, D62, D63) contra Supabase LOCAL y el build de dist.
// Reintento sin duplicar, pausa que se reabre sola, repetir con agotado, bienvenida vencida y pedido exprés.
import { expect, test, type Page } from '@playwright/test';
import { RID, openCartJs, sql } from './ayudas';

const NAME = 'Prueba Diecinueve'; // el sitio no acepta dígitos en el nombre
const phone = () => `31${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const productId = (slug: string) =>
  sql(`select id from public.products where restaurant_id = '${RID}' and slug = '${slug}'`);
const activeZone = () =>
  sql(
    `select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1`,
  );
/** Pausa como la deja pause_orders (la bandera de transacción deja pasar el cambio). */
const pauseFor = (seconds: number | null) =>
  sql(
    `select set_config('jps.pausando', 'on', true); update public.restaurant_settings set orders_paused_until = ${
      seconds === null ? 'null' : `now() + interval '${seconds} seconds'`
    } where restaurant_id = '${RID}'`,
  );

// Cada pedido descuenta insumos y borrarlo no los devuelve: se guarda el stock y se repone al final.
let stockSnapshot = '';
test.beforeAll(() => {
  stockSnapshot = sql("select string_agg(id || ':' || stock, ',') from public.supplies");
});
test.afterAll(() => {
  pauseFor(null);
  sql(`update public.products set available = true where restaurant_id = '${RID}' and slug = 'tocinazo'`);
  for (const query of [
    `delete from public.supply_moves where order_id in (select id from public.orders where customer_name = '${NAME}')`,
    `delete from public.orders where customer_name = '${NAME}'`,
    `delete from public.customers where name = '${NAME}'`,
    "update public.coupons c set uses = (select count(*) from public.orders o where o.restaurant_id = c.restaurant_id and o.coupon_code = c.code::text and o.status <> 'cancelado')",
  ])
    sql(query);
  for (const pair of stockSnapshot.split(',').filter(Boolean)) {
    const [id, stock] = pair.split(':');
    sql(`update public.supplies set stock = ${stock} where id = '${id}'`);
  }
});

async function addFirstDish(page: Page) {
  await page.locator('#arsenal').scrollIntoViewIfNeeded();
  await page
    .locator('#arsenal .pcard')
    .first()
    .getByRole('button', { name: /Agregar al pedido/ })
    .click();
}

async function fillData(page: Page, cel: string) {
  const checkout = page.locator('#checkout');
  await checkout.getByLabel('Nombre').fill(NAME);
  await checkout.getByLabel('Celular').fill(cel);
  await checkout.getByLabel('Dirección').fill('Calle 68 # 60-71');
  await checkout.getByLabel('Barrio').fill('Normandía');
  await checkout.getByLabel('Localidad').selectOption({ index: 1 });
  await checkout.getByText('Nequi').click();
  await checkout.getByRole('checkbox').first().check();
  await checkout.getByRole('button', { name: 'Continuar' }).click();
  await expect(checkout.getByRole('heading', { name: 'Confirma tu pedido' })).toBeVisible();
}

test('reintento tras un corte de red deja un solo pedido (D58)', async ({ page }) => {
  const cel = phone();
  await page.goto('/?intro=ninguna');
  await addFirstDish(page);
  await openCartJs(page);
  await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
  await fillData(page, cel);

  // Primer envío: el servidor lo recibe y crea el pedido, pero el navegador ve la conexión caída.
  const ids: string[] = [];
  let cut = true;
  await page.route('**/functions/v1/crear-pedido', async (route) => {
    ids.push((route.request().postDataJSON() as { request_id?: string }).request_id ?? '');
    if (!cut) return route.continue();
    cut = false;
    await route.fetch(); // llega al servidor
    await route.abort('failed'); // la respuesta se pierde
  });
  const checkout = page.locator('#checkout');
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.getByRole('alert')).toContainText('No pudimos conectarnos');
  expect(sql(`select count(*) from public.orders where phone = '${cel}'`)).toBe('1');

  // Reintento con el mismo carrito y datos: mismo id, el servidor devuelve el mismo pedido.
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done .code')).toHaveText(/^JP-\d{4}$/);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(ids[1]).toBe(ids[0]);
  expect(sql(`select count(*) from public.orders where phone = '${cel}'`)).toBe('1');
  const code = (await checkout.locator('.done .code').textContent()) ?? '';
  expect(sql(`select request_id from public.orders where phone = '${cel}'`)).toBe(ids[0]);
  expect(sql(`select code from public.orders where phone = '${cel}'`)).toBe(code);
  await page.unroute('**/functions/v1/crear-pedido');

  // El enlace que recibió (token nuevo) abre el pedido.
  await checkout.getByRole('link', { name: 'Seguir mi pedido' }).click();
  await expect(page.locator('.track-status')).toHaveText('Recibido');
});

test('pausa del equipo: avisa la hora y se reabre sola (D61)', async ({ page }) => {
  pauseFor(15);
  try {
    await page.goto('/?intro=ninguna');
    await addFirstDish(page);
    await openCartJs(page);
    const cart = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(cart.getByTestId('pausa')).toContainText(/Pausamos los pedidos.*Volvemos a las \d{2}:\d{2}/);
    await expect(cart.getByRole('button', { name: 'Continuar con el pedido' })).toBeDisabled();
    // Sin recargar: al terminar la pausa vuelve a preguntar y habilita el pedido.
    await expect(cart.getByRole('button', { name: 'Continuar con el pedido' })).toBeEnabled({
      timeout: 30_000,
    });
    await expect(cart.getByTestId('pausa')).toHaveCount(0);
  } finally {
    pauseFor(null);
  }
});

test('repetir mi último pedido descarta lo agotado con aviso (D63)', async ({ page }) => {
  const clasica = productId('la-clasica');
  const tocinazo = productId('tocinazo');
  await page.addInitScript(
    ([first, second]) => {
      localStorage.setItem(
        'jp-smoke:ultimo-pedido',
        JSON.stringify({
          at: Date.now() - 86_400_000,
          lines: [
            { productId: first, qty: 2, combo: false, key: 'a' },
            { productId: second, qty: 1, combo: false, key: 'b' },
          ],
        }),
      );
    },
    [clasica, tocinazo],
  );
  sql(`update public.products set available = false where id = '${tocinazo}'`);
  try {
    await page.goto('/?intro=ninguna');
    const repeat = page.locator('.hero-repeat');
    await expect(repeat).toBeVisible();
    await repeat.click();
    const cart = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(cart).toBeVisible();
    await expect(cart.locator('.line h4')).toHaveText(['La Clásica']);
    await expect(cart.locator('.line .qty span')).toHaveText(['2']);
    await expect(cart.locator('.repeat-note')).toContainText('Ya no está disponible: Tocinazo');
  } finally {
    sql(`update public.products set available = true where id = '${tocinazo}'`);
  }
});

test('celular: con "Repetir mi último pedido" el inicio sigue en una pantalla (D50, D63)', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'escritorio', 'Inicio de una pantalla: solo celular');
  const clasica = productId('la-clasica');
  await page.addInitScript((id) => {
    localStorage.setItem(
      'jp-smoke:ultimo-pedido',
      JSON.stringify({
        at: Date.now() - 86_400_000,
        lines: [{ productId: id, qty: 1, combo: false, key: 'a' }],
      }),
    );
  }, clasica);
  await page.goto('/?intro=ninguna');
  await expect(page.locator('.hero-repeat')).toBeVisible();
  const data = await page.evaluate(() => ({
    inner: innerHeight,
    hero: document.querySelector('.hero')?.getBoundingClientRect().height ?? 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(data.hero).toBeLessThanOrEqual(data.inner + 2);
  expect(data.overflow).toBeLessThanOrEqual(0);
});

test.describe('bienvenida con fechas (D62)', () => {
  test('vigente: aparece', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T15:00:00-05:00'));
    await page.goto('/?intro=completa');
    await expect(page.locator('#intro')).toBeVisible();
  });

  test('vencida: no aparece aunque el sitio no se haya republicado', async ({ page }) => {
    // El evento de bienvenida del tenant vence el 2026-11-30; "Jueves de costilla", el 2026-12-31.
    await page.clock.setFixedTime(new Date('2026-12-01T09:00:00-05:00'));
    await page.goto('/?intro=completa');
    await page.waitForTimeout(1500); // el aviso saldría a los 1,2 s
    await expect(page.locator('#intro')).toBeHidden();
    await expect(page.locator('#popup')).toBeHidden();
    // La franja pierde lo vencido y conserva lo vigente.
    await expect(page.locator('.strip-track a', { hasText: 'Gran apertura' })).toHaveCount(0);
    await expect(page.locator('.strip-track a', { hasText: 'Jueves de costilla' }).first()).toBeAttached();
    await expect(page.locator('#eventos .event', { hasText: 'Gran apertura' })).toBeHidden();
  });
});

test('pedido exprés: con datos recordados abre en Confirmar y guarda tiempos (D63)', async ({ page }) => {
  const cel = phone();
  const zone = activeZone();
  await page.addInitScript(
    ([name, number, zoneId]) => {
      localStorage.setItem(
        'jp-smoke:datos',
        JSON.stringify({
          mode: 'domicilio',
          name,
          phone: number,
          address: 'Calle 68 # 60-71',
          barrio: 'Normandía',
          zone: zoneId,
          notes: '',
          pay: 'nequi',
          cash: '',
          ok: false,
          promos: false,
        }),
      );
    },
    [NAME, cel, zone],
  );
  await page.goto('/?intro=ninguna');
  await addFirstDish(page);
  await openCartJs(page);
  await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
  const checkout = page.locator('#checkout');
  await expect(checkout.getByRole('heading', { name: 'Confirma tu pedido' })).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'Cambiar datos' })).toBeVisible();
  // La autorización se pide en cada pedido: sin marcarla no envía.
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done')).toHaveCount(0);
  await checkout.getByRole('checkbox').check();
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done .code')).toHaveText(/^JP-\d{4}$/);
  // Exprés: no pasó por Datos (fill_ms vacío) y midió de abrir el pedido a confirmar.
  const [fill, total] = sql(
    `select coalesce(fill_ms::text, 'null') || '|' || coalesce(checkout_ms::text, 'null') from public.orders where phone = '${cel}'`,
  ).split('|');
  expect(fill).toBe('null');
  expect(Number(total)).toBeGreaterThan(0);

  // El pedido queda guardado para repetirlo: el carrito vacío lo ofrece.
  await checkout.locator('[data-close-modal]').last().click();
  await openCartJs(page);
  await expect(
    page.getByRole('dialog', { name: 'Mi pedido' }).getByRole('button', { name: /Repetir mi último pedido/ }),
  ).toBeVisible();
});
