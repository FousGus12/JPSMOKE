// v0.19 · contenido editable en el panel (D56, D61, D62) contra Supabase LOCAL. Restaura lo que cambia.
import { expect, test } from '@playwright/test';
import { RID, goTo, loginAdmin, sql } from './ayudas';

let blocksBefore = '';
let etaBefore = '';
let eventBefore = '';
test.beforeAll(() => {
  blocksBefore = sql(`select blocks::text from public.restaurant_settings where restaurant_id = '${RID}'`);
  etaBefore = sql(
    `select eta_dynamic || '|' || eta_per_order_min || '|' || eta_max_extra_min from public.restaurant_settings where restaurant_id = '${RID}'`,
  );
  eventBefore = sql(
    `select id || '|' || coalesce(lead_copy::text, '') || '|' || ends_on from public.events where restaurant_id = '${RID}' and show_intro`,
  );
});
test.afterAll(() => {
  sql(
    `update public.restaurant_settings set blocks = '${blocksBefore.replace(/'/g, "''")}'::jsonb where restaurant_id = '${RID}'`,
  );
  const [dynamic, per, max] = etaBefore.split('|');
  sql(
    `update public.restaurant_settings set eta_dynamic = ${dynamic}, eta_per_order_min = ${per}, eta_max_extra_min = ${max} where restaurant_id = '${RID}'`,
  );
  const [id, copy, ends] = eventBefore.split('|');
  if (id)
    sql(
      `update public.events set lead_copy = ${copy ? `'${copy.replace(/'/g, "''")}'::jsonb` : 'null'}, ends_on = '${ends}' where id = '${id}'`,
    );
  sql(
    `begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'carta' and name like '${RID}/%'; commit;`,
  );
});

test.describe.configure({ mode: 'serial' });

test('títulos, cierre y botones: marcador, guardar y restaurar vacío', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Editar página');
  const kicker = page.getByLabel('Antetítulo de Carta completa');
  await expect(kicker).toHaveAttribute('placeholder', 'La carta completa');
  await kicker.fill('Todo el menú');
  const title = page.getByLabel('Título de Carta completa', { exact: true });
  await title.fill('Primera línea');
  await title.press('Enter');
  await title.pressSequentially('Segunda línea');
  await page.getByLabel('Botón principal').fill('Pide ya');
  await page.getByLabel('Nota con local abierto').fill('Ven al local');
  await page.getByLabel('Botón de Cierre').fill('Hacer pedido');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  const saved = sql(
    `select blocks->'titles'->'carta'->>'title' || '#' || (blocks->'cta'->>'primary') || '#' || (blocks->'cta'->>'note_open') || '#' || (blocks->'final'->>'button') from public.restaurant_settings where restaurant_id = '${RID}'`,
  );
  expect(saved).toBe('Primera línea\nSegunda línea#Pide ya#Ven al local#Hacer pedido');

  // Vaciar restaura el valor por defecto: la clave desaparece de la base.
  await kicker.fill('');
  await title.fill('');
  await page.getByLabel('Botón principal').fill('');
  await page.getByLabel('Nota con local abierto').fill('');
  await page.getByLabel('Botón de Cierre').fill('');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados').last()).toBeVisible();
  expect(
    sql(
      `select coalesce(blocks->'titles'->'carta', 'null'::jsonb)::text || (blocks ? 'cta') || (blocks ? 'final') from public.restaurant_settings where restaurant_id = '${RID}'`,
    ),
  ).toBe('nullfalsefalse');
});

test('imagen de Promoción: sube a la carpeta del restaurante y vuelve a la original', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Editar página');
  await page.getByLabel('Imagen de la promo').setInputFiles('public/media/productos/burger-clasica.webp');
  await expect(page.getByText('Imagen subida')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  expect(
    sql(`select blocks->'promo'->>'image' from public.restaurant_settings where restaurant_id = '${RID}'`),
  ).toMatch(new RegExp(`^${RID}/.+\\.(webp|jpg)$`));
  await page.getByRole('button', { name: 'Volver a la original' }).first().click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados').last()).toBeVisible();
  expect(
    sql(`select blocks->'promo' ? 'image' from public.restaurant_settings where restaurant_id = '${RID}'`),
  ).toBe('f');
});

test('hora estimada dinámica: interruptor, minutos, tope y vista previa', async ({ page }) => {
  sql(`update public.restaurant_settings set delivery_eta = '30–40 min' where restaurant_id = '${RID}'`);
  await loginAdmin(page);
  await goTo(page, 'Editar página');
  await page.getByRole('tab', { name: 'Domicilios y pagos' }).click();
  await expect(page.getByTestId('eta-preview')).toContainText('Ahora mismo el cliente ve');
  await page.getByLabel('Hora estimada dinámica').check();
  await page.getByLabel('Minutos por pedido activo').fill('5');
  await page.getByLabel('Máximo de minutos extra').fill('25');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  expect(
    sql(
      `select eta_dynamic || '|' || eta_per_order_min || '|' || eta_max_extra_min from public.restaurant_settings where restaurant_id = '${RID}'`,
    ),
  ).toBe('true|5|25');
  await expect(page.getByTestId('eta-preview')).toContainText('min.');
});

test('bienvenida: textos del cupón y aviso de fecha vencida', async ({ page }) => {
  const [id] = eventBefore.split('|');
  sql(`update public.events set captures_leads = true, ends_on = current_date - 3 where id = '${id}'`);
  await loginAdmin(page);
  await goTo(page, 'Eventos y banners');
  await expect(page.getByText('La bienvenida dejó de verse sola el')).toBeVisible();
  await page.getByRole('button', { name: 'Editar bienvenida' }).click();
  const title = page.getByLabel('Título del cupón', { exact: true });
  await expect(title).toHaveAttribute('placeholder', 'Tu primera mordida va con descuento');
  await title.fill('Hoy te toca descuento');
  await page.getByLabel('Botón del cupón').fill('Dame el cupón');
  await page.getByRole('button', { name: 'Guardar evento' }).click();
  await expect(page.getByText('Evento guardado')).toBeVisible();
  expect(
    sql(`select lead_copy->>'title' || '#' || (lead_copy->>'button') from public.events where id = '${id}'`),
  ).toBe('Hoy te toca descuento#Dame el cupón');
});
