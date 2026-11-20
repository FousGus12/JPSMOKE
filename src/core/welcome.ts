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

/** Qué mostrar: lo forzado manda; si no, el modo configurado salvo que ya se vio hoy. Sin evento, nada. */
export function welcomeToShow(options: {
  forced: WelcomeMode | null;
  configured: WelcomeMode;
  hasEvent: boolean;
  lastSeen: string | null;
  today: string;
}): WelcomeMode {
  if (!options.hasEvent) return 'ninguna';
  if (options.forced) return options.forced;
  return options.lastSeen === options.today ? 'ninguna' : options.configured;
}
