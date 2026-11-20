import { describe, expect, it } from 'vitest';
import { bogotaDay, forcedWelcome, isCurrent, welcomeToShow } from './welcome';

describe('bogotaDay', () => {
  it('usa la hora de Bogotá (UTC-5)', () => {
    // 2026-11-20 03:00 UTC = 2026-11-19 22:00 en Bogotá.
    expect(bogotaDay(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-19');
    expect(bogotaDay(new Date('2026-11-20T05:00:00Z'))).toBe('2026-11-20');
  });
});

describe('forcedWelcome', () => {
  it('acepta los tres modos', () => {
    expect(forcedWelcome('completa')).toBe('completa');
    expect(forcedWelcome('aviso')).toBe('aviso');
    expect(forcedWelcome('ninguna')).toBe('ninguna');
  });
  it('ignora otros valores', () => {
    expect(forcedWelcome(null)).toBeNull();
    expect(forcedWelcome('otra')).toBeNull();
  });
});

describe('welcomeToShow', () => {
  const base = {
    forced: null,
    configured: 'completa',
    hasEvent: true,
    lastSeen: null,
    today: '2026-11-19',
  } as const;
  it('primera vez del día: el modo configurado', () => expect(welcomeToShow(base)).toBe('completa'));
  it('ya se vio hoy: nada', () => expect(welcomeToShow({ ...base, lastSeen: '2026-11-19' })).toBe('ninguna'));
  it('se vio ayer: otra vez', () =>
    expect(welcomeToShow({ ...base, lastSeen: '2026-11-18' })).toBe('completa'));
  it('forzado aunque ya se vio', () =>
    expect(welcomeToShow({ ...base, lastSeen: '2026-11-19', forced: 'aviso' })).toBe('aviso'));
  it('forzado a ninguna', () => expect(welcomeToShow({ ...base, forced: 'ninguna' })).toBe('ninguna'));
  it('sin evento de bienvenida: nada, aunque se fuerce', () =>
    expect(welcomeToShow({ ...base, hasEvent: false, forced: 'completa' })).toBe('ninguna'));
  it('configurado en ninguna', () =>
    expect(welcomeToShow({ ...base, configured: 'ninguna' })).toBe('ninguna'));
});

describe('vigencia (D62)', () => {
  it('isCurrent compara días de Bogotá, inclusivo', () => {
    expect(isCurrent('2026-11-19', '2026-11-01', '2026-11-19')).toBe(true);
    expect(isCurrent('2026-11-20', '2026-11-01', '2026-11-19')).toBe(false);
    expect(isCurrent('2026-10-31', '2026-11-01', '2026-11-19')).toBe(false);
    expect(isCurrent('2026-11-19', null, undefined)).toBe(true);
  });
  it('una bienvenida vencida no se muestra, ni forzada', () => {
    const base = {
      configured: 'completa' as const,
      hasEvent: true,
      lastSeen: null,
      today: '2026-12-01',
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
    };
    expect(welcomeToShow({ ...base, forced: null })).toBe('ninguna');
    expect(welcomeToShow({ ...base, forced: 'aviso' })).toBe('ninguna');
    expect(welcomeToShow({ ...base, today: '2026-11-30', forced: null })).toBe('completa');
  });
});
