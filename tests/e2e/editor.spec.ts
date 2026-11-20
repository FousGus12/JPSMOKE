// Editor de carta y página (F6) contra Supabase LOCAL. Restaura lo que cambia al terminar.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

let before = '';
test.beforeAll(() => {
  before = sql(
    `select price || '|' || available || '|' || coalesce(image_path, '') from public.products where restaurant_id = '${RID}' and slug = 'la-ahumadora'`,
  );
  sql(`update public.restaurant_settings set published_at = null where restaurant_id = '${RID}'`);
});
test.afterAll(() => {
  const [price, available, image] = before.split('|');
  sql(
    `update public.products set price = ${price}, available = ${available}, image_path = nullif('${image}', '') where restaurant_id = '${RID}' and slug = 'la-ahumadora'`,
  );
  sql(`delete from public.products where restaurant_id = '${RID}' and slug = 'burger-e2e'`);
  sql(`update public.payment_methods set active = true where restaurant_id = '${RID}'`);
  sql(`delete from public.payment_methods where restaurant_id = '${RID}' and code = 'bold-e2e'`);
  sql(
    `update public.restaurant_settings set blocks = jsonb_set(blocks, '{promo,title}', '"El frío bogotano se corta con fuego"'), published_at = null where restaurant_id = '${RID}'`,
  );
  sql(
    `begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'carta' and name like '${RID}/%'; commit;`,
  );
  sql(
    `update public.restaurant_settings set pickup_enabled = false, store_open = false, store_address = null, store_maps_url = null, store_hours = '[]' where restaurant_id = '${RID}'`,
  );
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});

test.describe.configure({ mode: 'serial' });

test('carta: precio, agotado en vivo, foto y producto nuevo', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Carta y precios');
  const row = page.getByTestId('fila-la-ahumadora');
  await row.getByLabel('Precio de La Ahumadora').fill('33500');
  await row.getByLabel('Precio de La Ahumadora').press('Enter');
  await expect(page.getByText('Precio actualizado a $33.500')).toBeVisible();
  expect(
    sql(`select price from public.products where restaurant_id = '${RID}' and slug = 'la-ahumadora'`),
  ).toBe('33500');

  await row.getByLabel('La Ahumadora disponible').uncheck();
  await expect(page.getByText('Marcado como agotado')).toBeVisible();

  // Sin publicar: la página ya lo muestra agotado al cargar.
  const site = await page.context().newPage();
  await site.goto('/?intro=ninguna');
  await expect(site.locator('#arsenal [data-add]').first()).toBeDisabled();
  await site.close();

  await row.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Foto').setInputFiles('public/media/productos/burger-clasica.webp');
  await expect(page.getByText('Foto subida, liviana y sin metadatos')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Producto guardado')).toBeVisible();
  expect(
    sql(`select image_path from public.products where restaurant_id = '${RID}' and slug = 'la-ahumadora'`),
  ).toMatch(new RegExp(`^${RID}/[0-9a-f-]{36}\\.(webp|jpg)$`));

  await page.getByRole('button', { name: '＋ Producto' }).click();
  await page.getByLabel('Nombre').fill('Burger E2E');
  await page.getByLabel('Precio sola').fill('25000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('fila-burger-e2e')).toBeVisible();
});

test('editar página: textos, medios de pago y publicar', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Editar página'); // vive dentro del grupo desplegable "Contenido" (D41)
  await expect(page.getByRole('heading', { name: 'Editar página', level: 1 })).toBeVisible();
  // Canales, horario y redes salieron a Administración → Ajustes (D41/D45): un solo editor.
  await expect(page.getByLabel('Enlace de Rappi')).toHaveCount(0);
  await expect(page.getByLabel('Instagram')).toHaveCount(0);
  await page.getByLabel('Título de la promo').fill('Noche de humo');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(/Cambios guardados/)).toBeVisible();
  expect(
    sql(
      `select blocks -> 'promo' ->> 'title' from public.restaurant_settings where restaurant_id = '${RID}'`,
    ),
  ).toBe('Noche de humo');

  await page.getByRole('tab', { name: 'Domicilios y pagos' }).click();
  await page.getByLabel('Datáfono disponible').uncheck();
  await expect(page.getByText('Oculto en el pedido')).toBeVisible();
  await page.getByLabel('Nuevo medio de pago').fill('Bold E2E');
  await page
    .locator('section.card', { has: page.getByRole('heading', { name: 'Medios de pago' }) })
    .getByRole('button', { name: 'Agregar' })
    .click();
  await expect(page.getByText('Bold E2E agregado')).toBeVisible();

  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText(/Publicado/)).toBeVisible();
  expect(
    sql(`select published_at is not null from public.restaurant_settings where restaurant_id = '${RID}'`),
  ).toBe('t');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Espera un minuto entre publicaciones.')).toBeVisible();

  // En el pedido ya no aparece Datáfono y sí el medio nuevo (en vivo).
  const site = await page.context().newPage();
  await site.goto('/?intro=ninguna');
  await site
    .locator('#arsenal .pcard')
    .nth(1)
    .getByRole('button', { name: /Agregar al pedido/ })
    .click();
  await site.evaluate(() => (document.querySelector('[data-open-cart]') as HTMLElement).click());
  await site.getByRole('button', { name: 'Continuar con el pedido' }).click();
  await expect(site.locator('#checkout .pay')).toContainText('Bold E2E');
  await expect(site.locator('#checkout .pay')).not.toContainText('Datáfono');
  await site.close();
});

test('punto físico: abrir el local y permitir recoger', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Editar página');
  await page.getByRole('tab', { name: 'Punto físico' }).click();
  await expect(page.getByLabel('Permitir recoger en tienda')).toBeDisabled();
  await page.getByLabel('Local abierto al público').check();
  await page.getByLabel('Dirección del local').fill('Calle 68 # 60-71, Normandía');
  await page.getByLabel('Enlace de Google Maps').fill('https://maps.app.goo.gl/jpsmoke');
  await page.getByLabel('Permitir recoger en tienda').check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(/Cambios guardados/)).toBeVisible();
  expect(
    sql(
      `select store_open || '|' || store_address || '|' || pickup_enabled from public.restaurant_settings where restaurant_id = '${RID}'`,
    ),
  ).toBe('true|Calle 68 # 60-71, Normandía|true');
});

test('el operador no ve el editor', async ({ page }) => {
  await page.goto('/panel#carta');
  await page.getByLabel('Correo').fill('operador.dev@jpsmoke.test');
  await page.getByLabel('Contraseña').fill('JpSmokeDev-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen', level: 1 })).toBeVisible();
  await expect(page.locator('.side-nav button', { hasText: 'Carta y precios' })).toHaveCount(0);
});
