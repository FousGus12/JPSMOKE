import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';
import { formatCop as money } from '../core/money';
import {
  BOARD_COLUMNS,
  applyMoves,
  canDrag,
  canDrop,
  dropConfirmText,
  dropRejection,
  needsDropConfirm,
  edgeScroll,
  passedThreshold,
  staleMoves,
  CANCEL_REASONS,
  CHANNEL_LABEL,
  STATUS_LABEL,
  VOID_REASONS,
  customerWhatsApp,
  formatPhone,
  groupBoard,
  isCompact,
  isLate,
  minutesSince,
  nestItems,
  orderActions,
  toggleOpen,
  voidReasonText,
  type OrderStatus,
  type PendingMove,
  type StaffRole,
  type VoidReason,
} from '../core/orders';
import { loadMyRole, setStatus, type PanelOrder } from './data';
import { Recibo } from './Recibo';
import { Drawer, Modal, useToast } from './ui';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });

/** Ítems con cada adición debajo de su plato (D40). */
const itemsOf = (order: PanelOrder) =>
  nestItems(order.order_items.map((item) => ({ ...item, parent: item.parent_item_id })));

/** Resumen de la tarjeta: cliente, zona, productos, total y hora. */
function CardBody({ order, now }: { order: PanelOrder; now: number }) {
  return (
    <>
      <p>
        {order.customer_name} ·{' '}
        {order.fulfillment === 'recoger' ? 'en el local' : order.barrio || order.zone_name}
      </p>
      <p className="ocard-items">
        {itemsOf(order)
          .map((item) => `${item.isAddon ? '+ ' : ''}${item.qty}× ${item.name}`)
          .join(', ')}
      </p>
      <div className="ocard-foot">
        <b>{money(order.total)}</b>
        <span className={`age ${isLate(order.status, order.created_at, now) ? 'late' : ''}`}>
          {order.status === 'entregado'
            ? time(order.created_at)
            : `hace ${minutesSince(order.created_at, now)} min`}
        </span>
      </div>
    </>
  );
}

function Channels({ order }: { order: PanelOrder }) {
  return (
    <span>
      {order.fulfillment === 'recoger' ? <span className="ch ch-recoger">Recoge</span> : null}{' '}
      <span className={`ch ch-${order.channel}`}>{CHANNEL_LABEL[order.channel]}</span>
    </span>
  );
}

type Board = Record<OrderStatus, PanelOrder[]>;

/** Lo que React necesita del arrastre para pintar; el resto vive en una ref (D53). */
interface DragView {
  id: string;
  from: OrderStatus;
  over: OrderStatus | null;
  /** Foto del tablero al empezar: un cambio en vivo no reordena hasta soltar. */
  snapshot: Board;
}

/** Gesto en curso (puntero, temporizador, fantasma). Se limpia siempre con `end`. */
interface Gesture {
  order: PanelOrder;
  pointerId: number;
  touch: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  card: HTMLElement;
  ghost: HTMLElement | null;
  timer: number | null;
  raf: number | null;
  active: boolean;
  over: OrderStatus | null;
  end: (returnGhost: boolean) => void;
}

