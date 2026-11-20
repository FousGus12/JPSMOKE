// Panel v0.18 (segunda tanda), contra Supabase LOCAL: arrastrar pedidos en el tablero (mouse y dedo),
// Recibo imprimible y dibujos del seguimiento. Celulares 3560000001–3560000007 y nombres sin dígitos;
// todo se borra al terminar.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { RID, goTo, loginAdmin, sql } from './ayudas';

const PHONES = [
  '3560000001',
  '3560000002',
  '3560000003',
  '3560000004',
  '3560000005',
  '3560000006',
  '3560000007',
];
const [ADELANTE, ATRAS, ENTREGAR, DEDO, RECIBO, SEGUIR, SALTAR] = PHONES as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const codes: Record<string, string> = {};
/** Código del pedido sembrado para ese celular (falla claro si beforeAll no lo creó). */
function codeOf(phone: string): string {
  const code = codes[phone];
  if (!code) throw new Error(`Sin pedido sembrado para ${phone}`);
  return code;
}
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Elemento sin caja visible');
  return box;
}

const zone = `(select id from public.delivery_zones where restaurant_id = '${RID}' and active order by position limit 1)`;
const product = (slug: string) =>
  `(select id from public.products where restaurant_id = '${RID}' and slug = '${slug}')`;

/** Pedido web directo en la base (2 Clásicas para pasar el mínimo de domicilio); con `addon` agrega un huevo ligado al plato. */
function seed(phone: string, name: string, addon = false): string {
  const items = [
    `jsonb_build_object('key', 'a', 'product_id', ${product('la-clasica')}, 'qty', 2)`,
    ...(addon
      ? [`jsonb_build_object('key', 'b', 'parent', 'a', 'product_id', ${product('add-huevo')}, 'qty', 1)`]
      : []),
  ].join(', ');
  const result = JSON.parse(
    sql(`select public.place_order(jsonb_build_object('restaurant', 'jp-smoke', 'token', 'token-e2e-${phone}-0001',
      'customer', jsonb_build_object('name', '${name}', 'phone', '${phone}', 'address', 'Calle 68 # 60-71', 'zone_id', ${zone}),
      'payment_code', 'nequi', 'items', jsonb_build_array(${items})))::text`),
  ) as { ok: boolean; code?: string };
  if (!result.ok || !result.code) throw new Error(`place_order falló: ${JSON.stringify(result)}`);
  return result.code;
}
const statusOf = (code: string) =>
  sql(`select status from public.orders where restaurant_id = '${RID}' and code = '${code}'`);

// Avanzar y entregar descuenta insumos; borrar los movimientos no los devuelve. Se guarda el stock
// al empezar y se repone al final, para que corridas seguidas no agoten La Clásica.
let stockSnapshot = '';
test.beforeAll(() => {
  cleanup();
  stockSnapshot = sql(
    `select string_agg(id || ':' || stock, ',') from public.supplies where restaurant_id = '${RID}'`,
  );
  codes[ADELANTE] = seed(ADELANTE, 'Arrastre Adelante');
  codes[ATRAS] = seed(ATRAS, 'Arrastre Atras');
  sql(
    `update public.orders set status = 'confirmado' where restaurant_id = '${RID}' and code = '${codes[ATRAS]}'`,
  );
  codes[ENTREGAR] = seed(ENTREGAR, 'Arrastre Entregar');
  codes[DEDO] = seed(DEDO, 'Arrastre Dedo');
  codes[RECIBO] = seed(RECIBO, 'Recibo Adicion', true);
  codes[SEGUIR] = seed(SEGUIR, 'Seguir Dibujo');
  codes[SALTAR] = seed(SALTAR, 'Arrastre Saltar');
});
function cleanup() {
  sql(
    `delete from public.supply_moves where order_id in (select id from public.orders where restaurant_id = '${RID}' and phone in ('${PHONES.join("', '")}'))`,
  );
  sql(`delete from public.orders where restaurant_id = '${RID}' and phone in ('${PHONES.join("', '")}')`);
  sql(`delete from public.customers where restaurant_id = '${RID}' and phone in ('${PHONES.join("', '")}')`);
}
test.afterAll(() => {
  cleanup();
  for (const pair of stockSnapshot.split(',').filter(Boolean)) {
    const [id, stock] = pair.split(':');
    sql(`update public.supplies set stock = ${stock} where id = '${id}'`);
  }
});
test.describe.configure({ mode: 'serial' });

async function openBoard(page: Page) {
  await loginAdmin(page);
  await goTo(page, 'Pedidos');
  await expect(page.getByTestId(`pedido-${codes[ADELANTE]}`)).toBeVisible({ timeout: 25_000 });
}

/** Arrastra con el mouse (movimiento > 6 px y luego hasta la columna) y suelta. */
async function dragWithMouse(page: Page, code: string, column: string) {
  const card = page.getByTestId(`pedido-${code}`);
  await card.scrollIntoViewIfNeeded();
  const from = await boxOf(card);
  const to = await boxOf(page.locator(`[data-col="${column}"]`));
  const x = from.x + from.width / 2;
  const y = from.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 4, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, y, { steps: 12 });
  await page.mouse.up();
}

