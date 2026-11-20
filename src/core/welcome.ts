/** Bienvenida (D16, D51): máximo una vez al día por navegador, con el día de Bogotá. */
export type WelcomeMode = 'completa' | 'aviso' | 'ninguna';

const MODES: readonly WelcomeMode[] = ['completa', 'aviso', 'ninguna'];
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día de Bogotá como AAAA-MM-DD. */
export function bogotaDay(now: Date): string {
  return dayFmt.format(now);
}

/** `?intro=completa|aviso|ninguna` fuerza el modo (pruebas y vista previa); otro valor no cuenta. */
export function forcedWelcome(param: string | null): WelcomeMode | null {
  return MODES.includes(param as WelcomeMode) ? (param as WelcomeMode) : null;
}

/**
 * Vigencia por día de Bogotá (AAAA-MM-DD, inclusivo). Sin fecha = sin límite por ese lado. Lo publicado
 * caduca solo aunque no se vuelva a publicar (D62). Las fechas ISO se comparan como texto.
 */
export function isCurrent(today: string, startsOn?: string | null, endsOn?: string | null): boolean {
  if (startsOn && today < startsOn) return false;
  if (endsOn && today > endsOn) return false;
  return true;
}

/**
 * Qué mostrar: sin evento o fuera de sus fechas, nada (ni forzado: una bienvenida vencida no se ve, D62);
 * si no, lo forzado manda; si no, el modo configurado salvo que ya se vio hoy.
 */
export function welcomeToShow(options: {
  forced: WelcomeMode | null;
  configured: WelcomeMode;
  hasEvent: boolean;
  lastSeen: string | null;
  today: string;
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
}): WelcomeMode {
  if (!options.hasEvent) return 'ninguna';
  if (!isCurrent(options.today, options.startsOn, options.endsOn)) return 'ninguna';
  if (options.forced) return options.forced;
  return options.lastSeen === options.today ? 'ninguna' : options.configured;
}
