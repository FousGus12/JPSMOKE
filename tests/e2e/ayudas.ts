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

/** Día de Bogotá (AAAA-MM-DD) de un instante. */
const bogotaDay = (ms: number) => new Date(ms - 5 * 3_600_000).toISOString().slice(0, 10);

/**
 * La bienvenida del build solo se ve entre `starts_on` y `ends_on` (D62), aun forzada con `?intro=`.
 * Si hoy cae fuera (el evento del tenant vence), fija el reloj del navegador a un día dentro de la ventana,
 * dejando `marginDays` libres al final. Dentro de la ventana no toca el reloj. Devuelve el instante usado.
 */
export async function welcomeClock(page: Page, marginDays = 0): Promise<number> {
  const [starts = '', ends = ''] = sql(
    `select starts_on || '|' || ends_on from public.events where restaurant_id = '${RID}' and show_intro order by position limit 1`,
  ).split('|');
  const now = Date.now();
  const last = ends ? bogotaDay(Date.parse(`${ends}T12:00:00-05:00`) - marginDays * 86_400_000) : '';
  const today = bogotaDay(now);
  const target = starts && today < starts ? starts : last && today > last ? last : null;
  if (!target) return now;
  const at = Date.parse(`${target}T12:00:00-05:00`);
  await page.clock.setFixedTime(at);
  return at;
}

/** Corre `body` con la bienvenida vigente también en la base (capture_lead valida fechas, D62) y la restaura. */
export async function withWelcomeCurrent(body: () => Promise<void>) {
  const where = `restaurant_id = '${RID}' and show_intro`;
  const saved = sql(
    `select id || '|' || ends_on from public.events where ${where} and ends_on < current_date`,
  );
  if (saved) sql(`update public.events set ends_on = current_date where ${where} and ends_on < current_date`);
  try {
    await body();
  } finally {
    for (const row of saved.split('\n').filter(Boolean)) {
      const [id, ends] = row.split('|');
      sql(`update public.events set ends_on = '${ends}' where id = '${id}'`);
    }
  }
}
