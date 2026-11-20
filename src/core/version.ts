// Aviso de versión nueva del panel (D67): el panel compara su id de compilación con el de /version.json.

/** Id de compilación de la respuesta de /version.json; null si no es lo esperado. */
export function parseBuildId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const id = (json as { id?: unknown }).id;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed ? trimmed : null;
}

/** true solo si ambos ids son válidos y distintos: una respuesta rara o vacía nunca dispara el aviso. */
export function isNewVersion(current: unknown, remote: unknown): boolean {
  const mine = typeof current === 'string' ? current.trim() : '';
  const theirs = parseBuildId(remote);
  return mine !== '' && theirs !== null && mine !== theirs;
}