/** Pulsación larga para empezar a arrastrar con el dedo; antes de eso el dedo desplaza el tablero. */
const LONG_PRESS_MS = 250;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Pedidos({
  orders,
  fresh,
  now,
  restaurant,
  restaurantPhone,
  restaurantAddress,
  isAdmin,
  onChanged,
}: {
  orders: PanelOrder[];
  fresh: Set<string>;
  now: number;
  restaurant: string;
  /** Datos del negocio para el recibo (D54); opcionales mientras el panel no los cargue. */
  restaurantPhone?: string;
  restaurantAddress?: string;
  /** Si el panel ya sabe el rol; si no, se consulta una vez. Solo decide botones: la base valida. */
  isAdmin?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fetchedRole, setFetchedRole] = useState<StaffRole | null>(null);
  const [moves, setMoves] = useState<Map<string, PendingMove>>(() => new Map());
  const [drag, setDrag] = useState<DragView | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** Movimiento que espera confirmación (a Entregado o saltando estados). */
  const [confirmMove, setConfirmMove] = useState<{
    order: PanelOrder;
    from: OrderStatus;
    to: OrderStatus;
  } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClickUntil = useRef(0);
  useEffect(() => {
    if (isAdmin !== undefined) return;
    let alive = true;
    void loadMyRole().then((value) => {
      if (alive) setFetchedRole(value);
    });
    return () => {
      alive = false;
    };
  }, [isAdmin]);
  const role: StaffRole | null = isAdmin === undefined ? fetchedRole : isAdmin ? 'admin' : 'operador';
  const shown = useMemo(() => applyMoves(orders, moves), [orders, moves]);
  const liveBoard = useMemo(() => groupBoard(shown, now), [shown, now]);
  const board = drag ? drag.snapshot : liveBoard;
  /** Pedidos con un movimiento enviado y sin respuesta: no se vuelven a arrastrar. */
  const pending = useMemo(
    () =>
      new Set(orders.filter((order) => moves.get(order.id)?.from === order.status).map((order) => order.id)),
    [orders, moves],
  );
  const open = orders.find((order) => order.id === openId) ?? null;
  const voiding = orders.find((order) => order.id === voidId) ?? null;

  // Lo último que llegó en vivo, para validar al soltar (no la foto del arrastre).
  const latest = useRef({ orders, moves, liveBoard, onChanged });
  useEffect(() => {
    latest.current = { orders, moves, liveBoard, onChanged };
  }, [orders, moves, liveBoard, onChanged]);

  const announce = useCallback(
    (message: string) => {
      setAnnouncement(message);
      toast(message);
    },
    [toast],
  );

  // Con el arrastre activo el dedo no desplaza el tablero. Listener nativo no pasivo desde el montaje:
  // React registra touchmove como pasivo y touch-action no cambia a mitad del gesto.
  useEffect(() => {
    const element = boardRef.current;
    if (!element) return;
    const onTouchMove = (event: TouchEvent) => {
      if (gesture.current?.active && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      element.removeEventListener('touchmove', onTouchMove);
      gesture.current?.end(false);
    };
  }, []);

  /** Columna bajo el puntero, solo por la x (las columnas van lado a lado, también en celular). */
  const columnAt = useCallback((x: number): OrderStatus | null => {
    for (const column of boardRef.current?.querySelectorAll<HTMLElement>('[data-col]') ?? []) {
      const rect = column.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return column.dataset['col'] as OrderStatus;
    }
    return null;
  }, []);

  const commit = useCallback(
    async (order: PanelOrder, from: OrderStatus, to: OrderStatus) => {
      setMoves((current) => {
        const next = new Map(current);
        for (const id of staleMoves(latest.current.orders, current)) next.delete(id);
        next.set(order.id, { from, to });
        return next;
      });
      try {
        await setStatus(order.id, to);
        announce(`${order.code} pasó a ${STATUS_LABEL[to]}`);
        latest.current.onChanged();
      } catch (failure) {
        setMoves((current) => {
          const next = new Map(current);
          next.delete(order.id);
          return next;
        });
        announce(
          `${order.code} volvió a ${STATUS_LABEL[from]}. ${
            failure instanceof Error ? failure.message : 'No se pudo cambiar el estado.'
          }`,
        );
      }
    },
    [announce],
  );

  function startGesture(event: ReactPointerEvent<HTMLElement>, order: PanelOrder) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (gesture.current || !canDrag(order.status) || pending.has(order.id)) return;
    const card = event.currentTarget;
    const live: Gesture = {
      order,
      pointerId: event.pointerId,
      touch: event.pointerType === 'touch',
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      offsetX: 0,
      offsetY: 0,
      card,
      ghost: null,
      timer: null,
      raf: null,
      active: false,
      over: null,
      end: () => undefined,
    };
    gesture.current = live;

    const place = () => {
      live.ghost?.style.setProperty(
        'transform',
        `translate3d(${live.x - live.offsetX}px, ${live.y - live.offsetY}px, 0) rotate(2deg)`,
      );
    };
    const hover = () => {
      const over = columnAt(live.x);
      if (over === live.over) return;
      live.over = over;
      setDrag((current) => (current ? { ...current, over } : current));
    };
    const tick = () => {
      const element = boardRef.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        const delta = edgeScroll(live.x, rect.left, rect.right);
        if (delta) {
          element.scrollLeft += delta;
          hover();
        }
      }
      live.raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      live.timer = null;
      if (gesture.current !== live) return;
      const rect = card.getBoundingClientRect();
      live.active = true;
      live.offsetX = live.startX - rect.left;
      live.offsetY = live.startY - rect.top;
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-testid');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.classList.remove('is-new');
      ghost.classList.add('ocard-ghost');
      ghost.style.setProperty('width', `${rect.width}px`);
      document.body.append(ghost);
      live.ghost = ghost;
      place();
      card.classList.add('is-lifted');
      try {
        if (!live.touch) card.setPointerCapture(live.pointerId);
      } catch {
        // El puntero ya se soltó: pointerup limpia.
      }
      if (live.touch) navigator.vibrate?.(8);
      live.over = live.order.status;
      setDrag({ id: order.id, from: order.status, over: live.over, snapshot: latest.current.liveBoard });
      live.raf = requestAnimationFrame(tick);
    };
    const drop = () => {
      const to = live.over;
      const current = latest.current.orders.find((item) => item.id === order.id);
      if (!to || !current || to === current.status) {
        if (!current) announce(`${order.code} ya no está en el tablero.`);
        return true;
      }
      if (!canDrop(current.status, to)) {
        announce(dropRejection(current.status, to) ?? `${order.code} no se puede mover ahí.`);
        return true;
      }
      if (needsDropConfirm(current.status, to)) {
        // La tarjeta vuelve a su columna mientras se confirma.
        setConfirmMove({ order: current, from: current.status, to });
        return true;
      }
      void commit(current, current.status, to);
      return false;
    };
    const onMove = (pointer: PointerEvent) => {
      if (pointer.pointerId !== live.pointerId) return;
      live.x = pointer.clientX;
      live.y = pointer.clientY;
      const dx = live.x - live.startX;
      const dy = live.y - live.startY;
      if (!live.active) {
        // Con el dedo, moverse antes de la pulsación larga es desplazar: se suelta el gesto.
        if (live.touch) {
          if (passedThreshold(dx, dy, 8)) end(false);
        } else if (passedThreshold(dx, dy)) begin();
        return;
      }
      if (pointer.cancelable) pointer.preventDefault();
      place();
      hover();
    };
    const onUp = (pointer: PointerEvent) => {
      if (pointer.pointerId !== live.pointerId) return;
      end(live.active ? drop() : false);
    };
    const onCancel = (pointer: PointerEvent) => {
      if (pointer.pointerId === live.pointerId) end(true);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape' && live.active) end(true);
    };
    const onHide = () => end(true);
    const onVisibility = () => {
      if (document.hidden) end(true);
    };
    const onSelect = (select: Event) => {
      if (live.active) select.preventDefault();
    };
    /** Limpia todo (iOS puede mandar pointercancel en cualquier momento). Idempotente. */
    function end(returnGhost: boolean) {
      if (gesture.current !== live) return;
      gesture.current = null;
      if (live.timer !== null) clearTimeout(live.timer);
      if (live.raf !== null) cancelAnimationFrame(live.raf);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      removeEventListener('keydown', onKey);
      removeEventListener('blur', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('selectstart', onSelect);
      try {
        if (card.hasPointerCapture(live.pointerId)) card.releasePointerCapture(live.pointerId);
      } catch {
        // Sin captura activa.
      }
      if (!live.active) return;
      // Tras un arrastre llega un click al botón: no abre el pedido.
      suppressClickUntil.current = performance.now() + 400;
      const ghost = live.ghost;
      const back = () => {
        ghost?.remove();
        card.classList.remove('is-lifted');
      };
      if (ghost && returnGhost && !reducedMotion() && card.isConnected) {
        const rect = card.getBoundingClientRect();
        ghost.classList.add('is-returning');
        ghost.style.setProperty('transform', `translate3d(${rect.left}px, ${rect.top}px, 0)`);
        ghost.addEventListener('transitionend', back, { once: true });
        setTimeout(back, 300);
      } else back();
      setDrag(null);
    }
    live.end = end;

    addEventListener('pointermove', onMove, { passive: false });
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    addEventListener('keydown', onKey);
    addEventListener('blur', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('selectstart', onSelect);
    if (live.touch) live.timer = window.setTimeout(begin, LONG_PRESS_MS);
  }

  const columnClass = (status: OrderStatus) => {
    if (!drag) return 'col';
    const valid = canDrop(drag.from, status);
    return [
      'col',
      valid ? 'col-drop' : status === drag.from ? '' : 'col-no',
      drag.over === status && status !== drag.from ? 'is-over' : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  return (
    <>
      <div className="note">
        Los pedidos de la página entran solos con sonido. Los que llegan por WhatsApp o llamada se registran
        con <b>＋ Pedido manual</b>. Para avanzar un pedido arrástralo a otra columna (en el celular, mantenlo
        presionado) o ábrelo y usa el botón del siguiente estado.
      </div>
      <p className="board-live" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className={`board ${drag ? 'is-dragging' : ''}`} ref={boardRef}>
        {BOARD_COLUMNS.map(([status, label]) => {
          const list = board[status];
          return (
            <section className={columnClass(status)} aria-label={label} key={status} data-col={status}>
              <div className="col-head">
                <b>{label}</b>
                <span>{list.length}</span>
              </div>
              {list.length === 0 ? <p className="board-empty">Vacío</p> : null}
              {list.map((order) =>
                isCompact(order.status) ? (
                  <div
                    key={order.id}
                    className={`ocard ocard-compact ${expanded.has(order.id) ? 'is-open' : ''}`}
                    data-testid={`pedido-${order.code}`}
                  >
                    <button
                      className="ocard-toggle"
                      type="button"
                      aria-expanded={expanded.has(order.id)}
                      aria-controls={`pedido-mas-${order.id}`}
                      onClick={() => setExpanded((current) => toggleOpen(current, order.id))}
                    >
                      <b>{order.code}</b>
                      <span>{money(order.total)}</span>
                    </button>
                    {expanded.has(order.id) ? (
                      <div className="ocard-more" id={`pedido-mas-${order.id}`}>
                        <Channels order={order} />
                        <CardBody order={order} now={now} />
                        <button
                          className="btn btn-soft btn-sm"
                          type="button"
                          onClick={() => setOpenId(order.id)}
                        >
                          Ver pedido
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    key={order.id}
                    className={[
                      'ocard',
                      'ocard-drag',
                      fresh.has(order.id) ? 'is-new' : '',
                      pending.has(order.id) ? 'is-pending' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    type="button"
                    aria-busy={pending.has(order.id) || undefined}
                    onPointerDown={(event) => startGesture(event, order)}
                    onContextMenu={(event) => {
                      if (gesture.current) event.preventDefault();
                    }}
                    onClick={() => {
                      if (performance.now() < suppressClickUntil.current) return;
                      setOpenId(order.id);
                    }}
                    data-testid={`pedido-${order.code}`}
                  >
                    <div className="ocard-top">
                      <b>{order.code}</b>
                      <Channels order={order} />
                    </div>
                    <CardBody order={order} now={now} />
                  </button>
                ),
              )}
            </section>
          );
        })}
      </div>
      {confirmMove ? (
        <ConfirmMove
          question={dropConfirmText(confirmMove.order.code, confirmMove.from, confirmMove.to)}
          onCancel={() => {
            setConfirmMove(null);
            setAnnouncement(`${confirmMove.order.code} sigue en ${STATUS_LABEL[confirmMove.from]}`);
          }}
          onConfirm={() => {
            const { order, from, to } = confirmMove;
            setConfirmMove(null);
            const current = latest.current.orders.find((item) => item.id === order.id);
            if (!current || current.status !== from || !canDrop(from, to)) {
              announce(`${order.code} cambió mientras confirmabas; revisa el tablero.`);
              return;
            }
            void commit(current, from, to);
          }}
        />
      ) : null}
      {voiding ? (
        <VoidOrder
          order={voiding}
          onClose={() => setVoidId(null)}
          onDone={() => {
            setAnnouncement(`${voiding.code} anulado`);
            setVoidId(null);
            setOpenId(null);
            onChanged();
          }}
        />
      ) : open ? (
        <OrderDetail
          order={open}
          role={role}
          business={{
            name: restaurant,
            ...(restaurantPhone ? { phone: restaurantPhone } : {}),
            ...(restaurantAddress ? { address: restaurantAddress } : {}),
          }}
          onClose={() => setOpenId(null)}
          onVoid={() => setVoidId(open.id)}
          onMoved={setAnnouncement}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

/** Confirmación al soltar en Entregado o saltando estados. Cancelar deja la tarjeta donde estaba. */
function ConfirmMove({
  question,
  onCancel,
  onConfirm,
}: {
  question: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <Modal title="Confirmar cambio" onClose={onCancel}>
      <p className="confirm-move">{question}</p>
      <div className="btn-row">
        <button ref={yes} className="btn btn-primary" type="button" onClick={onConfirm}>
          Sí, cambiar
        </button>
        <button className="btn btn-soft" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

/** Anular con motivo (D42). Reemplaza al cajón mientras está abierto: Escape vuelve al pedido. */
function VoidOrder({
  order,
  onClose,
  onDone,
}: {
  order: PanelOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [choice, setChoice] = useState<VoidReason | ''>('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const reason = voidReasonText(choice, detail);
  const delivered = order.status === 'entregado';

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!reason)
      return setFailure(choice === 'Otro' ? 'Escribe el motivo (mínimo 3 letras).' : 'Elige un motivo.');
    setBusy(true);
    setFailure('');
    try {
      await setStatus(order.id, 'cancelado', reason);
      toast(`${order.code} anulado`);
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No se pudo anular.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Anular ${order.code}`} onClose={onClose}>
      <form className="form void-form" onSubmit={(event) => void submit(event)} noValidate>
        <p className="void-sum">
          {STATUS_LABEL[order.status]} · {order.customer_name} · <b>{money(order.total)}</b>
        </p>
        <fieldset className="void-reasons">
          <legend>Motivo</legend>
          <div className="chips">
            {VOID_REASONS.map((item, index) => (
              <label className="chip-check" key={item}>
                <input
                  ref={index === 0 ? first : undefined}
                  type="radio"
                  name="void-reason"
                  value={item}
                  checked={choice === item}
                  onChange={() => setChoice(item)}
                />
                {item}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="void-detail">
            {choice === 'Otro' ? 'Cuál es el motivo' : 'Detalle (opcional)'}
          </label>
          <input
            className="input"
            id="void-detail"
            maxLength={180}
            value={detail}
            aria-invalid={choice === 'Otro' && failure ? true : undefined}
            onChange={(event) => setDetail(event.target.value)}
          />
        </div>
        <div className="note note-warn" role="note">
          <b>Los insumos vuelven al inventario y el pedido sale de ventas.</b> No se borra: queda en el
          historial con el motivo.
          {delivered
            ? ' Si la caja de ese día ya se cerró, el cierre no cambia y Ventas lo muestra aparte.'
            : ''}
          {choice === 'Pedido de prueba' ? ' Como es de prueba, tampoco cuenta como cancelado.' : ''}
          {choice === 'Pedido falso' ? ' Además bloquea ese celular para nuevos pedidos.' : ''}
        </div>
        {failure ? (
          <p className="void-error" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Anulando…' : 'Anular pedido'}
          </button>
          <button className="btn btn-soft" type="button" onClick={onClose} disabled={busy}>
            Volver
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OrderDetail({
  order,
  role,
  business,
  onClose,
  onVoid,
  onMoved,
  onChanged,
}: {
  order: PanelOrder;
  role: StaffRole | null;
  business: { name: string; phone?: string; address?: string };
  onClose: () => void;
  onVoid: () => void;
  /** Anuncia el cambio en la región aria-live del tablero (el cajón se cierra). */
  onMoved: (message: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { next, canCancel, canVoid } = orderActions(order.status, role, order.fulfillment);

  async function move(status: PanelOrder['status'], why?: string) {
    setBusy(true);
    try {
      await setStatus(order.id, status, why);
      toast(`${order.code} → ${STATUS_LABEL[status]}`);
      onMoved(`${order.code} pasó a ${STATUS_LABEL[status]}`);
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
          href={customerWhatsApp(order.phone, order.customer_name, order.code, business.name)}
          target="_blank"
          rel="noopener"
        >
          WhatsApp
        </a>
        <Recibo order={order} business={business} />
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
          {itemsOf(order).map((item, i) => (
            <div key={i} className={item.isAddon ? 'line-addon' : undefined}>
              <span>
                {item.isAddon ? '+ ' : ''}
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
      {canVoid ? (
        <div className="void-row">
          <button className="btn btn-soft btn-sm" type="button" disabled={busy} onClick={onVoid}>
            Anular pedido
          </button>
          <span className="hint">Sale de ventas y los insumos vuelven al inventario.</span>
        </div>
      ) : null}
      {canCancel ? (
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
            disabled={busy}
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
