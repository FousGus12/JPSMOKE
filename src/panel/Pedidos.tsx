import { useMemo, useState } from 'react';
import { formatCop as money } from '../core/money';
import {
  BOARD_COLUMNS,
  CANCEL_REASONS,
  CHANNEL_LABEL,
  STATUS_LABEL,
  customerWhatsApp,
  formatPhone,
  groupBoard,
  isLate,
  minutesSince,
  nextStep,
} from '../core/orders';
import { setStatus, type PanelOrder } from './data';
import { Drawer, useToast } from './ui';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });

export function Pedidos({
  orders,
  fresh,
  now,
  restaurant,
  onChanged,
}: {
  orders: PanelOrder[];
  fresh: Set<string>;
  now: number;
  restaurant: string;
  onChanged: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const board = useMemo(() => groupBoard(orders, now), [orders, now]);
  const open = orders.find((order) => order.id === openId) ?? null;
  return (
    <>
      <div className="note">
        Los pedidos de la página entran solos con sonido. Los que llegan por WhatsApp o llamada se registran
        con <b>＋ Pedido manual</b>.
      </div>
      <div className="board">
        {BOARD_COLUMNS.map(([status, label]) => {
          const list = board[status];
          return (
            <section className="col" aria-label={label} key={status}>
              <div className="col-head">
                <b>{label}</b>
                <span>{list.length}</span>
              </div>
              {list.length === 0 ? <p className="board-empty">Vacío</p> : null}
              {list.map((order) => (
                <button
                  key={order.id}
                  className={`ocard ${fresh.has(order.id) ? 'is-new' : ''}`}
                  type="button"
                  onClick={() => setOpenId(order.id)}
                  data-testid={`pedido-${order.code}`}
                >
                  <div className="ocard-top">
                    <b>{order.code}</b>
                    <span>
                      {order.fulfillment === 'recoger' ? <span className="ch ch-recoger">Recoge</span> : null}{' '}
                      <span className={`ch ch-${order.channel}`}>{CHANNEL_LABEL[order.channel]}</span>
                    </span>
                  </div>
                  <p>
                    {order.customer_name} ·{' '}
                    {order.fulfillment === 'recoger' ? 'en el local' : order.barrio || order.zone_name}
                  </p>
                  <p className="ocard-items">
                    {order.order_items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                  </p>
                  <div className="ocard-foot">
                    <b>{money(order.total)}</b>
                    <span className={`age ${isLate(order.status, order.created_at, now) ? 'late' : ''}`}>
                      {status === 'entregado'
                        ? time(order.created_at)
                        : `hace ${minutesSince(order.created_at, now)} min`}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {open ? (
        <OrderDetail
          order={open}
          restaurant={restaurant}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

function OrderDetail({
  order,
  restaurant,
  onClose,
  onChanged,
}: {
  order: PanelOrder;
  restaurant: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const next = nextStep(order.status, order.fulfillment);
  const closed = order.status === 'entregado' || order.status === 'cancelado';

  async function move(status: PanelOrder['status'], why?: string) {
    setBusy(true);
    try {
      await setStatus(order.id, status, why);
      toast(`${order.code} → ${STATUS_LABEL[status]}`);
      onChanged();
      onClose();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={`${order.code} · ${STATUS_LABEL[order.status]}`} onClose={onClose}>
      <div className="btn-row">
        {next ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void move(next.status)}
          >
            {next.label} →
          </button>
        ) : null}
        <a className="btn btn-soft" href={`tel:+57${order.phone}`}>
          Llamar
        </a>
        <a
          className="btn btn-soft"
          href={customerWhatsApp(order.phone, order.customer_name, order.code, restaurant)}
          target="_blank"
          rel="noopener"
        >
          WhatsApp
        </a>
        <button className="btn btn-soft" type="button" onClick={() => window.print()}>
          Comanda
        </button>
      </div>
      <dl className="kv">
        <dt>Cliente</dt>
        <dd>{order.customer_name}</dd>
        <dt>Celular</dt>
        <dd>{formatPhone(order.phone)}</dd>
        <dt>{order.fulfillment === 'recoger' ? 'Entrega' : 'Dirección'}</dt>
        <dd>
          {order.fulfillment === 'recoger' ? (
            <b>Recoge en tienda</b>
          ) : (
            <>
              {order.address}
              {order.barrio ? `, ${order.barrio}` : ''} · {order.zone_name}
            </>
          )}
        </dd>
        {order.notes ? (
          <>
            <dt>Indicaciones</dt>
            <dd>{order.notes}</dd>
          </>
        ) : null}
        <dt>Pago</dt>
        <dd>
          {order.payment_label}
          {order.cash_with ? ` · paga con ${money(order.cash_with)}` : ''}
        </dd>
        <dt>Canal</dt>
        <dd>
          <span className={`ch ch-${order.channel}`}>{CHANNEL_LABEL[order.channel]}</span> ·{' '}
          {time(order.created_at)}
        </dd>
        {order.cancel_reason ? (
          <>
            <dt>Motivo</dt>
            <dd>{order.cancel_reason}</dd>
          </>
        ) : null}
      </dl>
      <div className="card">
        <div className="lines">
          {order.order_items.map((item, i) => (
            <div key={i}>
              <span>
                {item.qty} × {item.name}
                {item.combo ? ' (combo)' : ''}
              </span>
              <span>{money(item.unit_price * item.qty)}</span>
            </div>
          ))}
          <div className="muted">
            <span>Domicilio</span>
            <span>{money(order.delivery_fee)}</span>
          </div>
          {order.discount ? (
            <div className="muted">
              <span>Cupón {order.coupon_code}</span>
              <span>−{money(order.discount)}</span>
            </div>
          ) : null}
          {order.gift ? (
            <div className="muted">
              <span>🎁 {order.gift}</span>
              <span>$0</span>
            </div>
          ) : null}
          <div className="tot">
            <span>Total</span>
            <span>{money(order.total)}</span>
          </div>
        </div>
      </div>
      <div>
        <h3>Línea de tiempo</h3>
        <ul className="tl">
          {[...order.order_events]
            .sort((first, second) => first.at.localeCompare(second.at))
            .map((event, i) => (
              <li key={i}>
                <div>
                  {STATUS_LABEL[event.status]}
                  <small>{time(event.at)}</small>
                </div>
              </li>
            ))}
        </ul>
      </div>
      {!closed ? (
        <div className="field">
          <label htmlFor="cancel-r">Cancelar pedido</label>
          <select
            className="select"
            id="cancel-r"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">Motivo…</option>
            {CANCEL_REASONS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            className="btn btn-soft btn-sm"
            type="button"
            disabled={busy || !reason}
            onClick={() => void move('cancelado', reason)}
          >
            Cancelar con motivo
          </button>
          <span className="hint">"Pedido falso o broma" bloquea ese celular para nuevos pedidos.</span>
        </div>
      ) : null}
    </Drawer>
  );
}
