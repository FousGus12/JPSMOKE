// Ventas y estadísticas (F8): cálculos de presentación, CSV e informe semanal. Puros y probados.
import { formatCop } from './money';

/** Cambio porcentual frente al periodo anterior; null si antes no hubo ventas (no se inventa un %). */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Techo "redondo" para el eje (1, 2, 2.5, 5 × 10^n) y que las barras no toquen el borde. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((candidate) => candidate * exp >= value) ?? 10;
  return step * exp;
}

/** Celda CSV segura: comillas dobles y sin fórmulas que Excel ejecute (=, +, -, @, tabulador, retorno). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  const first = rows[0];
  if (!first) return '';
  const headers = Object.keys(first);
  return [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join(
    '\n',
  );
}

const DAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export interface WeeklyReport {
  from: string;
  to: string;
  total: number;
  orders: number;
  previous_total: number;
  previous_orders: number;
  ticket: number;
  star: string | null;
  peak_hour: number | null;
  peak_day: number | null;
  blocked: number;
  cancelled: number;
}

/** Texto del informe semanal para enviar por WhatsApp al dueño (P11). */
export function weeklyText(report: WeeklyReport, restaurant: string): string {
  const change = percentChange(report.total, report.previous_total);
  const trend =
    change === null
      ? ''
      : change >= 0
        ? ` (▲ ${change}% vs. la semana anterior)`
        : ` (▼ ${Math.abs(change)}% vs. la semana anterior)`;
  const hour =
    report.peak_hour === null
      ? null
      : `${report.peak_hour % 12 || 12}${report.peak_hour < 12 ? ' a. m.' : ' p. m.'}`;
  const lines = [
    `🔥 ${restaurant} · semana del ${report.from} al ${report.to}`,
    `Ventas: ${formatCop(report.total)}${trend}`,
    `Pedidos: ${report.orders} · ticket promedio ${formatCop(report.ticket)}`,
    report.star ? `Producto estrella: ${report.star}` : null,
    report.peak_day !== null && hour
      ? `Día y hora fuertes: ${DAYS[report.peak_day] ?? ''} a las ${hour}`
      : null,
    `Cancelados: ${report.cancelled} · pedidos falsos frenados: ${report.blocked}`,
  ];
  return lines.filter(Boolean).join('\n');
}
