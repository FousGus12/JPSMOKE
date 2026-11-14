// Revisa el build (dist/) antes de publicar: CSP por hash en cada página, scripts y estilos en línea
// cubiertos por su hash, sin atributos style, sin sourcemaps, sin secretos, panel con noindex.
// Uso: node scripts/revisar-build.mjs   (lo corre scripts/verify.sh full)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const problems = [];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
})(DIST);

// Claves reales, no solo sus prefijos (la librería de Supabase compara el texto `sb_secret_`).
const SECRETS = /sb_secret_[A-Za-z0-9_-]{16,}|sbp_[A-Za-z0-9]{20}|-----BEGIN [A-Z ]*PRIVATE KEY/;
/** JWT con rol service_role (se decodifica: el texto codificado cambia según la alineación). */
export function hasServiceRoleJwt(text) {
  for (const [, payload] of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    try {
      if (/"role"\s*:\s*"service_role"/.test(Buffer.from(payload, 'base64url').toString('utf8'))) return true;
    } catch {
      // no era un JWT
    }
  }
  return false;
}
const hash = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
let pages = 0;

for (const file of files) {
  const rel = relative(DIST, file);
  if (file.endsWith('.map')) problems.push(`${rel}: sourcemap publicado`);
  if (
    /\.(html|js|css)$/.test(file) &&
    (SECRETS.test(readFileSync(file, 'utf8')) || hasServiceRoleJwt(readFileSync(file, 'utf8')))
  )
    problems.push(`${rel}: parece contener un secreto`);
  if (!file.endsWith('.html')) continue;
  pages += 1;
  const html = readFileSync(file, 'utf8');
  const csp = html.match(/<meta http-equiv="content-security-policy" content="([^"]+)"/)?.[1];
  if (!csp) {
    problems.push(`${rel}: sin CSP`);
    continue;
  }
  if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'"))
    problems.push(`${rel}: CSP con unsafe-*`);
  for (const [, attrs, body] of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    // Los datos (JSON-LD y los del carrito) no se ejecutan (la CSP no aplica): basta con que sean JSON válido.
    if (/type="application\/(ld\+)?json"/.test(attrs)) {
      try {
        JSON.parse(body);
      } catch {
        problems.push(`${rel}: JSON-LD inválido`);
      }
      continue;
    }
    if (body.trim() && !csp.includes(hash(body)))
      problems.push(`${rel}: script en línea sin su hash en la CSP`);
  }
  for (const [, body] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    if (body.trim() && !csp.includes(hash(body)))
      problems.push(`${rel}: estilo en línea sin su hash en la CSP`);
  }
  if (/\sstyle="/.test(html)) problems.push(`${rel}: atributo style (lo bloquea la CSP)`);
  if (rel.startsWith('panel') && !html.includes('<meta name="robots" content="noindex, nofollow"'))
    problems.push(`${rel}: el panel debe llevar noindex`);
}

if (problems.length) {
  console.error(problems.map((problem) => `  ✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`  ✓ ${pages} páginas revisadas: CSP por hash, sin style, sin sourcemaps ni secretos`);
