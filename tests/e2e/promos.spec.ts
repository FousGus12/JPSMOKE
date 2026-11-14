// Promociones, eventos y cotizaciones (F7) contra Supabase LOCAL. Restaura lo que cambia.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

const phone = () => `38${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
let intro = '';
test.beforeAll(() => {
  intro = sql(`select id from public.events where restaurant_id = '${RID}' and show_intro`);
});
test.afterAll(() => {
  sql(`delete from public.orders where restaurant_id = '${RID}' and coupon_code = 'E2E15'`);
  sql(`delete from public.coupons where restaurant_id = '${RID}' and code = 'E2E15'`);
  sql(`delete from public.events where restaurant_id = '${RID}' and title = 'Evento E2E'`);
  sql(`delete from public.quotes where restaurant_id = '${RID}' and name = 'Cotiza E2E'`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone like '38%'`);
  sql(`update public.events set show_intro = (id = '${intro}') where restaurant_id = '${RID}'`);
  sql(`update public.restaurant_settings set intro_mode = 'completa' where restaurant_id = '${RID}'`);
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('cupón secreto creado en el panel descuenta en un pedido real', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Promociones y cupones');
  await page.getByRole('button', { name: '＋ Cupón' }).click();
  await page.getByLabel('Código').fill('e2e15');
  await page.getByLabel('Porcentaje').fill('15');
  await page.getByLabel('Pedido mínimo').fill('0');
  await page.getByLabel('Texto para el cliente').fill('15% de prueba');
  await page.getByRole('button', { name: 'Guardar cupón' }).click();
  await expect(page.getByTestId('cupon-E2E15')).toBeVisible();

  // Un cupón secreto no se puede previsualizar en el navegador: lo valida y descuenta el servidor.
  const site = await page.context().newPage();
  await site.goto('/?intro=ninguna');
  await site
    .locator('#arsenal .pcard')
    .first()
    .getByRole('button', { name: /Agregar al pedido/ })
    .click(); // La Ahumadora sola $32.000
  await site.evaluate(() => (document.querySelector('[data-open-cart]') as HTMLElement).click());
  await site.getByLabel('Código de cupón').fill('e2e15');
  await site.getByRole('button', { name: 'Aplicar' }).click();
  await expect(site.getByText('El cupón E2E15 se valida al confirmar.')).toBeVisible();
  await site.getByRole('button', { name: 'Continuar con el pedido' }).click();
  const checkout = site.locator('#checkout');
  await checkout.getByLabel('Nombre').fill('Cupón Playwright');
  await checkout.getByLabel('Celular').fill(phone());
  await checkout.getByLabel('Dirección').fill('Calle 68 # 60-71');
  await checkout.getByLabel('Barrio').fill('Normandía');
  await checkout.getByLabel('Localidad').selectOption({ label: 'Engativá · $5.000' });
  await checkout.getByText('Nequi').click();
  await checkout.getByRole('checkbox').first().check();
  await site.waitForTimeout(4200);
  await checkout.getByRole('button', { name: 'Continuar' }).click();
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done')).toContainText('Total $32.200'); // 32.000 − 15% (4.800) + 5.000
  expect(sql(`select uses from public.coupons where restaurant_id = '${RID}' and code = 'E2E15'`)).toBe('1');
  await site.close();
});

test('evento nuevo y cambio de bienvenida', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Eventos y banners');
  await page.getByRole('button', { name: '＋ Evento' }).click();
  await page.getByLabel('Título').fill('Evento E2E');
  await page.getByLabel('Texto').fill('Prueba de evento');
  await page.getByRole('button', { name: 'Guardar evento' }).click();
  const card = page.getByTestId('evento-Evento E2E');
  await expect(card).toBeVisible();
  await card.getByLabel('Bienvenida').check();
  await expect(page.getByText('Es la bienvenida')).toBeVisible();
  expect(
    sql(`select string_agg(title, ',') from public.events where restaurant_id = '${RID}' and show_intro`),
  ).toBe('Evento E2E');
  await page.getByText('Aviso centrado').click();
  await expect(page.getByText('Bienvenida: Aviso centrado')).toBeVisible();
  expect(sql(`select intro_mode from public.restaurant_settings where restaurant_id = '${RID}'`)).toBe(
    'aviso',
  );
});

test('cotización desde la página llega al panel', async ({ page }) => {
  await page.goto('/?intro=ninguna');
  await page.locator('#tour').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Cotizar mi evento' }).click();
  const form = page.locator('#quote');
  await form.getByLabel('¿Qué necesitas?').selectOption('Catering al barril');
  await form.getByLabel('Nombre').fill('Cotiza E2E');
  await form.getByLabel('Celular').fill(phone());
  await form.getByLabel('Personas').fill('40');
  await form.getByLabel('Cuéntanos').fill('Cumpleaños de 40 personas en casa');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(page.getByText('Solicitud enviada')).toBeVisible();

  await loginAdmin(page);
  await goTo(page, 'Eventos y banners');
  const row = page.getByTestId('cotizacion-Cotiza E2E');
  await expect(row).toContainText('40 personas');
  await row.getByLabel('Estado de la cotización de Cotiza E2E').selectOption('contactada');
  await expect(page.getByText('Estado actualizado')).toBeVisible();
});
