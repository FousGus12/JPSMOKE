// Guardia CSP del sitio público: ninguna página debe disparar `securitypolicyviolation`.
// WebKit (iPhone) reporta style-src-attr donde Chromium calla, por eso se corre en ambos proyectos.
// Registra violación (directiva, archivo, línea, muestra) y, con un MutationObserver sobre el atributo
// `style`, la pila de quien lo escribió, para rastrear el origen. Corre contra el build (dist).
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { welcomeClock } from './ayudas';

type Violation = {
  directive: string;
  blocked: string;
  source: string;
  line: number;
  column: number;
  sample: string;
};
type StyleWrite = { tag: string; cls: string; id: string; value: string | null; stack: string };
type Report = { violations: Violation[]; writes: StyleWrite[]; calls: string[]; selects: number };

/*
 * CONOCIDA (WebKit, no Chromium): cada <select> —estático o creado por JS— dispara UNA violación
 * `style-src-attr` (sample vacío, sin archivo) porque WebKit le pone un estilo en línea interno al
 * crear su UA shadow tree; sin `style-src-attr 'unsafe-inline'` la CSP lo reporta. Selects del sitio:
 * #cover-loc y #q-title/#q-tipo (index.astro), #f-zone (sitio.ts, checkout). Es inocua (el select se ve y
 * funciona), pero ensucia la consola. Mientras no se corrija, cada guardia tolera como máximo UNA
 * `style-src-attr` por <select> insertado; cualquier otra violación, o más de una por select, falla.
 * La prueba estricta está marcada test.fixme al final del archivo.
 * D67: NO se abre "style-src-attr 'unsafe-inline'" para callarla.
 */

async function arm(page: Page) {
  // Hermético: sin la vitrina en vivo, el sitio se queda con los productos del build (si la base local se
  // re-sembró después de compilar, los ids en vivo no coinciden y todo aparece "agotado").
  await page.route(/\/rest\/v1\/products\?/, (route) => route.abort());
  await page.addInitScript(() => {
    const win = window as unknown as { __csp: Report };
    win.__csp = { violations: [], writes: [], calls: [], selects: 0 };
    const seen = new WeakSet<Element>();
    new MutationObserver((records) => {
      for (const rec of records)
        rec.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = node as Element;
          const found = el.tagName === 'SELECT' ? [el] : [...el.querySelectorAll('select')];
          for (const sel of found)
            if (!seen.has(sel)) {
              seen.add(sel);
              win.__csp.selects += 1;
            }
        });
    }).observe(document, { childList: true, subtree: true });
    // Pila de quien escribe estilos por CSSOM (setProperty/removeProperty/setAttribute('style')).
    const proto = CSSStyleDeclaration.prototype;
    for (const name of ['setProperty', 'removeProperty'] as const) {
      const original = proto[name] as (...args: unknown[]) => unknown;
      (proto as unknown as Record<string, unknown>)[name] = function (
        this: CSSStyleDeclaration,
        ...args: unknown[]
      ) {
        win.__csp.calls.push(
          `${name}(${String(args[0])}) ${(new Error().stack ?? '').split('\n').slice(1, 4).join(' | ')}`,
        );
        return original.apply(this, args);
      };
    }
    document.addEventListener('securitypolicyviolation', (ev) => {
      win.__csp.violations.push({
        directive: ev.violatedDirective,
        blocked: ev.blockedURI,
        source: ev.sourceFile,
        line: ev.lineNumber,
        column: ev.columnNumber,
        sample: ev.sample,
      });
    });
    new MutationObserver((records) => {
      for (const rec of records) {
        const el = rec.target as HTMLElement;
        win.__csp.writes.push({
          tag: el.tagName,
          cls: String(el.className ?? '').slice(0, 80),
          id: el.id ?? '',
          value: el.getAttribute('style'),
          stack: (new Error().stack ?? '').split('\n').slice(2, 8).join(' | '),
        });
      }
    }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true });
  });
}

async function collect(page: Page): Promise<Report> {
  return page.evaluate(() => (window as unknown as { __csp: Report }).__csp);
}

async function check(page: Page, info: TestInfo, step: string, { strict = false } = {}) {
  const report = await collect(page);
  let tolerated = strict ? 0 : report.selects;
  const fresh = report.violations.filter((viol) => {
    if (viol.directive.startsWith('style-src-attr') && tolerated > 0) {
      tolerated -= 1;
      return false;
    }
    return true;
  });
  if (report.violations.length)
    console.log(
      `[csp ${info.project.name}] ${step}: ${report.violations.length} violaciones, ${report.selects} <select>: ${JSON.stringify(report.violations.slice(0, 4))}\n  escrituras style: ${JSON.stringify(report.writes.slice(0, 10))}\n  llamadas CSSOM: ${JSON.stringify(report.calls.slice(0, 3))}`,
    );
  expect(fresh, `${info.project.name} · ${step}`).toEqual([]);
}

const recorrido = async (page: Page, info: TestInfo, url: string) => {
  await arm(page);
  await welcomeClock(page); // la bienvenida solo sale dentro de sus fechas (D62)
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500); // bienvenida y animaciones de entrada
  await page
    .locator('[data-intro-close]')
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await check(page, info, `carga ${url}`);

  await page.locator('#arsenal').scrollIntoViewIfNeeded();
  const card = page.locator('#arsenal .pcard').first();
  await card.getByRole('button', { name: 'Sola' }).click();
  await card.getByRole('button', { name: /Agregar al pedido/ }).click();
  await check(page, info, 'agregar producto');

  await page.evaluate(() => (document.querySelector('[data-open-cart]') as HTMLElement).click());
  const cart = page.getByRole('dialog', { name: 'Mi pedido' });
  await cart.waitFor();
  await page.waitForTimeout(600);
  await check(page, info, 'abrir carrito');

  await page.locator('#coupon-in').fill('NOEXISTE');
  await page.locator('#coupon-btn').click();
  await page.waitForTimeout(600);
  await check(page, info, 'cupón en carrito');

  await cart.getByRole('button', { name: 'Continuar con el pedido' }).click();
  await page.waitForTimeout(600);
  await check(page, info, 'checkout');
};

test('inicio con bienvenida: sin violaciones CSP', async ({ page }, info) => {
  await recorrido(page, info, '/');
});

test('inicio con ?intro=ninguna: sin violaciones CSP', async ({ page }, info) => {
  await recorrido(page, info, '/?intro=ninguna');
});

test('cotización de eventos y cupón de captación: sin violaciones CSP', async ({ page }, info) => {
  await arm(page);
  await page.goto('/?intro=ninguna');
  await page.waitForLoadState('networkidle');
  await page.locator('#open-quote').scrollIntoViewIfNeeded();
  await page.evaluate(() => (document.querySelector('#open-quote') as HTMLElement).click());
  await page.locator('#quote').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await check(page, info, 'abrir cotización');
});

test('/pedido: sin violaciones CSP', async ({ page }, info) => {
  await arm(page);
  await page.goto('/pedido');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await check(page, info, 'carga /pedido');
});

// Estricta: sin tolerancia. Falla hoy en WebKit por el <select> (ver nota arriba); activar al corregir la CSP.
test.fixme('WebKit: ninguna violación style-src-attr en el inicio (<select>)', async ({ page }, info) => {
  await arm(page);
  await page.goto('/?intro=ninguna');
  await page.waitForLoadState('networkidle');
  await check(page, info, 'inicio estricto', { strict: true });
});
