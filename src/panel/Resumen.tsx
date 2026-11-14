import { formatCop as money } from '../core/money';
import { CHANNEL_LABEL, STATUS_LABEL, minutesSince } from '../core/orders';
import type { PanelOrder, Summary } from './data';

export function Resumen({
  summary,
  orders,
  isAdmin,
  now,
  onOpenBoard,
}: {
  summary: Summary | null;
  orders: PanelOrder[];
  isAdmin: boolean;
  now: number;
  onOpenBoard: () => void;
}) {
  const active = orders.filter((order) =>
    ['nuevo', 'confirmado', 'en_cocina', 'en_camino'].includes(order.status),
  );
  return (
    <>
      <div className="kpis">
        {isAdmin ? (
          <div className="kpi">
            <small>Ventas de hoy</small>
            <b>{money(summary?.sales_today ?? 0)}</b>
            <span>sin cancelados</span>
          </div>
        ) : null}
        <div className="kpi">
          <small>Pedidos de hoy</small>
          <b>{summary?.orders_today ?? '—'}</b>
          <span>{summary?.cancelled_today ?? 0} cancelados</span>
        </div>
        <div className="kpi">
          <small>Activos ahora</small>
          <b>{summary?.active ?? '—'}</b>
          <span>{summary?.waiting ?? 0} sin confirmar</span>
        </div>
        {isAdmin ? (
          <div className="kpi">
            <small>Ticket promedio</small>
            <b>{money(summary?.ticket_today ?? 0)}</b>
            <span>hoy</span>
          </div>
        ) : (
          <div className="kpi">
            <small>Tiempo de entrega</small>
            <b>{summary?.avg_minutes ? `${summary.avg_minutes} min` : '—'}</b>
            <span>promedio de hoy</span>
          </div>
        )}
      </div>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Pedidos activos</h2>
            <p>Lo que hay que mover ya</p>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={onOpenBoard}>
            Abrir tablero
          </button>
        </div>
        <div className="rows">
          {active.length === 0 ? <p className="muted">Sin pedidos activos.</p> : null}
          {active.map((order) => (
            <div className="row" key={order.id}>
              <div>
                <b>
                  {order.code} · {order.customer_name}
                </b>
                <small>
                  {order.order_items.length} productos · hace {minutesSince(order.created_at, now)} min ·{' '}
                  <span className={`ch ch-${order.channel}`}>{CHANNEL_LABEL[order.channel]}</span>
                </small>
              </div>
              <span className={`st st-${order.status}`}>{STATUS_LABEL[order.status]}</span>
            </div>
          ))}
        </div>
      </section>
      {summary?.low_supplies?.length ? (
        <div className="note note-warn" role="status">
          ⚠️ <b>Insumos por agotarse:</b> {summary.low_supplies.join(', ')}.
        </div>
      ) : null}
      {isAdmin && summary?.blocked_week ? (
        <div className="note">
          🛡️ <b>{summary.blocked_week} pedidos falsos frenados</b> en los últimos 7 días.
        </div>
      ) : null}
    </>
  );
}
