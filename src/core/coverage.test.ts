import { describe, expect, it } from 'vitest';
import raw from '../data/bogota-localidades.json';
import {
  asLocalities,
  coverageFor,
  coverageMessage,
  coverageForLocality,
  localitiesAt,
  mapGeometry,
  pointInRing,
  toleranceFor,
  zoneForLocality,
  type CoverageZone,
  type LonLat,
} from './coverage';

const localities = asLocalities(raw);
const names = (lon: number, lat: number) =>
  localitiesAt(lon, lat, localities).map((locality) => locality.name);
const zones: CoverageZone[] = [
  { id: 'z-chapi', name: 'Chapinero', fee: 6000, active: true, localityCode: '02' },
  { id: 'z-fonti', name: 'Fontibón', fee: 7000, active: false, localityCode: '09' },
  { id: 'z-otra', name: 'Zona sin código', fee: 3000, active: true, localityCode: null },
];

describe('pointInRing', () => {
  const square: LonLat[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  it('adentro y afuera', () => {
    expect(pointInRing([0.5, 0.5], square)).toBe(true);
    expect(pointInRing([1.5, 0.5], square)).toBe(false);
  });
});

describe('localitiesAt (IDECA simplificado)', () => {
  it('trae las 19 localidades urbanas', () => expect(localities).toHaveLength(19));
  it('Plaza de Bolívar: Santa Fe y/o Candelaria', () => {
    const found = names(-74.076, 4.5981);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((name) => name === 'Santa Fe' || name === 'Candelaria')).toBe(true);
  });
  it('Parque 93: Chapinero', () => expect(names(-74.0486, 4.6766)).toEqual(['Chapinero']));
  it('aeropuerto: Fontibón', () => expect(names(-74.1469, 4.7016)).toEqual(['Fontibón']));
  it('fuera de Bogotá (Chía): ninguna', () => expect(names(-74.058, 4.862)).toEqual([]));
  it('coordenadas inválidas: ninguna', () => expect(names(Number.NaN, 4.6)).toEqual([]));
});

describe('coverageFor', () => {
  it('Chapinero activa: cubre con su tarifa', () => {
    const result = coverageFor([-74.0486, 4.6766], zones, localities);
    expect(result).toMatchObject({ kind: 'inside', covered: true, zone: { id: 'z-chapi', fee: 6000 } });
    expect(result.locality?.name).toBe('Chapinero');
  });
  it('zona inactiva (Fontibón apagada): no cubre', () => {
    const result = coverageFor([-74.1469, 4.7016], zones, localities);
    expect(result).toMatchObject({ kind: 'inside', covered: false, zone: null });
    expect(result.locality?.name).toBe('Fontibón');
  });
  it('fuera de Bogotá', () =>
    expect(coverageFor([-74.058, 4.862], zones, localities)).toMatchObject({
      kind: 'outside',
      covered: false,
    }));
  it('en el límite Chapinero–Usaquén ofrece elegir entre las dos', () => {
    const result = coverageFor([-74.0131, 4.6683], zones, localities);
    expect(result.kind).toBe('border');
    if (result.kind === 'border')
      expect(result.options.map((option) => option.locality.code).sort()).toEqual(['01', '02']);
  });
  it('ubicación imprecisa (tolerancia grande): borde', () =>
    expect(coverageFor([-74.0486, 4.6766], zones, localities, 3000).kind).toBe('border'));
  it('localidad elegida en la lista', () => {
    const fonti = localities.find((locality) => locality.code === '09');
    expect(fonti && coverageForLocality(fonti, zones).covered).toBe(false);
  });
  it('zona con código nulo no se liga a ninguna localidad; dos zonas: la más barata', () => {
    expect(zoneForLocality('03', zones)).toBeNull();
    const two = [
      ...zones,
      { id: 'z-chapi2', name: 'Chapinero norte', fee: 5000, active: true, localityCode: '02' },
    ];
    expect(zoneForLocality('02', two)?.id).toBe('z-chapi2');
  });
});

describe('mapGeometry', () => {
  const map = mapGeometry(localities, 320);
  it('un path por localidad, más alto que ancho', () => {
    expect(map.paths).toHaveLength(19);
    expect(map.paths.every((path) => path.d.startsWith('M') && path.d.endsWith('Z'))).toBe(true);
    expect(map.height).toBeGreaterThan(map.width);
  });
  it('el norte queda arriba y fuera del mapa no se proyecta', () => {
    const north = map.project(-74.03, 4.8);
    const south = map.project(-74.1, 4.5);
    expect(north && south && north[1] < south[1]).toBe(true);
    expect(map.project(-75, 4.6)).toBeNull();
  });
});

describe('coverageMessage y toleranceFor', () => {
  const fee = (value: number) => `$${value}`;
  it('sí llegamos con tarifa', () =>
    expect(coverageMessage(coverageFor([-74.0486, 4.6766], zones, localities), fee)).toMatchObject({
      tone: 'yes',
      text: '¡Sí llegamos a Chapinero! Domicilio $6000',
      offerWhatsApp: false,
    }));
  it('todavía no llegamos, con WhatsApp', () =>
    expect(coverageMessage(coverageFor([-74.1469, 4.7016], zones, localities), fee)).toMatchObject({
      tone: 'no',
      text: 'Todavía no llegamos a Fontibón.',
      offerWhatsApp: true,
    }));
  it('fuera de Bogotá y borde', () => {
    expect(coverageMessage(coverageFor([-74.058, 4.862], zones, localities), fee).text).toMatch(
      /fuera de Bogotá/,
    );
    expect(coverageMessage(coverageFor([-74.0131, 4.6683], zones, localities), fee).text).toMatch(
      /límite entre (Usaquén y Chapinero|Chapinero y Usaquén)/,
    );
  });
  it('permiso negado', () =>
    expect(coverageMessage({ kind: 'problem', problem: 'denied' }, fee).text).toMatch(/permiso/));
  it('tolerancia según precisión', () => {
    expect(toleranceFor(10)).toBe(60);
    expect(toleranceFor(400)).toBe(400);
    expect(toleranceFor(5000)).toBeNull();
    expect(toleranceFor(undefined)).toBe(60);
  });
});
