// v0.19 (D65) en el panel, contra Supabase LOCAL: acciones desde un pedido frenado ligado a un cliente
// (Desbloquear y Escribir por WhatsApp) y exportación de clientes con autorización de promociones (CSV con
// auditoría). Celulares 3570000001–3570000005 y nombres sin dígitos; todo se borra al terminar (la auditoría
// no se borra: es de solo agregar).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ADMIN_ID, RID, goTo, loginAdmin, sql } from './ayudas';

const LIGADA = '3570000001'; // cliente bloqueado con un frenado ligado
const SUELTO = '3570000002'; // frenado sin cliente (el celular no existía)
const PROMO = '3570000003'; // autorizó promociones
const RETIRADA = '3570000004'; // autorizó y luego retiró
const PROMO_BLOQ = '3570000005'; // autorizó, pero está bloqueado
const PHONES = [LIGADA, SUELTO, PROMO, RETIRADA, PROMO_BLOQ];
const NAMES = ['Frenada Ligada', 'Frenado Suelto'];
const exportsCount = () =>
  Number(
    sql(
      `select count(*) from public.audit_log where restaurant_id = '${RID}' and action = 'exportar' and entity = 'clientes'`,
    ),
  );

test.beforeAll(() => {
  const customers: Array<[string, string, boolean]> = [
    [LIGADA, 'Frenada Ligada', true],
    [PROMO, 'Promo Autorizada', false],
    [RETIRADA, 'Promo Retirada', false],
    [PROMO_BLOQ, 'Promo Bloqueada', true],
  ];
  for (const [phone, name, blocked] of customers)
    sql(
      `insert into public.customers (restaurant_id, phone, name, blocked) values ('${RID}', '${phone}', '${name}', ${blocked})
       on conflict (restaurant_id, phone) do update set name = excluded.name, blocked = excluded.blocked`,
    );
  sql(`insert into public.blocked_attempts (restaurant_id, reason, customer_name, phone_last4, zone_name, total_attempt, items_count, customer_id)
    select '${RID}', 'bloqueado', 'Frenada Ligada', '0001', 'Chapinero', 42000, 2, id
    from public.customers where restaurant_id = '${RID}' and phone = '${LIGADA}'`);
  sql(`insert into public.blocked_attempts (restaurant_id, reason, customer_name, phone_last4, zone_name, total_attempt, items_count)
    values ('${RID}', 'fuera_de_zona', 'Frenado Suelto', '0002', 'Kennedy', 30000, 1)`);
  const consent = (phone: string, granted: boolean, at: string) =>
    sql(`insert into public.consents (restaurant_id, phone, kind, version, granted, source, at)
      values ('${RID}', '${phone}', 'promociones', 'e2e', ${granted}, 'e2e', now() - interval '${at}')`);
  consent(PROMO, true, '2 days');
  consent(RETIRADA, true, '3 days');
  consent(RETIRADA, false, '1 day');
  consent(PROMO_BLOQ, true, '2 days');
});
test.afterAll(() => {
  const list = `('${PHONES.join("', '")}')`;
  sql(
    `delete from public.blocked_attempts where restaurant_id = '${RID}' and customer_name in ('${NAMES.join("', '")}')`,
  );
  sql(`delete from public.consents where restaurant_id = '${RID}' and phone in ${list}`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone in ${list}`);
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
});
test.describe.configure({ mode: 'serial' });

test('seguridad: frenado ligado con Desbloquear y WhatsApp; sin vínculo, sin acciones (D65)', async ({
  page,
}) => {
  await loginAdmin(page);
  await goTo(page, 'Seguridad');
  await expect(page.getByRole('heading', { name: 'Seguridad', level: 1 })).toBeVisible();

  const ligada = page.getByRole('row', { name: /Frenada Ligada/ });
  const suelto = page.getByRole('row', { name: /Frenado Suelto/ });
  await expect(ligada).toBeVisible();
  await expect(suelto).toBeVisible();
  await expect(suelto.getByRole('button')).toHaveCount(0);
  await expect(suelto.getByRole('link')).toHaveCount(0);

  const whatsapp = ligada.getByRole('link', { name: 'Escribir por WhatsApp' });
  await expect(whatsapp).toHaveAttribute('href', new RegExp(`^https://wa\\.me/57${LIGADA}\\?text=`));
  await expect(whatsapp).toHaveAttribute('target', '_blank');
  // El celular completo solo va en el enlace: nunca se pinta en la lista.
  await expect(page.locator('main')).not.toContainText(LIGADA);
  await expect(ligada).toContainText('••••0001');

  // Cancelar la confirmación no cambia nada.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await ligada.getByRole('button', { name: 'Desbloquear' }).click();
  expect(
    sql(`select blocked from public.customers where restaurant_id = '${RID}' and phone = '${LIGADA}'`),
  ).toBe('t');

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Frenada Ligada');
    void dialog.accept();
  });
  await ligada.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(ligada.getByRole('button', { name: 'Desbloquear' })).toHaveCount(0);
  await expect(whatsapp).toBeVisible(); // sigue pudiendo escribirle
  expect(
    sql(`select blocked from public.customers where restaurant_id = '${RID}' and phone = '${LIGADA}'`),
  ).toBe('f');
});

test('clientes: exportar con autorización de promociones deja CSV y auditoría (D65)', async ({ page }) => {
  await loginAdmin(page);
  await goTo(page, 'Clientes');
  await expect(page.getByRole('heading', { name: 'Clientes', level: 1 })).toBeVisible();
  const before = exportsCount();

  const open = page.getByRole('button', { name: 'Exportar clientes con autorización de promociones' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Exportar clientes con autorización de promociones' });
  await expect(dialog).toContainText('Ley 1581');
  await expect(dialog).toContainText('solo para enviar promociones de JP Smoke');
  await expect(dialog).toContainText('auditoría');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  expect(exportsCount()).toBe(before); // cancelar no consulta ni audita

  await open.click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Entiendo, descargar CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^clientes-promociones-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const csv = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const [header, ...lines] = csv.split('\n');
  expect(header).toBe('Nombre,Celular,Autorizó promociones,Pedidos');
  expect(lines.some((line) => line.startsWith(`Promo Autorizada,${PROMO},`))).toBe(true);
  expect(csv).not.toContain(RETIRADA); // retiró la autorización
  expect(csv).not.toContain(PROMO_BLOQ); // bloqueado
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/CSV descargado: \d+ client/)).toBeVisible();
  expect(exportsCount()).toBe(before + 1);
});
