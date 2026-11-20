// Adiciones ligadas a un plato (D40): el cliente elige a cuál hamburguesa va el huevo.
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { jumpTo, openCartJs } from './ayudas';

const DB = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
const sql = (query: string) => execFileSync('psql', [DB, '-Atqc', query], { encoding: 'utf8' }).trim();
const phone = `31${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

test.afterAll(() => {
  sql(`delete from public.orders where phone = '${phone}'`);
});

async function openCart(page: Page) {
  const bottom = page.locator('.bottom-bar button').filter({ visible: true });
  if (await bottom.count()) return bottom.click();
  await page.mouse.wheel(0, -300);
  await page.locator('.cart-btn').click();
}

test('una adición pregunta a cuál plato va y queda ligada en el pedido', async ({ page }) => {
  await page.goto('/?intro=ninguna');
  await page.locator('#arsenal').scrollIntoViewIfNeeded();
  const first = page.locator('#arsenal .pcard').first();
  const dish = (await first.locator('h3').first().textContent())?.trim() ?? '';
  await first.getByRole('button', { name: 'Sola' }).click();
  await first.getByRole('button', { name: /Agregar al pedido/ }).click();
  await first.getByRole('button', { name: /Agregar al pedido/ }).click();

  await page.locator('[data-cat-block="adicionales"]').scrollIntoViewIfNeeded();
  await page
    .locator('[data-cat-block="adicionales"] .extra', { hasText: 'Huevo frito' })
    .locator('button[data-add]')
    .click();

  const picker = page.getByRole('dialog', { name: /A cuál le agregas Huevo frito/ });
  await expect(picker).toBeVisible();
  await expect(picker.getByText('se la agregamos a 1 de las 2')).toBeVisible();
  await picker
    .getByRole('button', { name: new RegExp(dish, 'i') })
    .first()
    .click();
  await expect(picker).toBeHidden();

  await openCart(page);
  const cart = page.getByRole('dialog', { name: 'Mi pedido' });
  await expect(cart.locator('.line-addon')).toContainText(`Para ${dish}`);
  await cart.getByRole('button', { name: 'Continuar con el pedido' }).click();

  const checkout = page.locator('#checkout');
  await checkout.getByLabel('Nombre').fill('Prueba Adiciones');
  await checkout.getByLabel('Celular').fill(phone);
  await checkout.getByLabel('Dirección').fill('Calle 68 # 60-71');
  await checkout.getByLabel('Barrio').fill('Normandía');
  await checkout.getByLabel('Localidad').selectOption({ index: 1 });
  await checkout.getByText('Nequi').click();
  await checkout.getByRole('checkbox').first().check();
  await page.waitForTimeout(4200);
  await checkout.getByRole('button', { name: 'Continuar' }).click();
  await expect(checkout.locator('.sum-addon')).toContainText('Huevo frito');
  await checkout.getByRole('button', { name: /Confirmar pedido/ }).click();
  await expect(checkout.locator('.done .code')).toHaveText(/^JP-\d{4}$/);

  expect(
    sql(
      `select p.name || ' x' || p.qty from public.order_items h join public.order_items p on p.id = h.parent_item_id join public.orders o on o.id = h.order_id where o.phone = '${phone}' and h.name = 'Huevo frito'`,
    ),
  ).toBe(`${dish} x1`);
});

const cartStored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('jp-smoke:carrito') ?? '[]') as unknown[]);

test('sin un plato no se puede agregar una adición; con plato sí, y al quitar el plato se van (D47)', async ({
  page,
}) => {
  await page.goto('/?intro=ninguna');
  const huevo = page
    .locator('[data-cat-block="adicionales"] .extra', { hasText: 'Huevo frito' })
    .locator('button[data-add]');
  await jumpTo(page, '[data-cat-block="adicionales"]');
  await huevo.click();
  await expect(page.locator('#toasts')).toContainText('Primero elige un plato');
  await expect(page.getByRole('dialog', { name: /A cuál le agregas/ })).toHaveCount(0);
  expect(await cartStored(page)).toHaveLength(0);
  // Te lleva a la carta para elegir el plato.
  await expect
    .poll(() => page.evaluate(() => document.querySelector('#carta')?.getBoundingClientRect().top ?? 9999))
    .toBeLessThan(200);

  // Con un plato, la adición pregunta a cuál va y existe la opción "Aparte".
  await page.locator('#arsenal').scrollIntoViewIfNeeded();
  await page
    .locator('#arsenal .pcard')
    .first()
    .getByRole('button', { name: /Agregar al pedido/ })
    .click();
  await jumpTo(page, '[data-cat-block="adicionales"]');
  await huevo.click();
  const picker = page.getByRole('dialog', { name: /A cuál le agregas Huevo frito/ });
  await expect(picker.getByRole('button', { name: /Aparte/ })).toBeVisible();
  await picker.getByRole('button', { name: /Aparte/ }).click();
  await expect(page.locator('#toasts')).toContainText('agregado aparte');
  expect(await cartStored(page)).toHaveLength(2);

  // Si se quita el único plato, la adición también sale del pedido.
  await openCartJs(page);
  const cart = page.getByRole('dialog', { name: 'Mi pedido' });
  await cart.locator('.line:not(.line-addon)').first().getByRole('button', { name: 'Quitar uno' }).click();
  await expect(page.locator('#toasts')).toContainText('Quitamos las adiciones');
  await expect(cart.getByText('Barril vacío')).toBeVisible();
  expect(await cartStored(page)).toHaveLength(0);
});
