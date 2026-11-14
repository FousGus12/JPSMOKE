// WhatsApp (F9) en modo prueba y seguimiento por código + 4 dígitos, contra Supabase LOCAL.
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

let code = '';
test.beforeAll(() => {
  code =
    sql(`select public.place_order(jsonb_build_object('restaurant', 'jp-smoke', 'token', 'token-whatsapp-e2e-0001',
    'customer', jsonb_build_object('name', 'WhatsApp E2E', 'phone', '3400000001', 'address', 'Calle 68 # 60-71',
      'zone_id', (select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1)),
    'payment_code', 'nequi', 'items', jsonb_build_array(jsonb_build_object('product_id',
      (select id from public.products where restaurant_id = '${RID}' and slug = 'gaseosa-400'), 'qty', 6)))) ->> 'code'`);
});
test.afterAll(() => {
  sql(`delete from public.orders where restaurant_id = '${RID}' and customer_name = 'WhatsApp E2E'`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone = '3400000001'`);
  sql(
    `update public.supplies set stock = stock + 6 where restaurant_id = '${RID}' and name = 'Gaseosa 400 ml'`,
  );
  sql(`update public.restaurant_settings set whatsapp_mode = 'prueba' where restaurant_id = '${RID}'`);
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('un pedido web encola confirmación y aviso; el panel los muestra', async ({ page }) => {
  expect(
    sql(
      `select string_agg(kind::text, ',' order by kind) from public.whatsapp_messages m join public.orders o on o.id = m.order_id where o.code = '${code}' and o.restaurant_id = '${RID}'`,
    ),
  ).toBe('pedido_recibido,aviso_negocio');
  await loginAdmin(page);
  await goTo(page, 'WhatsApp');
  await expect(page.getByTestId(`wa-pedido_recibido-${code}`)).toBeVisible();
  await expect(page.getByText(/Recibimos tu pedido JP-0042/)).toBeVisible(); // vista previa de la plantilla
  await page.getByText('Apagado').click();
  await expect(page.getByText('WhatsApp: Apagado')).toBeVisible();
  expect(sql(`select whatsapp_mode from public.restaurant_settings where restaurant_id = '${RID}'`)).toBe(
    'manual',
  );
});

test('el enlace del mensaje (solo código) pide los 4 dígitos y muestra el pedido', async ({ page }) => {
  await page.goto(`/pedido?c=${code}`);
  await page.locator('#last4').fill('9999');
  await page.locator('#last4-form').getByRole('button', { name: 'Ver mi pedido' }).click();
  await expect(page.getByText('No coincide. Revisa los 4 dígitos.')).toBeVisible();
  await page.locator('#last4').fill('0001');
  await page.locator('#last4-form').getByRole('button', { name: 'Ver mi pedido' }).click();
  await expect(page.locator('.track-status')).toHaveText('Recibido');
});
