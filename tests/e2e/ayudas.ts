// Ayudas compartidas de las e2e: base local, TOTP y ingreso al panel. Nunca contra el remoto.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

export const DB = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
export const sql = (query: string) => execFileSync('psql', [DB, '-Atqc', query], { encoding: 'utf8' }).trim();
export const PASSWORD = 'JpSmokeDev-2026';
export const ADMIN_ID = '00000000-0000-4000-8000-00000000b001';
export const RID = '00000000-0000-4000-8000-0000000000a1';

/** TOTP (RFC 6238): SHA-1, 30 s, 6 dígitos, secreto en base32. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function loginAdmin(page: Page) {
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
  await page.goto('/panel');
  await page.getByLabel('Correo').fill('admin.dev@jpsmoke.test');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Activa tu código de seguridad' })).toBeVisible({
    timeout: 15_000,
  });
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  if (30_000 - (Date.now() % 30_000) < 4_000) await page.waitForTimeout(4_500);
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

/** Abre el menú lateral en celular (solo después de ver `.topbar`, que es cuando el botón ya responde). */
export async function openMenu(page: Page) {
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  const toggle = page.locator('#side-toggle');
  if (await toggle.isVisible()) await toggle.click();
}

/** Va a un apartado del menú (D41): si está dentro de un grupo desplegable, lo abre antes. */
export async function goTo(page: Page, label: string) {
  await openMenu(page);
  const item = page.locator('.side-nav button', { hasText: label }).first();
  if (!(await item.isVisible())) {
    const id = await item.evaluate((el) => el.closest('.nav-group')?.id ?? '');
    if (id) await page.locator(`.nav-group-head[aria-controls="${id}"]`).click();
  }
  await item.click();
}

export async function loginOperator(page: Page) {
  await page.goto('/panel');
  await page.getByLabel('Correo').fill('operador.dev@jpsmoke.test');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

/** Pedido "web" directo en la base (como lo deja crear-pedido). Devuelve el código; falla si la base lo rechaza. */
export function placeOrderSql(opts: { phone: string; name: string; product?: string; qty?: number }): string {
  const code = placeOrderResult(opts).code;
  if (!/^JP-\d{4}$/.test(code ?? ''))
    throw new Error(`place_order no creó el pedido: ${JSON.stringify(code)}`);
  return code as string;
}

/** Igual, pero devuelve la respuesta de la base ({ok, code} o {ok:false, reason}); `zoneName` fuerza esa zona. */
export function placeOrderResult(opts: {
  phone: string;
  name: string;
  product?: string;
  qty?: number;
  zoneName?: string;
}): { ok: boolean; code?: string; reason?: string } {
  const { phone, name, product = 'la-clasica', qty = 1, zoneName } = opts;
  const zone = zoneName
    ? `(select id from public.delivery_zones where restaurant_id = '${RID}' and name = '${zoneName}')`
    : `(select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1)`;
  return JSON.parse(
    sql(`select public.place_order(jsonb_build_object('restaurant', 'jp-smoke', 'token', 'token-e2e-${phone}-0001',
    'customer', jsonb_build_object('name', '${name}', 'phone', '${phone}', 'address', 'Calle 68 # 60-71', 'zone_id', ${zone}),
    'payment_code', 'nequi', 'items', jsonb_build_array(jsonb_build_object('product_id',
      (select id from public.products where restaurant_id = '${RID}' and slug = '${product}'), 'qty', ${qty}))))::text`),
  );
}

/** Guarda el estado activo de las zonas y deja Chapinero encendida y Kennedy apagada (pruebas de cobertura). */
export function snapshotZones(): string {
  const snap = sql(
    `select string_agg(id || ':' || active, ',') from public.delivery_zones where restaurant_id = '${RID}'`,
  );
  sql(
    `update public.delivery_zones set active = (name = 'Chapinero') where restaurant_id = '${RID}' and name in ('Chapinero', 'Kennedy')`,
  );
  return snap;
}
export function restoreZones(snap: string) {
  for (const pair of snap.split(',')) {
    const [id, active] = pair.split(':');
    if (id) sql(`update public.delivery_zones set active = ${active} where id = '${id}'`);
  }
}

/** Salta al elemento sin animación (en iPhone no hay rueda y el scroll suave se cruza con las pruebas). */
export async function jumpTo(page: Page, selector: string) {
  await page.evaluate((target) => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector(target)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, selector);
}

/** Abre el carrito por JS: el botón del encabezado se esconde al bajar y en celular lo cubre la barra inferior. */
export async function openCartJs(page: Page) {
  await page.evaluate(() => (document.querySelector('[data-open-cart]') as HTMLElement).click());
}
