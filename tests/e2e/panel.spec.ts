// Panel de pedidos (F5) contra Supabase LOCAL. Crea pedidos de prueba con celulares 39xxxxxxxx y los borra al final.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const DB = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const sql = (query: string) => execFileSync('psql', [DB, '-Atqc', query], { encoding: 'utf8' }).trim();
const PASSWORD = 'JpSmokeDev-2026';
const ADMIN_ID = '00000000-0000-4000-8000-00000000b001';
const RID = '00000000-0000-4000-8000-0000000000a1';

function cleanup() {
  sql("delete from public.orders where phone like '39%'");
  sql("delete from public.customers where phone like '39%'");
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

/** Pedido "web" directo en la base (como lo deja crear-pedido), con un celular de prueba. */
function seedOrder(phone: string): string {
  return sql(`select public.place_order(jsonb_build_object(
    'restaurant', 'jp-smoke', 'token', 'token-e2e-${phone}',
    'customer', jsonb_build_object('name', 'Cliente E2E', 'phone', '${phone}', 'address', 'Calle 68 # 60-71', 'barrio', 'Normandía',
      'zone_id', (select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1)),
    'payment_code', 'nequi',
    'items', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where restaurant_id = '${RID}' and slug = 'la-ahumadora'), 'qty', 1))
  )) ->> 'code'`);
}
const phone = () => `39${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

/** TOTP (RFC 6238): SHA-1, 30 s, 6 dígitos, secreto en base32. */
function totp(secret: string, at = Date.now()): string {
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

async function login(page: Page, email: string) {
  await page.goto('/panel');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
async function openSide(page: Page) {
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
  const toggle = page.locator('#side-toggle');
  if (await toggle.isVisible()) await toggle.click();
}

test('operador: entra sin código, no ve dinero ni otras pantallas', async ({ page }) => {
  await login(page, 'operador.dev@jpsmoke.test');
  await expect(page.getByRole('heading', { name: 'Resumen', level: 1 })).toBeVisible();
  await expect(page.getByText('Ventas de hoy')).toHaveCount(0);
  await openSide(page);
  await expect(page.getByText('Carta y precios')).toHaveCount(0);
});

test('pedido nuevo llega en vivo; se confirma, se lleva al barril y se cancela por broma', async ({
  page,
}) => {
  await login(page, 'operador.dev@jpsmoke.test');
  await openSide(page);
  await page.locator('.side-nav button', { hasText: 'Pedidos' }).click();
  const tel = phone();
  const code = seedOrder(tel);
  const card = page.getByTestId(`pedido-${code}`);
  await expect(card).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`Pedido nuevo ${code}`)).toBeVisible();

  await card.click();
  await page.getByRole('button', { name: 'Confirmar →' }).click();
  await expect(page.getByRole('region', { name: 'Confirmados' }).getByTestId(`pedido-${code}`)).toBeVisible();
  expect(sql(`select status from public.orders where code = '${code}'`)).toBe('confirmado');

  await page.getByTestId(`pedido-${code}`).click();
  await page.getByLabel('Cancelar pedido').selectOption('Pedido falso o broma');
  await page.getByRole('button', { name: 'Cancelar con motivo' }).click();
  await expect(page.getByTestId(`pedido-${code}`)).toHaveCount(0);
  expect(sql(`select blocked from public.customers where phone = '${tel}'`)).toBe('t');
});

test('pedido manual por WhatsApp entra confirmado al tablero', async ({ page }) => {
  await login(page, 'operador.dev@jpsmoke.test');
  await page.getByRole('button', { name: '＋ Pedido manual' }).click();
  const modal = page.getByRole('dialog', { name: 'Nuevo pedido manual' });
  await modal.getByLabel('Celular').fill(phone());
  await modal.getByLabel('Nombre').fill('Cliente Manual');
  await modal.getByLabel('Dirección y barrio').fill('Calle 80 # 70-10, Las Ferias');
  await modal.getByRole('button', { name: 'Agregar La Ahumadora' }).click();
  await modal.getByRole('button', { name: /Crear pedido · \$32\.000/ }).click();
  await expect(page.getByText(/Pedido JP-\d{4} creado/)).toBeVisible();
  expect(
    sql(
      "select channel || ':' || status from public.orders where customer_name = 'Cliente Manual' order by created_at desc limit 1",
    ),
  ).toBe('whatsapp:confirmado');
});

test('admin: obliga a activar el código de dos pasos y luego ve ventas', async ({ page }) => {
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
  await login(page, 'admin.dev@jpsmoke.test');
  await expect(page.getByRole('heading', { name: 'Activa tu código de seguridad' })).toBeVisible({
    timeout: 15_000,
  });
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  if (30_000 - (Date.now() % 30_000) < 4_000) await page.waitForTimeout(4_500);
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.getByText('Ventas de hoy')).toBeVisible();
  await openSide(page);
  // Carta vive en el grupo desplegable "Contenido" (D41): cerrado al entrar, se abre con su cabecera.
  await expect(page.getByText('Carta y precios')).toBeHidden();
  await page.locator('.nav-group-head', { hasText: 'Contenido' }).click();
  await expect(page.getByText('Carta y precios')).toBeVisible();
});

test('admin con código incorrecto no entra', async ({ page }) => {
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
  await login(page, 'admin.dev@jpsmoke.test');
  await expect(page.getByRole('heading', { name: 'Activa tu código de seguridad' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Código de 6 dígitos').fill('000000');
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('no es válido');
  await expect(page.getByText('Ventas de hoy')).toHaveCount(0);
});

test('contraseña incorrecta', async ({ page }) => {
  await page.goto('/panel');
  await page.getByLabel('Correo').fill('operador.dev@jpsmoke.test');
  await page.getByLabel('Contraseña').fill('mala-clave-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos');
});
