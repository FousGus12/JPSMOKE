// v0.18 en el sitio público (D44, D47, D50) contra Supabase LOCAL y el build de dist.
// Cobertura verificable con ubicación emulada, inicio de una pantalla en celular (con bienvenida real,
// sin ?intro=ninguna) y con "reducir movimiento". Las pruebas de celular se saltan en el proyecto escritorio.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { RID, jumpTo, openCartJs, restoreZones, snapshotZones, sql } from './ayudas';

let zones = '';
test.beforeAll(() => {
  zones = snapshotZones(); // Chapinero encendida y Kennedy apagada
});
test.afterAll(() => restoreZones(zones));

const zoneId = (name: string) =>
  sql(`select id from public.delivery_zones where restaurant_id = '${RID}' and name = '${name}'`);

// Puntos de prueba dentro de cada localidad (comprobados contra src/data/bogota-localidades.json).
const CHAPINERO = { latitude: 4.667, longitude: -74.0546, accuracy: 20 }; // Zona T
const KENNEDY = { latitude: 4.633, longitude: -74.15, accuracy: 20 }; // Mundo Aventura

test.describe('cobertura con ubicación en Chapinero (zona activa)', () => {
  test.use({ geolocation: CHAPINERO, permissions: ['geolocation'] });

  test('"Usar mi ubicación" responde "Sí llegamos" y pinta el mapa', async ({ page }) => {
    await page.goto('/?intro=ninguna');
    await jumpTo(page, '#cobertura');
    const button = page.locator('[data-geo="cover"]');
    await expect(button).toBeVisible();
    await button.click();
    const result = page.locator('#cover-result');
    await expect(result).toContainText('Sí llegamos a Chapinero');
    await expect(result).toContainText(/Domicilio \$[\d.]+/);
    await expect(result).toHaveClass(/is-yes/);
    await expect(result.getByRole('link', { name: 'Pide ahora' })).toBeVisible();
    await expect(page.locator('#cover-loc')).toHaveValue('02');
    await expect(page.locator('#cover-map [data-loc="02"]')).toHaveClass(/is-picked/);
    // El mapa pinta con las zonas activas del panel: Chapinero sí, Kennedy (apagada) no.
    await expect(page.locator('#cover-map [data-loc="02"]')).toHaveClass(/is-on/);
    await expect(page.locator('#cover-map [data-loc="08"]')).not.toHaveClass(/is-on/);
    await expect(page.locator('.zone[data-zone-id]', { hasText: 'Kennedy' })).toHaveClass(/off/);
  });

  test('en el pedido, "Usar mi ubicación" deja elegida la zona', async ({ page }) => {
    await page.goto('/?intro=ninguna');
    await page.locator('#arsenal').scrollIntoViewIfNeeded();
    await page
      .locator('#arsenal .pcard')
      .first()
      .getByRole('button', { name: /Agregar al pedido/ })
      .click();
    await openCartJs(page);
    await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
    const checkout = page.locator('#checkout');
    await checkout.locator('[data-geo="checkout"]').click();
    await expect(checkout.locator('#f-geo')).toContainText('Sí llegamos a Chapinero');
    await expect(checkout.getByLabel('Localidad')).toHaveValue(zoneId('Chapinero'));
  });
});

test.describe('cobertura con ubicación en Kennedy (zona apagada)', () => {
  test.use({ geolocation: KENNEDY, permissions: ['geolocation'] });

  test('"Usar mi ubicación" responde "Todavía no" y ofrece WhatsApp', async ({ page }) => {
    await page.goto('/?intro=ninguna');
    await jumpTo(page, '#cobertura');
    await page.locator('[data-geo="cover"]').click();
    const result = page.locator('#cover-result');
    await expect(result).toContainText('Todavía no llegamos a Kennedy');
    await expect(result).toHaveClass(/is-no/);
    await expect(result.getByRole('link', { name: /WhatsApp/ })).toBeVisible();
    await expect(page.locator('#cover-map [data-loc="08"]')).toHaveClass(/is-picked/);
  });

  test('en el pedido no elige zona y avisa junto al campo', async ({ page }) => {
    await page.goto('/?intro=ninguna');
    await page.locator('#arsenal').scrollIntoViewIfNeeded();
    await page
      .locator('#arsenal .pcard')
      .first()
      .getByRole('button', { name: /Agregar al pedido/ })
      .click();
    await openCartJs(page);
    await page.getByRole('button', { name: 'Continuar con el pedido' }).click();
    const checkout = page.locator('#checkout');
    await checkout.locator('[data-geo="checkout"]').click();
    await expect(checkout.locator('#f-geo')).toContainText('Todavía no llegamos a Kennedy');
    await expect(checkout.getByLabel('Localidad')).toHaveValue('');
  });
});

