// Ayudas compartidas de las e2e: base local, TOTP y ingreso al panel. Nunca contra el remoto.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

export const DB = 'postgresql://postgres:postgres@127.0.0.1:57322/postgres';
export const sql = (query: string) => execFileSync('psql', [DB, '-Atqc', query], { encoding: 'utf8' }).trim();
export const PASSWORD = 'JpSmokeDev-2026';
export const ADMIN_ID = '00000000-0000-4000-8000-00000000b001';
export const RID = '00000000-0000-4000-8000-0000000000a1';

/** TOTP (RFC 6238): SHA-1, 30 s, 6 dígitos, secreto en base32. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function loginAdmin(page: Page) {
  sql(`delete from auth.mfa_factors where user_id = '${ADMIN_ID}'`);
  await page.goto('/panel');
  await page.getByLabel('Correo').fill('admin.dev@jpsmoke.test');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Activa tu código de seguridad' })).toBeVisible({
    timeout: 15_000,
  });
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  if (30_000 - (Date.now() % 30_000) < 4_000) await page.waitForTimeout(4_500);
  await page.getByLabel('Código de 6 dígitos').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar y entrar' }).click();
  await expect(page.locator('.topbar')).toBeVisible({ timeout: 15_000 });
}

export async function goTo(page: Page, label: string) {
  const toggle = page.locator('#side-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('.side-nav button', { hasText: label }).click();
}
