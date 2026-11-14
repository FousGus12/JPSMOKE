import { expect, test } from '@playwright/test';

// F3: el build sale con datos reales de la base y con los encabezados de seguridad de Astro.
test('el inicio muestra el restaurante y sus destacados leídos de la base', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('JP Smoke');
  await expect(page.locator('.hcard')).toHaveCount(4);
});

test('el panel no se indexa', async ({ page }) => {
  await page.goto('/panel');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('la página trae CSP por hash', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[http-equiv="content-security-policy"]')).toHaveCount(1);
});
