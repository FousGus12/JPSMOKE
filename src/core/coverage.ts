// Cobertura verificable (D44). Localidades de Bogotá (IDECA, CC BY 4.0, simplificadas ~40 m) y zonas
// activas del panel. Las localidades entran por parámetro: el mapa las usa al compilar y el navegador las
// carga solo al tocar "Usar mi ubicación". La fuente de verdad sigue siendo el servidor (zona activa).

export type LonLat = [number, number];
export interface Locality {
  code: string;
  name: string;
  /** Anillos [lon, lat]; se combinan par-impar (un hueco es un anillo dentro de otro). */
  rings: LonLat[][];
}
export interface CoverageZone {
  id: string;
  name: string;
  fee: number;
  active?: boolean;
  localityCode: string | null;
}

/** Metros por grado de latitud (aprox. esférica, suficiente para Bogotá). */
const M_PER_DEG = 111_320;
/** Tolerancia por defecto: un poco más que la simplificación de los límites (~40 m). */
export const BORDER_TOLERANCE_M = 60;

/** Lados del anillo como pares [anterior, actual] (el primero cierra con el último). */
function edges(ring: LonLat[]): Array<[LonLat, LonLat]> {
  return ring.map((point, idx) => [ring.at(idx - 1) ?? point, point]);
}

/** Convierte el JSON de localidades (anillos como arreglos) al tipo con pares [lon, lat]. */
export function asLocalities(raw: {
  localities: Array<{ code: string; name: string; rings: number[][][] }>;
}): Locality[] {
  return raw.localities.map((locality) => ({
    code: locality.code,
    name: locality.name,
    rings: locality.rings.map((ring) =>
      ring.flatMap(([lon, lat]): LonLat[] => (lon === undefined || lat === undefined ? [] : [[lon, lat]])),
    ),
  }));
}

/** Punto en anillo por cruce de rayos (ray casting). */
export function pointInRing([px, py]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (const [[xj, yj], [xi, yi]] of edges(ring)) {
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInLocality(point: LonLat, locality: Locality): boolean {
  return locality.rings.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false);
}

/** Distancia en metros del punto al borde más cercano de la localidad (proyección local). */
export function distanceToBorder([lon, lat]: LonLat, locality: Locality): number {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of locality.rings) {
    for (const [from, to] of edges(ring)) {
      const ax = (from[0] - lon) * kx;
      const ay = (from[1] - lat) * M_PER_DEG;
      const dx = (to[0] - lon) * kx - ax;
      const dy = (to[1] - lat) * M_PER_DEG - ay;
      const len = dx * dx + dy * dy;
      const along = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + along * dx, ay + along * dy));
    }
  }
  return best;
}

/**
 * Localidades donde cae el punto. Incluye las vecinas a menos de `toleranceM` del borde: así un punto en
 * el límite (o en el hueco que deja la simplificación) devuelve las dos. Primero la que lo contiene.
 */
export function localitiesAt(
  lon: number,
  lat: number,
  localities: Locality[],
  toleranceM = BORDER_TOLERANCE_M,
): Locality[] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
  const point: LonLat = [lon, lat];
  const inside = localities.filter((locality) => pointInLocality(point, locality));
  const near = localities.filter(
    (locality) => !inside.includes(locality) && distanceToBorder(point, locality) <= toleranceM,
  );
  return [...inside, ...near];
}

/** Zona activa ligada a la localidad (si hay dos, la de menor domicilio). */
export function zoneForLocality<Z extends CoverageZone>(code: string, zones: Z[]): Z | null {
  const matches = zones.filter((zone) => zone.localityCode === code && zone.active !== false);
  return matches.sort((left, right) => left.fee - right.fee)[0] ?? null;
}

export type Coverage<Z extends CoverageZone = CoverageZone> =
  /** Fuera de las 19 localidades urbanas. */
  | { kind: 'outside'; covered: false; zone: null; locality: null }
  /** En el límite entre localidades: que el cliente elija la suya. */
  | {
      kind: 'border';
      covered: false;
      zone: null;
      locality: null;
      options: Array<{ locality: Locality; zone: Z | null }>;
    }
  | { kind: 'inside'; covered: boolean; zone: Z | null; locality: Locality };

/** Respuesta para una localidad ya conocida (elegida en la lista o hallada por ubicación). */
export function coverageForLocality<Z extends CoverageZone>(locality: Locality, zones: Z[]): Coverage<Z> {
  const zone = zoneForLocality(locality.code, zones);
  return { kind: 'inside', covered: zone !== null, zone, locality };
}

