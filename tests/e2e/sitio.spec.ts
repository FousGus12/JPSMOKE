import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const DB = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
// Borra lo que crean estas pruebas (pedidos y captación de "Prueba Playwright").
test.afterAll(() => {
  for (const query of [
    "delete from public.orders where customer_name = 'Prueba Playwright'",
    "delete from public.leads where name = 'Prueba Playwright'",
    "delete from public.customers where name = 'Prueba Playwright'",
    // Los usos de cupones vuelven a contar solo los pedidos que quedan.
    // Recoger en tienda vuelve a como lo deja el tenant (local aún no abre).
    'update public.restaurant_settings set pickup_enabled = false, store_open = false, store_address = null',
    "update public.coupons c set uses = (select count(*) from public.orders o where o.restaurant_id = c.restaurant_id and o.coupon_code = c.code::text and o.status <> 'cancelado')",
  ])
    execFileSync('psql', [DB, '-Atqc', query]);
});

// F4: el sitio real contra Supabase local (base + funciones). Cada corrida usa un celular nuevo.
const phone = () => `31${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

// Al bajar, el encabezado se esconde (como en el mockup); al subir un poco vuelve.
async function openCart(page: Page) {
  // En celular la barra inferior siempre está a la mano.
  const bottom = page.locator('.bottom-bar button').filter({ visible: true });
  if (await bottom.count()) return bottom.click();
  await page.mouse.wheel(0, -300);
  await page.locator('.cart-btn').click();
}

async function enter(page: Page) {
  await page.goto('/?intro=completa');
  await page.getByRole('button', { name: 'Entrar al sitio' }).click();
  await expect(page.locator('#intro')).toBeHidden();
}

test('bienvenida en modo aviso con captación de cupón', async ({ page }) => {
  await page.goto('/?intro=aviso');
  const popup = page.locator('#popup');
  await expect(popup).toBeVisible();
  await popup.getByLabel('Nombre').fill('Prueba Playwright');
  await popup.getByLabel('Celular').fill(phone());
  await popup.getByRole('checkbox').check();
  await popup.getByRole('button', { name: 'Quiero mi cupón' }).click();
  await expect(popup.getByText('BIENVENIDA10')).toBeVisible();
});

test('la carta filtra por categoría y por búsqueda', async ({ page }) => {
  await enter(page);
  await page.locator('#carta').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Perros/ }).click();
  await expect(page.locator('[data-cat-block="burgers"]')).toBeHidden();
  await expect(page.locator('[data-cat-block="perros"]')).toBeVisible();
  await page.getByRole('button', { name: 'Todo' }).click();
  await page.getByPlaceholder(/Buscar/).fill('costilla');
  await expect(page.locator('#carta-list [data-search]:visible')).toHaveCount(3);
});

test('pedido completo: carrito, cupón, datos, confirmar y seguimiento', async ({ page }) => {
  await enter(page);
  await page.locator('#arsenal').scrollIntoViewIfNeeded();
  const first = page.locator('#arsenal .pcard').first();
  await first.getByRole('button', { name: 'Combo' }).click();
  await first.getByRole('button', { name: /Agregar al pedido/ }).click();
  await openCart(page);
  const cart = page.getByRole('dialog', { name: 'Mi pedido' });
  await cart.getByLabel('Código de cupón').fill('humo20');
  await cart.getByRole('button', { name: 'Aplicar' }).click();
  await expect(cart.getByText('Descuento HUMO20')).toBeVisible();
  await cart.getByRole('button', { name: 'Continuar con el pedido' }).click();

  const checkout = page.locator('#checkout');
  await checkout.getByLabel('Nombre').fill('Prueba Playwright');
  await checkout.getByLabel('Celular').fill(phone());
  await checkout.getByLabel('Dirección').fill('Calle 68 # 60-71');
  await checkout.getByLabel('Barrio').fill('Normandía');
  await checkout.getByLabel('Localidad').selectOption({ index: 1 });
  await checkout.getByText('Nequi').click();
  await checkout.getByRole('checkbox').first().check();
  await page.waitForTimeout(4200); // tiempo mínimo antirobots
  await checkout.getByRole('button', { name: 'Continuar' }).click();
  await expect(checkout.getByRole('heading', { name: 'Confirma tu pedido' })).toBeVisible();
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done .code')).toHaveText(/^JP-\d{4}$/);

  await checkout.getByRole('link', { name: 'Seguir mi pedido' }).click();
  await expect(page).toHaveURL(/\/pedido\?c=JP-\d{4}&t=/);
  await expect(page.locator('.track-status')).toHaveText('Recibido');
  await expect(page.locator('#track-main')).not.toContainText(/3\d{9}/);

  await page.goto('/');
  await expect(page.locator('#tracker')).toBeVisible();
});

test('recoger en tienda: sin dirección ni domicilio y seguimiento propio', async ({ page }) => {
  // Se activa en vivo (sin publicar): el checkout lee los ajustes al abrir la página.
  execFileSync('psql', [
    DB,
    '-Atqc',
    "update public.restaurant_settings set store_open = true, store_address = 'Calle 68 # 60-71', pickup_enabled = true",
  ]);
  await enter(page);
  await page
    .locator('#arsenal .pcard')
    .first()
    .getByRole('button', { name: /Agregar al pedido/ })
    .click();
  await openCart(page);
  await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
  const checkout = page.locator('#checkout');
  await checkout.getByText('Recoger en tienda').click();
  await expect(checkout.getByTestId('store-address')).toContainText('Calle 68 # 60-71');
  await expect(checkout.getByLabel('Dirección')).toHaveCount(0);
  await checkout.getByLabel('Nombre').fill('Prueba Playwright');
  await checkout.getByLabel('Celular').fill(phone());
  await checkout.getByText('Efectivo').click();
  await checkout.getByRole('checkbox').first().check();
  await page.waitForTimeout(4200);
  await checkout.getByRole('button', { name: 'Continuar' }).click();
  await expect(checkout.getByText('Recoges en tienda')).toBeVisible();
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  const code = (await checkout.locator('.done .code').textContent()) ?? '';
  expect(code).toMatch(/^JP-\d{4}$/);
  expect(
    execFileSync(
      'psql',
      [DB, '-Atqc', `select fulfillment || '|' || delivery_fee from public.orders where code = '${code}'`],
      {
        encoding: 'utf8',
      },
    ).trim(),
  ).toBe('recoger|0');

  execFileSync('psql', [DB, '-Atqc', `update public.orders set status = 'en_camino' where code = '${code}'`]);
  await checkout.getByRole('link', { name: 'Seguir mi pedido' }).click();
  await expect(page.locator('.track-status')).toHaveText('Listo para recoger');
});

test('datos incompletos: no deja continuar', async ({ page }) => {
  await enter(page);
  await page
    .locator('#arsenal .pcard')
    .first()
    .getByRole('button', { name: /Agregar al pedido/ })
    .click();
  await openCart(page);
  await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
  await page.locator('#checkout').getByLabel('Celular').fill('123');
  await page.locator('#checkout').getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Celular colombiano de 10 dígitos')).toBeVisible();
});

test('enlace de seguimiento inválido no muestra nada', async ({ page }) => {
  await page.goto('/pedido?c=JP-0001&t=token-que-no-existe-123');
  await expect(page.locator('.track-status')).toHaveText('No encontrado');
});

test('páginas legales y SEO', async ({ page }) => {
  await page.goto('/privacidad');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tratamiento de datos');
  await page.goto('/');
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(ld ?? '{}')['@type']).toBe('Restaurant');
});
