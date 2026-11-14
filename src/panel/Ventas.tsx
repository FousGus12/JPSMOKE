import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { formatCop as money } from '../core/money';
import { CHANNEL_LABEL, type OrderChannel } from '../core/orders';
import { percentChange, toCsv, weeklyText, type WeeklyReport } from '../core/sales';
import { Columns, Rows } from './charts';
import {
  closeCash,
  exportSales,
  loadCash,
  loadSales,
  loadWeekly,
  type CashDay,
  type SalesSummary,
} from './sales-data';
import { useToast } from './ui';

const PERIODS: Array<[number, string]> = [
  [1, 'Hoy'],
  [7, '7 días'],
  [30, '30 días'],
  [90, '90 días'],
];
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Bogota',
  });
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/** Ventas y estadísticas (F8, solo admin). */
export function Ventas({ restaurant }: { restaurant: string }) {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [cash, setCash] = useState<CashDay | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([loadSales(days), loadCash(), loadWeekly()])
        .then(([summary, cashDay, report]) => {
          setSales(summary);
          setCash(cashDay);
          setWeekly(report);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [days, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function download() {
    try {
      const rows = await exportSales(days);
      if (!rows.length) return toast('No hay pedidos en el periodo.');
      const blob = new Blob([`\ufeff${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ventas-${days}d-${todayIso()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast('CSV descargado (sin celulares ni direcciones). Queda en la auditoría.');
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo exportar.');
    }
  }

  const change = sales ? percentChange(sales.total, sales.previous_total) : null;
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Periodo">
          {PERIODS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn btn-soft btn-sm" type="button" onClick={() => void download()}>
          Exportar CSV
        </button>
      </div>
      {!sales ? (
        <p className="muted">Cargando ventas…</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Ingresos</small>
              <b data-testid="kpi-ingresos">{money(sales.total)}</b>
              <span className={change === null ? '' : change >= 0 ? 'up' : 'down'}>
                {change === null
                  ? 'Sin periodo anterior para comparar'
                  : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs. periodo anterior`}
              </span>
            </div>
            <div className="kpi">
              <small>Pedidos</small>
              <b>{sales.orders}</b>
              <span>{sales.cancelled} cancelados</span>
            </div>
            <div className="kpi">
              <small>Ticket promedio</small>
              <b>{money(sales.ticket)}</b>
              <span>con domicilio</span>
            </div>
            <div className="kpi">
              <small>Clientes que repiten</small>
              <b>{sales.recurrent_pct}%</b>
              <span>de {sales.customers} clientes</span>
            </div>
          </div>
          {sales.days > 1 ? (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Ingresos por día</h2>
                  <p>
                    Sin cancelados · descuentos {money(sales.discounts)} · domicilios{' '}
                    {money(sales.delivery_fees)}
                  </p>
                </div>
              </div>
              <Columns
                caption="Ingresos por día"
                axis={money}
                bars={sales.by_day.map((day) => ({
                  label: dayLabel(day.day),
                  value: day.total,
                  detail: `${money(day.total)} · ${day.orders} pedidos`,
                }))}
              />
            </section>
          ) : null}
          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <h2>Por canal</h2>
              </div>
              <Rows
                rows={sales.by_channel.map((row) => ({
                  label: CHANNEL_LABEL[row.key as OrderChannel] ?? row.key,
                  value: row.total,
                  text: `${money(row.total)} (${row.orders})`,
                }))}
              />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Por medio de pago</h2>
              </div>
              <Rows
                rows={sales.by_payment.map((row) => ({
                  label: row.key,
                  value: row.total,
                  text: `${money(row.total)} (${row.orders})`,
                }))}
              />
            </section>
          </div>
          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Horas pico</h2>
                  <p>Pedidos por hora del día</p>
                </div>
              </div>
              <Columns
                caption="Pedidos por hora"
                axis={(value) => `${value} pedidos`}
                bars={sales.by_hour.map((row) => ({
                  label: hourLabel(row.hour),
                  value: row.orders,
                  detail: `${row.orders} pedidos`,
                }))}
              />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>Productos más vendidos</h2>
              </div>
              {sales.top_products.length === 0 ? (
                <p className="muted">Sin ventas en el periodo.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="num">Unidades</th>
                        <th className="num">Ingresos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.top_products.map((product) => (
                        <tr key={product.name}>
                          <td>{product.name}</td>
                          <td className="num">{product.qty}</td>
                          <td className="num">{money(product.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          {sales.blocked ? (
            <div className="note">
              🛡️ <b>{sales.blocked} pedidos falsos frenados</b> en el periodo.
            </div>
          ) : null}
        </>
      )}
      <div className="grid-2">
        {cash ? (
          <CashClose key={cash.closed?.closed_at ?? 'abierta'} cash={cash} onClosed={() => void reload()} />
        ) : null}
        {weekly ? <Weekly report={weekly} restaurant={restaurant} /> : null}
      </div>
    </>
  );
}

function CashClose({ cash, onClosed }: { cash: CashDay; onClosed: () => void }) {
  const toast = useToast();
  const [counted, setCounted] = useState(cash.closed ? String(cash.closed.counted) : '');
  const [notes, setNotes] = useState(cash.closed?.notes ?? '');
  const [busy, setBusy] = useState(false);
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const value = Number(counted.replace(/\D/g, ''));
    if (!counted.trim()) return toast('Escribe cuánto efectivo contaste.');
    setBusy(true);
    try {
      const result = await closeCash(cash.day, value, notes);
      toast(
        result.difference === 0
          ? 'Caja cuadrada ✔'
          : `Caja cerrada con ${result.difference > 0 ? 'sobrante' : 'faltante'} de ${money(Math.abs(result.difference))}`,
      );
      onClosed();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo cerrar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" aria-label="Cierre de caja">
      <div className="card-head">
        <div>
          <h2>Cierre de caja de hoy</h2>
          <p>Efectivo de pedidos entregados en medios que piden vuelto</p>
        </div>
      </div>
      <div className="cash-expected">
        <small>Debería haber</small>
        <b data-testid="caja-esperado">{money(cash.expected)}</b>
        <span className="muted">{cash.orders} pedidos en efectivo</span>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field">
            <label htmlFor="cash-counted">Efectivo contado</label>
            <input
              className="input"
              id="cash-counted"
              inputMode="numeric"
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cash-notes">Nota</label>
            <input
              className="input"
              id="cash-notes"
              maxLength={300}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        {cash.closed ? (
          <p className={`note ${cash.closed.difference === 0 ? '' : 'note-warn'}`}>
            Cerrada: contaste {money(cash.closed.counted)} ·{' '}
            {cash.closed.difference === 0
              ? 'cuadra'
              : `${cash.closed.difference > 0 ? 'sobran' : 'faltan'} ${money(Math.abs(cash.closed.difference))}`}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {cash.closed ? 'Volver a cerrar' : 'Cerrar caja'}
        </button>
      </form>
    </section>
  );
}

function Weekly({ report, restaurant }: { report: WeeklyReport; restaurant: string }) {
  const toast = useToast();
  const text = weeklyText(report, restaurant);
  return (
    <section className="card" aria-label="Informe semanal">
      <div className="card-head">
        <div>
          <h2>Informe de la semana pasada</h2>
          <p>Lunes a domingo. El envío automático por WhatsApp llega en F9.</p>
        </div>
      </div>
      <pre className="weekly" data-testid="informe-semanal">
        {text}
      </pre>
      <button
        className="btn btn-soft btn-sm"
        type="button"
        onClick={() =>
          void navigator.clipboard
            .writeText(text)
            .then(() => toast('Informe copiado. Pégalo en WhatsApp.'))
            .catch(() => toast('No se pudo copiar; selecciona el texto.'))
        }
      >
        Copiar para WhatsApp
      </button>
    </section>
  );
}