test.describe('tablero con mouse', () => {
  // La condición de test.skip solo recibe fixtures (no testInfo): se decide por isMobile.
  test.skip(({ isMobile }) => isMobile, 'el mouse se prueba en escritorio');

  test('arrastrar a la columna siguiente cambia el estado en la base', async ({ page }) => {
    await openBoard(page);
    await dragWithMouse(page, codeOf(ADELANTE), 'confirmado');
    await expect(
      page.getByRole('region', { name: 'Confirmados' }).getByTestId(`pedido-${codes[ADELANTE]}`),
    ).toBeVisible();
    await expect.poll(() => statusOf(codeOf(ADELANTE))).toBe('confirmado');
    // Arrastrar no abre el pedido.
    await expect(page.getByRole('dialog', { name: /· Confirmado/ })).toHaveCount(0);
  });

  test('soltar en una columna anterior vuelve la tarjeta y avisa', async ({ page }) => {
    await openBoard(page);
    await dragWithMouse(page, codeOf(ATRAS), 'nuevo');
    await expect(page.getByText('Solo se avanza: no puede volver a Nuevo.').first()).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Confirmados' }).getByTestId(`pedido-${codes[ATRAS]}`),
    ).toBeVisible();
    expect(statusOf(codeOf(ATRAS))).toBe('confirmado');
  });

  test('a Entregado y saltando estados pide confirmación', async ({ page }) => {
    await openBoard(page);
    // A Entregado: cancelar la deja donde estaba; confirmar la cambia.
    await dragWithMouse(page, codeOf(ENTREGAR), 'entregado');
    const dialog = page.getByRole('dialog', { name: 'Confirmar cambio' });
    await expect(dialog).toContainText(
      `¿Marcar ${codes[ENTREGAR]} como entregado? El operador no puede deshacerlo.`,
    );
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    expect(statusOf(codeOf(ENTREGAR))).toBe('nuevo');
    await expect(
      page.getByRole('region', { name: 'Nuevos' }).getByTestId(`pedido-${codes[ENTREGAR]}`),
    ).toBeVisible();

    await dragWithMouse(page, codeOf(ENTREGAR), 'entregado');
    await page
      .getByRole('dialog', { name: 'Confirmar cambio' })
      .getByRole('button', { name: 'Sí, cambiar' })
      .click();
    // D60: la entrega sale a los 10 s (con "Deshacer" mientras tanto).
    await expect.poll(() => statusOf(codeOf(ENTREGAR)), { timeout: 16_000 }).toBe('entregado');

    // Saltar de Nuevo a En camino (dos pasos o más).
    await dragWithMouse(page, codeOf(SALTAR), 'en_camino');
    const jump = page.getByRole('dialog', { name: 'Confirmar cambio' });
    await expect(jump).toContainText(
      `¿Pasar ${codes[SALTAR]} de Nuevo a En camino? Se salta pasos del flujo.`,
    );
    expect(statusOf(codeOf(SALTAR))).toBe('nuevo');
    await jump.getByRole('button', { name: 'Sí, cambiar' }).click();
    await expect.poll(() => statusOf(codeOf(SALTAR))).toBe('en_camino');
  });
});

test.describe('tablero con el dedo', () => {
  test.skip(({ isMobile }) => !isMobile, 'el dedo se prueba en android e iphone');

  /** Eventos de puntero táctil sintéticos: Playwright no hace pulsación larga con touchscreen. */
  async function touch(page: Page, code: string, column: string, holdMs: number, dx: number) {
    const card = page.getByTestId(`pedido-${code}`);
    // Solo la tarjeta se trae a la vista: el dedo empieza sobre ella (si se trajera la columna destino,
    // la tarjeta quedaría fuera de pantalla y el auto-desplazamiento del borde movería el tablero).
    await card.scrollIntoViewIfNeeded();
    await card.evaluate(
      async (el, args) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + 20;
        const y = rect.top + 20;
        // Destino: el centro de la parte visible de la columna dentro del tablero (como haría el dedo).
        const board = el.closest('.board')?.getBoundingClientRect();
        const col = document.querySelector(`[data-col="${args.column}"]`)?.getBoundingClientRect();
        if (!board || !col) throw new Error('Sin tablero o columna destino');
        const targetX = (Math.max(col.left, board.left) + Math.min(col.right, board.right)) / 2;
        const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true };
        el.dispatchEvent(
          new PointerEvent('pointerdown', { ...init, button: 0, buttons: 1, clientX: x, clientY: y }),
        );
        await new Promise((resolve) => setTimeout(resolve, args.holdMs));
        const endX = args.dx ? x + args.dx : targetX;
        window.dispatchEvent(
          new PointerEvent('pointermove', { ...init, buttons: 1, clientX: endX, clientY: y }),
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
        window.dispatchEvent(
          new PointerEvent('pointerup', { ...init, buttons: 0, clientX: endX, clientY: y }),
        );
      },
      { holdMs, dx, column },
    );
  }

  test('pulsación larga y movimiento: mueve el pedido; moverse antes solo desplaza', async ({ page }) => {
    await openBoard(page);
    // Mover antes de los 250 ms es desplazar el tablero: no arrastra ni cambia nada.
    await touch(page, codeOf(DEDO), 'confirmado', 20, 40);
    await page.waitForTimeout(450);
    await expect(page.locator('.ocard-ghost')).toHaveCount(0);
    await expect(page.locator('.board.is-dragging')).toHaveCount(0);
    expect(statusOf(codeOf(DEDO))).toBe('nuevo');

    // Pulsación larga (> 250 ms) y soltar en Confirmados.
    await touch(page, codeOf(DEDO), 'confirmado', 450, 0);
    await expect.poll(() => statusOf(codeOf(DEDO))).toBe('confirmado');
    await expect(page.locator('.ocard-ghost')).toHaveCount(0);
  });
});

