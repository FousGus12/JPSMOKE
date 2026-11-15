// Equipo (D38): el admin crea una cuenta con apartados, la persona entra con la clave temporal y el
// segundo paso, y ve solo lo delegado. Contra Supabase LOCAL (Edge Function `equipo`).
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_ID, goTo, loginAdmin, sql, totp } from './ayudas';

const EMAIL = 'equipo.e2e@jpsmoke.test';
let temp = '';

const cleanup = () => {
  sql(`delete from auth.users where email = '${EMAIL}'`);
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
};
test.beforeAll(cleanup);
test.afterAll(cleanup);
test.describe.configure({ mode: 'serial' });

async function enroll(page: Page) {
  await expect(page.getByRole('heading', { name: 'Activa tu código de seguridad' })).toBeVisible({
    timeout: 15_000,
  });
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  if (30_000 - (Date.now() % 30_000) < 4_000) await page.waitForTimeout(4_500);
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

test('el admin crea un operador con Ventas y ve la clave una sola vez', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Equipo y permisos');
  await page.getByLabel('Nombre').fill('Prueba Equipo');
  await page.locator('.team-form').getByLabel('Correo').fill(EMAIL);
  await page.locator('.team-form').getByLabel('Ventas y estadísticas').check();
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  temp = (await page.getByTestId('temp-pass').textContent())?.trim() ?? '';
  expect(temp).toHaveLength(24);
  await page.getByRole('button', { name: 'Listo' }).click();
  const row = page.getByTestId(`miembro-${EMAIL}`);
  await expect(row).toContainText('Ventas y estadísticas');
  expect(
    sql(
      `select s.role || ':' || array_to_string(s.permissions, ',') from public.staff s join auth.users u on u.id = s.user_id where u.email = '${EMAIL}'`,
    ),
  ).toBe('operador:ventas');
  // Su propio acceso no se puede cambiar desde aquí.
  await expect(page.getByTestId('miembro-admin.dev@jpsmoke.test').getByLabel('Rol')).toBeDisabled();
});

test('la persona entra con la clave temporal, crea la suya, activa su código y ve solo lo suyo', async ({
  page,
}) => {
  await page.goto('/panel');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill(temp);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // D39: con la clave temporal, primero debe crear la suya.
  await expect(page.getByRole('heading', { name: 'Crea tu contraseña' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Nueva contraseña (mínimo 12 caracteres)').fill('MiClavePropia-2026');
  await page.getByLabel('Repítela').fill('MiClavePropia-2026');
  await page.getByRole('button', { name: 'Guardar y seguir' }).click();
  await enroll(page);
  expect(
    sql(
      `select s.must_change_password from public.staff s join auth.users u on u.id = s.user_id where u.email = '${EMAIL}'`,
    ),
  ).toBe('f');
  const nav = page.locator('.side-nav');
  await expect(nav.getByRole('button', { name: /Ventas y estadísticas/ })).toBeAttached();
  await expect(nav.getByRole('button', { name: /Carta y precios/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /Equipo/ })).toHaveCount(0);
  await goTo(page, 'Ventas y estadísticas');
  await expect(page.getByRole('heading', { name: 'Ventas y estadísticas' })).toBeVisible();
});

test('el admin desactiva la cuenta y queda sin acceso', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Equipo y permisos');
  const row = page.getByTestId(`miembro-${EMAIL}`);
  await row.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByTestId(`miembro-${EMAIL}`)).toContainText('Desactivada');
  expect(
    sql(
      `select s.active from public.staff s join auth.users u on u.id = s.user_id where u.email = '${EMAIL}'`,
    ),
  ).toBe('f');
});