/** ¿Llegamos a este punto? Con varias localidades posibles responde "borde" para que el cliente elija. */
export function coverageFor<Z extends CoverageZone>(
  point: LonLat,
  zones: Z[],
  localities: Locality[],
  toleranceM = BORDER_TOLERANCE_M,
): Coverage<Z> {
  const found = localitiesAt(point[0], point[1], localities, toleranceM);
  const first = found[0];
  if (!first) return { kind: 'outside', covered: false, zone: null, locality: null };
  if (found.length === 1) return coverageForLocality(first, zones);
  const options = found.map((locality) => ({ locality, zone: zoneForLocality(locality.code, zones) }));
  return { kind: 'border', covered: false, zone: null, locality: null, options };
}

/* ---------- Mapa SVG (al compilar) ---------- */

export interface MapGeometry {
  width: number;
  height: number;
  paths: Array<{ code: string; name: string; d: string }>;
  /** [lon, lat] → [x, y] en el viewBox; null si cae fuera del mapa. */
  project: (lon: number, lat: number) => [number, number] | null;
}

/** Proyección equirectangular ajustada a cos(latitud media); Y invertida (el norte arriba). */
export function mapGeometry(localities: Locality[], width = 320, pad = 4): MapGeometry {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const locality of localities)
    for (const ring of locality.rings)
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
  if (!Number.isFinite(minLon)) return { width, height: width, paths: [], project: () => null };
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = (width - pad * 2) / ((maxLon - minLon) * cos || 1);
  const height = Math.round((maxLat - minLat) * scale + pad * 2);
  const round = (value: number) => Math.round(value * 10) / 10;
  const xy = (lon: number, lat: number): [number, number] => [
    round(pad + (lon - minLon) * cos * scale),
    round(pad + (maxLat - lat) * scale),
  ];
  const paths = localities.map((locality) => ({
    code: locality.code,
    name: locality.name,
    d: locality.rings
      .filter((ring) => ring.length >= 3)
      .map((ring) => `M${ring.map(([lon, lat]) => xy(lon, lat).join(' ')).join('L')}Z`)
      .join(''),
  }));
  const project = (lon: number, lat: number) =>
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= minLon &&
    lon <= maxLon &&
    lat >= minLat &&
    lat <= maxLat
      ? xy(lon, lat)
      : null;
  return { width, height, paths, project };
}

/* ---------- Mensajes del verificador ---------- */

/** Por qué no se pudo usar la ubicación del navegador. */
export type GeoProblem = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'imprecise' | 'failed';
export interface CoverageMessage {
  tone: 'yes' | 'no' | 'info';
  text: string;
  /** Ofrecer WhatsApp (no llegamos o fuera de Bogotá). */
  offerWhatsApp: boolean;
  /** Localidades a las que se refiere (para WhatsApp y para resaltar el mapa). */
  localities: Locality[];
}

const GEO_TEXT: Record<GeoProblem, string> = {
  unsupported: 'Tu navegador no comparte la ubicación. Elige tu localidad en la lista.',
  denied: 'No nos diste permiso de ver tu ubicación. Elige tu localidad en la lista.',
  unavailable: 'No pudimos saber dónde estás. Elige tu localidad en la lista.',
  timeout: 'Se demoró en encontrarte. Intenta de nuevo o elige tu localidad en la lista.',
  imprecise: 'Tu ubicación es muy aproximada. Elige tu localidad en la lista.',
  failed: 'No pudimos revisar tu ubicación. Elige tu localidad en la lista.',
};

/** Texto claro sí/no para el verificador (sección y pedido). */
export function coverageMessage(
  result: Coverage | { kind: 'problem'; problem: GeoProblem },
  formatFee: (fee: number) => string,
): CoverageMessage {
  if (result.kind === 'problem')
    return { tone: 'info', text: GEO_TEXT[result.problem], offerWhatsApp: false, localities: [] };
  if (result.kind === 'outside')
    return {
      tone: 'no',
      text: 'Parece que estás fuera de Bogotá. Por ahora solo llegamos a localidades de Bogotá.',
      offerWhatsApp: true,
      localities: [],
    };
  if (result.kind === 'border') {
    const names = result.options.map((option) => option.locality.name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : (names[0] ?? '');
    return {
      tone: 'info',
      text: `Estás en el límite entre ${list}. Elige tu localidad en la lista.`,
      offerWhatsApp: false,
      localities: result.options.map((option) => option.locality),
    };
  }
  if (result.covered && result.zone)
    return {
      tone: 'yes',
      text: `¡Sí llegamos a ${result.locality.name}! Domicilio ${formatFee(result.zone.fee)}`,
      offerWhatsApp: false,
      localities: [result.locality],
    };
  return {
    tone: 'no',
    text: `Todavía no llegamos a ${result.locality.name}.`,
    offerWhatsApp: true,
    localities: [result.locality],
  };
}

/** Tolerancia del borde según la precisión que reporta el navegador (metros). null = demasiado imprecisa. */
export function toleranceFor(accuracy: number | null | undefined, maxAccuracy = 1500): number | null {
  if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy)) return BORDER_TOLERANCE_M;
  if (accuracy > maxAccuracy) return null;
  return Math.max(BORDER_TOLERANCE_M, accuracy);
}
