// Panel v0.19 (armazón), contra Supabase LOCAL: Reseñas (D57), Pausar pedidos (D61) y aviso de versión (D67).
// Autores "Prueba Resena Uno/Dos" (sin dígitos); todo se borra al terminar y la pausa queda reanudada.
import { expect, test } from '@playwright/test';
import { RID, goTo, loginAdmin, sql } from './ayudas';

const UNO = 'Prueba Resena Uno';
const DOS = 'Prueba Resena Dos';
const clean = () => {
  sql(`delete from public.reviews where restaurant_id = '${RID}' and author like 'Prueba Resena %'`);
  sql(`update public.restaurant_settings set orders_paused_until = null where restaurant_id = '${RID}'`);
};
test.beforeAll(clean);
test.afterAll(clean);

test('reseñas: alta con fuente obligatoria, aprobar, ordenar y borrar', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Reseñas');
  await expect(page.getByText('Solo reseñas reales; se ven en la página al publicar.')).toBeVisible();

  const create = async (author: string, text: string) => {
    await page.getByRole('button', { name: /Nueva reseña/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Nueva reseña' });
    await dialog.getByLabel('Autor').fill(author);
    await dialog.getByRole('button', { name: '5 estrellas' }).click();
    await dialog.getByLabel('Texto').fill(text);
    return dialog;
  };

  // Sin fuente no guarda.
  const first = await create(UNO, 'Hamburguesa buenísima, volvemos pronto.');
  await first.getByRole('button', { name: 'Guardar reseña' }).click();
  await expect(first.getByRole('alert')).toContainText('fuente');
  await first.getByLabel('Fuente').selectOption('Google');
  await first.getByRole('button', { name: 'Guardar reseña' }).click();
  await expect(first).toBeHidden();

  const second = await create(DOS, 'Las papas al barril, de otro nivel.');
  await second.getByLabel('Fuente').selectOption('Instagram');
  await second.getByLabel('Visible en la página al publicar').check();
  await second.getByRole('button', { name: 'Guardar reseña' }).click();
  await expect(second).toBeHidden();

  const cards = page.locator('.review').filter({ hasText: 'Prueba Resena' });
  await expect(cards).toHaveCount(2);
  expect(sql(`select approved from public.reviews where author = '${UNO}'`)).toBe('f');
  expect(sql(`select source from public.reviews where author = '${DOS}'`)).toBe('Instagram');

  // Aprobar la primera y subir la segunda.
  await cards.filter({ hasText: UNO }).getByRole('button', { name: 'Aprobar' }).click();
  await expect.poll(() => sql(`select approved from public.reviews where author = '${UNO}'`)).toBe('t');
  await page.getByRole('button', { name: `Subir la reseña de ${DOS}` }).click();
  await expect
    .poll(() =>
      sql(
        `select author from public.reviews where restaurant_id = '${RID}' and author like 'Prueba Resena %' order by position, review_date desc limit 1`,
      ),
    )
    .toBe(DOS);

  // Borrar con confirmación.
  page.once('dialog', (dialog) => void dialog.accept());
  await cards.filter({ hasText: UNO }).getByRole('button', { name: 'Borrar' }).click();
  await expect(cards).toHaveCount(1);
});

test('pausar pedidos: 15 min, cuenta regresiva y reanudar', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('button', { name: /Pausar pedidos/ }).click();
  await page.getByRole('button', { name: '15 min' }).click();
  // El aviso también sale en la región viva del panel (panel-live): se apunta al indicador de la barra.
  const state = page.locator('.pause-state');
  // Escritorio: "Pausado · vuelve a las HH:MM"; celular: "Hasta las HH:MM" (el DOM trae ambos textos).
  await expect(state).toBeVisible();
  await expect(state).toContainText(/las \d{2}:\d{2}/);
  expect(
    Number(
      sql(
        `select extract(epoch from orders_paused_until - now())::int from public.restaurant_settings where restaurant_id = '${RID}'`,
      ),
    ),
  ).toBeGreaterThan(800);
  await page.getByRole('button', { name: 'Reanudar' }).click();
  await expect(state).toBeHidden();
  expect(
    sql(`select orders_paused_until is null from public.restaurant_settings where restaurant_id = '${RID}'`),
  ).toBe('t');
});

test('versión nueva: el aviso aparece al volver a la pestaña con otro id', async ({ page }) => {
  await page.route('**/version.json', (route) =>
    route.fulfill({ json: { id: 'otra-compilacion-simulada' } }),
  );
  await loginAdmin(page);
  await expect(page.getByText('Hay una versión nueva del panel')).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('Hay una versión nueva del panel')).toBeVisible();
});