test.describe('cobertura sin permiso de ubicación', () => {
  test('sin permiso avisa y elegir la localidad responde sí o no', async ({ page }) => {
    await page.goto('/?intro=ninguna');
    await jumpTo(page, '#cobertura');
    const result = page.locator('#cover-result');
    const select = page.locator('#cover-loc');

    await select.selectOption({ label: 'Chapinero' });
    await expect(result).toContainText('Sí llegamos a Chapinero');
    await select.selectOption({ label: 'Kennedy' });
    await expect(result).toContainText('Todavía no llegamos a Kennedy');
    await expect(result).toHaveClass(/is-no/);
    await select.selectOption('');
    await expect(result).toHaveText('');

    // Sin permiso concedido, "Usar mi ubicación" no inventa respuesta: manda a la lista.
    await page.locator('[data-geo="cover"]').click();
    await expect(result).toContainText(/elige tu localidad en la lista/i, { timeout: 20_000 });
    await expect(result).not.toHaveClass(/is-yes/);
  });
});

/* ---------- Inicio en celular (D50) ---------- */

const metrics = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const hero = rect('#inicio');
    const bar = rect('.bottom-bar');
    return {
      innerHeight: window.innerHeight,
      heroHeight: hero?.height ?? 0,
      barBottom: bar?.bottom ?? -1,
      barHeight: bar?.height ?? 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      touch: navigator.maxTouchPoints,
    };
  });

/** Entra con la bienvenida real del build (completa); salta si el build no la trae. */
async function enterWelcome(page: Page, info: TestInfo) {
  test.skip(info.project.name === 'escritorio', 'Inicio de una pantalla: solo celular');
  await page.goto('/');
  const intro = page.locator('#intro');
  test.skip((await intro.count()) === 0, 'El build no trae bienvenida completa (evento con show_intro)');
  await expect(intro).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/is-locked/);
  // Botón inmediato: responde antes de que termine la barra de carga (2,4 s en la versión anterior).
  await intro.locator('button[data-intro-close]').click({ timeout: 2000 });
  await expect(intro).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/is-locked/);
}

async function expectOneScreen(page: Page) {
  const data = await metrics(page);
  // WebKit de Playwright no reporta maxTouchPoints; el hero móvil se decide por ancho (≤760 px).
  expect(data.heroHeight).toBeGreaterThan(300);
  expect(data.heroHeight).toBeLessThanOrEqual(data.innerHeight + 2);
  expect(data.scrollWidth).toBeLessThanOrEqual(data.clientWidth); // sin scroll horizontal
  const cards = page.locator('.hcard');
  await expect(cards).toHaveCount(4);
  for (let index = 0; index < 4; index++) {
    await expect(cards.nth(index)).toBeVisible();
    await expect(cards.nth(index)).toHaveCSS('opacity', '1', { timeout: 6000 });
    const box = await cards.nth(index).boundingBox();
    expect(box).not.toBeNull();
    // Cada foto entra en la primera pantalla (centro dentro del alto visible).
    const center = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    expect(center).toBeGreaterThan(0);
    expect(center).toBeLessThan(data.innerHeight);
  }
}

async function expectBottomBarFlush(page: Page) {
  const data = await metrics(page);
  expect(data.barHeight).toBeGreaterThan(30);
  expect(Math.abs(data.barBottom - data.innerHeight)).toBeLessThanOrEqual(1.5);
  await expect(page.locator('.bottom-bar')).toHaveCSS('backdrop-filter', 'none');
}

test('celular: bienvenida inmediata, inicio de una pantalla y barra inferior al borde (D50)', async ({
  page,
}, info) => {
  await enterWelcome(page, info);
  await expectOneScreen(page);
  await expectBottomBarFlush(page);
  await expect(page.locator('.bottom-bar button[data-open-cart]')).toBeVisible();

  // Con el scroll liberado, la barra sigue pegada al borde también en la carta.
  await jumpTo(page, '#carta');
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expectBottomBarFlush(page);

  // Con el teclado abierto (campo de texto con foco) la barra se oculta y vuelve al salir.
  await page.locator('#carta-search').focus();
  await expect(page.locator('html')).toHaveClass(/kb-open/);
  await expect(page.locator('.bottom-bar')).toBeHidden();
  await page.locator('#carta-search').blur();
  await expect(page.locator('.bottom-bar')).toBeVisible();
});

test('celular: la bienvenida sale una sola vez al día (D50)', async ({ page }, info) => {
  await enterWelcome(page, info);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => /bienvenida/i.test(key))).toBe(true); // la marca vive en localStorage

  await page.reload();
  await expect(page.locator('.hcard').first()).toBeVisible();
  await page.waitForTimeout(800); // da tiempo a que la bienvenida se mostrara si fuera a salir
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/is-locked/);

  // Al día siguiente (36 h después) vuelve a salir.
  await page.clock.setFixedTime(Date.now() + 36 * 3_600_000);
  await page.reload();
  await expect(page.locator('#intro')).toBeVisible();
});

test.describe('con "reducir movimiento"', () => {
  test.use({ reducedMotion: 'reduce' });

  test('celular: el inicio es estático, de una pantalla y la bienvenida responde sin esperar', async ({
    page,
  }, info) => {
    await enterWelcome(page, info);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expectOneScreen(page);
    await expectBottomBarFlush(page);
    // Sin movimiento: nada de fotos "entrando"; ya están todas en su sitio.
    for (const card of await page.locator('.hcard').all()) await expect(card).toHaveCSS('opacity', '1');
  });
});