test('Recibo: logo, código, total, adición anidada, leyenda y tamaño recordado', async ({ page }) => {
  const code = codeOf(RECIBO);
  const total = Number(
    sql(`select total from public.orders where restaurant_id = '${RID}' and code = '${code}'`),
  );
  await openBoard(page);
  await page.getByTestId(`pedido-${code}`).click();
  await page.getByRole('button', { name: 'Recibo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Recibo ${code}` });
  await expect(dialog).toBeVisible();
  const paper = dialog.locator('.recibo-paper');
  await expect(paper.locator('svg.recibo-logo')).toBeVisible();
  await expect(paper.locator('.recibo-code')).toHaveText(code);
  // toHaveText no acepta funciones: se comparan solo los dígitos del total.
  await expect
    .poll(async () => (await paper.locator('.recibo-total dd').textContent())?.replace(/\D/g, ''))
    .toBe(String(total));
  await expect(paper.locator('.recibo-items li').first()).toContainText('2 × La Clásica');
  await expect(paper.locator('.recibo-items li.recibo-addon')).toContainText('Huevo frito');
  await expect(paper.locator('.recibo-items li').nth(1)).toHaveClass(/recibo-addon/);
  await expect(paper).toContainText('no válido como factura electrónica');

  // Tamaño: cambia y se recuerda al reabrir.
  const group = dialog.getByRole('group', { name: 'Tamaño del papel' });
  await expect(group.getByRole('button', { name: 'Tirilla 80 mm' })).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: 'Tirilla 58 mm' }).click();
  await expect(group.getByRole('button', { name: 'Tirilla 58 mm' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.recibo')).toHaveClass(/recibo-t58/);
  expect(await page.evaluate(() => localStorage.getItem('jp-recibo-tamano'))).toBe('t58');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Recibo', exact: true }).click();
  const again = page.getByRole('dialog', { name: `Recibo ${code}` });
  await expect(again.getByRole('button', { name: 'Tirilla 58 mm' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => localStorage.removeItem('jp-recibo-tamano'));
});

test.describe('seguimiento con dibujo', () => {
  async function openTracking(page: Page, code: string) {
    await page.goto(`/pedido?c=${code}`);
    await page.locator('#last4').fill(SEGUIR.slice(-4));
    await page.locator('#last4-form').getByRole('button', { name: 'Ver mi pedido' }).click();
    await expect(page.locator('.track-status')).toBeVisible();
  }

  test('el dibujo cambia con el estado y cancelado no muestra el motivo interno', async ({ page }) => {
    const code = codeOf(SEGUIR);
    await openTracking(page, code);
    await expect(page.locator('.track-status')).toHaveText('Recibido');
    await expect(page.locator('.track-art')).toHaveAttribute('data-key', 'nuevo:domicilio');
    await expect(page.locator('.track-art svg')).toBeVisible();

    for (const [status, key] of [
      ['confirmado', 'confirmado:domicilio'],
      ['en_cocina', 'en_cocina:domicilio'],
      ['en_camino', 'en_camino:domicilio'],
    ] as const) {
      sql(
        `update public.orders set status = '${status}' where restaurant_id = '${RID}' and code = '${code}'`,
      );
      await page.reload();
      await expect(page.locator('.track-art')).toHaveAttribute('data-key', key);
    }

    sql(
      `update public.orders set status = 'cancelado', cancel_reason = 'Motivo interno secreto' where restaurant_id = '${RID}' and code = '${code}'`,
    );
    await page.reload();
    await expect(page.locator('.track-status')).toHaveText('Cancelado');
    await expect(page.locator('.track-art')).toHaveCount(0);
    await expect(page.locator('#track-main')).toContainText('Tu pedido fue cancelado');
    await expect(page.locator('body')).not.toContainText('Motivo interno secreto');
  });

  test.describe('con movimiento reducido', () => {
    test.use({ reducedMotion: 'reduce' });
    test('el dibujo existe aunque no se anime', async ({ page }) => {
      const code = codeOf(SEGUIR);
      sql(
        `update public.orders set status = 'en_cocina', cancel_reason = null where restaurant_id = '${RID}' and code = '${code}'`,
      );
      await openTracking(page, code);
      await expect(page.locator('.track-art')).toHaveAttribute('data-key', 'en_cocina:domicilio');
      await expect(page.locator('.track-art svg')).toBeVisible();
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    });
  });
});
