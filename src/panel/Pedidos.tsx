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
  DELIVER_UNDO_MS,
  PUBLIC_CANCEL_MAX,
  PUBLIC_CANCEL_MESSAGES,
  STATUS_LABEL,
  VOID_REASONS,
  asksRestore,
  cancelWhatsApp,
  customerWhatsApp,
  deferredConflicts,
  publicCancelText,
  restoreFlag,
  undoSecondsLeft,
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
  type CancelledToday,
  type PublicCancelChoice,
  type StaffRole,
  type VoidReason,
} from '../core/orders';
import {
  loadMyRole,
  loadCancelledToday,
  sessionToken,
  setStatus,
  setStatusKeepalive,
  type PanelOrder,
} from './data';
import { Recibo } from './Recibo';
import { Drawer, Modal, useAnnounce } from './ui';

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

/** Entrega diferida (D60): sale a los 10 s salvo "Deshacer"; al cerrar la pestaña sale de inmediato. */
interface Deferred {
  from: OrderStatus;
  code: string;
  deadline: number;
  timer: number;
  /** Token de la sesión, guardado al programar: en pagehide no se puede esperar getSession. */
  token: string | null;
}

/** Resultado de una anulación con mensaje público: ofrece avisar por WhatsApp (D59). */
interface CancelResult {
  code: string;
  phone: string;
  name: string;
  verb: 'anulado' | 'cancelado';
  message: string;
  coupon: string | null;
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
  const announce = useAnnounce();
  const [openId, setOpenId] = useState<string | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null);
  /** Pedidos con "Deshacer" visible y su fecha límite (copia para pintar; la verdad está en `deferred`). */
  const [undo, setUndo] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [clock, setClock] = useState(() => Date.now());
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancelledList, setCancelledList] = useState<CancelledToday[]>([]);
  /** Sube al anular o cancelar desde este panel para recargar Cancelados de hoy. */
  const [cancelledBump, setCancelledBump] = useState(0);
  const deferred = useRef(new Map<string, Deferred>());
  /** Enviados con keepalive: si la página vuelve del historial (bfcache) se recarga el tablero. */
  const flushed = useRef(new Set<string>());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fetchedRole, setFetchedRole] = useState<StaffRole | null>(null);
  const [moves, setMoves] = useState<Map<string, PendingMove>>(() => new Map());
  const [drag, setDrag] = useState<DragView | null>(null);
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

  // D60: la RPC trae los de hoy aunque el pedido sea de hace más de 36 h. Se recarga al montar, al anular
  // o cancelar aquí y cuando cambia el conjunto de cancelados del tablero (otro dispositivo, en vivo).
  const cancelledKey = useMemo(
    () =>
      orders
        .filter((order) => order.status === 'cancelado')
        .map((order) => order.id)
        .sort()
        .join(','),
    [orders],
  );
  useEffect(() => {
    let alive = true;
    void loadCancelledToday()
      .then((list) => {
        if (alive) setCancelledList(list);
      })
      .catch(() => undefined); // se conserva la última lista
    return () => {
      alive = false;
    };
  }, [cancelledKey, cancelledBump]);

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

  /* Deshacer al marcar Entregado (D60). */

  const dropMove = useCallback((id: string) => {
    setMoves((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);
  const syncUndo = useCallback(() => {
    setUndo(new Map([...deferred.current].map(([id, entry]) => [id, entry.deadline])));
  }, []);
  /** Saca la entrega de la cola (sin enviar). Devuelve la entrada si existía. */
  const takeDeferred = useCallback(
    (id: string) => {
      const entry = deferred.current.get(id);
      if (!entry) return null;
      clearTimeout(entry.timer);
      deferred.current.delete(id);
      syncUndo();
      return entry;
    },
    [syncUndo],
  );
  const fireDeferred = useCallback(
    (id: string) => {
      const entry = takeDeferred(id);
      if (!entry) return;
      const current = latest.current.orders.find((item) => item.id === id);
      if (!current || current.status !== entry.from) {
        dropMove(id);
        announce(`${entry.code} cambió en otro dispositivo: no se marcó como entregado.`);
        return;
      }
      void commit(current, entry.from, 'entregado');
    },
    [announce, commit, dropMove, takeDeferred],
  );

  const deferDeliver = useCallback(
    (order: PanelOrder, from: OrderStatus) => {
      if (deferred.current.has(order.id)) return;
      setMoves((current) => {
        const next = new Map(current);
        for (const id of staleMoves(latest.current.orders, current)) next.delete(id);
        next.set(order.id, { from, to: 'entregado' });
        return next;
      });
      const entry: Deferred = {
        from,
        code: order.code,
        deadline: Date.now() + DELIVER_UNDO_MS,
        timer: window.setTimeout(() => fireDeferred(order.id), DELIVER_UNDO_MS),
        token: null,
      };
      deferred.current.set(order.id, entry);
      setClock(Date.now());
      syncUndo();
      void sessionToken().then((token) => {
        entry.token = token;
      });
      announce(`${order.code} se marca como entregado en 10 segundos. Puedes deshacerlo.`);
    },
    [announce, fireDeferred, syncUndo],
  );

  const undoDeliver = useCallback(
    (id: string) => {
      const entry = takeDeferred(id);
      if (!entry) return;
      dropMove(id);
      announce(`${entry.code} sigue en ${STATUS_LABEL[entry.from]}.`);
    },
    [announce, dropMove, takeDeferred],
  );

  /** Envía ya todas las entregas en cola: con keepalive si la página se va, o normal al salir de Pedidos. */
  const flushDeferred = useCallback(
    (leaving: boolean) => {
      for (const [id, entry] of [...deferred.current]) {
        takeDeferred(id);
        // El pedido ya no está donde se programó: otro dispositivo lo cambió y no se pisa.
        if (latest.current.orders.find((item) => item.id === id)?.status !== entry.from) {
          dropMove(id);
          continue;
        }
        if (leaving && entry.token) {
          flushed.current.add(id);
          setStatusKeepalive(id, 'entregado', entry.token);
        } else
          void setStatus(id, 'entregado').then(
            () => latest.current.onChanged(),
            (failure: unknown) =>
              announce(
                `${entry.code} no se marcó como entregado. ${failure instanceof Error ? failure.message : ''}`.trim(),
              ),
          );
      }
    },
    [announce, dropMove, takeDeferred],
  );
  // Cuenta regresiva visible mientras haya entregas en cola.
  useEffect(() => {
    if (undo.size === 0) return;
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, [undo.size]);

  // Otro dispositivo cambió un pedido en cola: se cancela la entrega y se avisa (no se pisa).
  useEffect(() => {
    for (const id of deferredConflicts(orders, deferred.current)) {
      const entry = takeDeferred(id);
      if (!entry) continue;
      dropMove(id);
      announce(`${entry.code} cambió en otro dispositivo: no se marcó como entregado.`);
    }
  }, [orders, announce, dropMove, takeDeferred]);

  // Cerrar la pestaña, ocultarla (el celular la congela o la mata sin pagehide) o salir de Pedidos envía ya.
  useEffect(() => {
    const onPageHide = () => flushDeferred(true);
    // Al volver, lo enviado con keepalive se relee de la base (si falló, la tarjeta no queda mintiendo).
    const reread = () => {
      if (flushed.current.size === 0) return;
      for (const id of flushed.current) dropMove(id);
      flushed.current.clear();
      latest.current.onChanged();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushDeferred(true);
      else reread();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reread();
    };
    addEventListener('pagehide', onPageHide);
    addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      removeEventListener('pagehide', onPageHide);
      removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
      flushDeferred(false);
    };
  }, [flushDeferred, dropMove]);

  /** Mover a un estado: Entregado espera 10 s con "Deshacer" (D60); el resto sale ya. */
  const advance = useCallback(
    (order: PanelOrder, from: OrderStatus, to: OrderStatus) => {
      if (to === 'entregado') deferDeliver(order, from);
      else void commit(order, from, to);
    },
    [commit, deferDeliver],
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
      // CSP (WebKit): un atributo style copiado al clonar cuenta como estilo en línea. Se quita en el
      // fantasma y en sus hijos; la posición y el ancho van por CSSOM (el.style.setProperty sí se permite).
      ghost.removeAttribute('style');
      for (const child of ghost.querySelectorAll('[style]')) child.removeAttribute('style');
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
                    className={[
                      'ocard',
                      'ocard-compact',
                      expanded.has(order.id) ? 'is-open' : '',
                      undo.has(order.id) ? 'is-deferred' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
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
                    {undo.has(order.id) ? (
                      <div className="undo-bar">
                        <span className="undo-track" aria-hidden="true">
                          <span className="undo-fill" />
                        </span>
                        <button
                          className="btn btn-soft btn-sm"
                          type="button"
                          onClick={() => undoDeliver(order.id)}
                        >
                          Deshacer ({undoSecondsLeft(undo.get(order.id) ?? 0, clock)} s)
                        </button>
                      </div>
                    ) : null}
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
            announce(`${confirmMove.order.code} sigue en ${STATUS_LABEL[confirmMove.from]}`, {
              toast: false,
            });
          }}
          onConfirm={() => {
            const { order, from, to } = confirmMove;
            setConfirmMove(null);
            const current = latest.current.orders.find((item) => item.id === order.id);
            if (!current || current.status !== from || !canDrop(from, to)) {
              announce(`${order.code} cambió mientras confirmabas; revisa el tablero.`);
              return;
            }
            advance(current, from, to);
          }}
        />
      ) : null}
      {cancelledList.length > 0 ? (
        <section className="cancelled-today" aria-label="Cancelados de hoy">
          <button
            className="cancelled-toggle"
            type="button"
            aria-expanded={showCancelled}
            aria-controls="cancelados-hoy"
            onClick={() => setShowCancelled((value) => !value)}
          >
            <b>Cancelados de hoy</b>
            <span>{cancelledList.length}</span>
          </button>
          {showCancelled ? (
            <ul className="cancelled-list" id="cancelados-hoy">
              {cancelledList.map((item) => (
                <li key={item.id} data-testid={`cancelado-${item.code}`}>
                  <div className="cancelled-head">
                    <b>{item.code}</b>
                    <span>{time(item.at)}</span>
                    <span className="cancelled-total">{money(item.total)}</span>
                  </div>
                  <dl className="cancelled-kv">
                    <dt>Estaba en</dt>
                    <dd>{item.voidedFrom ? STATUS_LABEL[item.voidedFrom] : '—'}</dd>
                    <dt>Motivo</dt>
                    <dd>{item.reason ?? '—'}</dd>
                    <dt>Al cliente</dt>
                    <dd>{item.publicMessage ?? 'Sin mensaje'}</dd>
                    <dt>Insumos</dt>
                    <dd>
                      {item.suppliesRestored === false
                        ? 'No volvieron (ya se usaron)'
                        : item.suppliesRestored
                          ? 'Volvieron al inventario'
                          : '—'}
                    </dd>
                    <dt>Quién</dt>
                    <dd>{item.by}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {cancelResult ? (
        <CancelDone result={cancelResult} restaurant={restaurant} onClose={() => setCancelResult(null)} />
      ) : voiding ? (
        <VoidOrder
          order={voiding}
          onClose={() => setVoidId(null)}
          onDone={(result) => {
            setVoidId(null);
            setOpenId(null);
            if (result) setCancelResult(result);
            setCancelledBump((value) => value + 1);
            onChanged();
          }}
        />
      ) : open ? (
        <OrderDetail
          order={open}
          role={role}
          deferredUntil={undo.get(open.id) ?? null}
          business={{
            name: restaurant,
            ...(restaurantPhone ? { phone: restaurantPhone } : {}),
            ...(restaurantAddress ? { address: restaurantAddress } : {}),
          }}
          onClose={() => setOpenId(null)}
          onVoid={() => setVoidId(open.id)}
          onDeliver={() => {
            setOpenId(null);
            deferDeliver(open, open.status);
          }}
          onCancelled={(result) => {
            setOpenId(null);
            if (result) setCancelResult(result);
            setCancelledBump((value) => value + 1);
          }}
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

/** Mensaje para el cliente y devolución de insumos (D59): lo comparten anular (admin) y cancelar (operador). */
interface CancelExtrasValue {
  publicChoice: PublicCancelChoice | '';
  publicOther: string;
  /** Respuesta a "¿Devolver insumos?" (por defecto No). Solo cuenta desde En el barril. */
  restore: boolean;
}
const EMPTY_EXTRAS: CancelExtrasValue = { publicChoice: '', publicOther: '', restore: false };

function CancelExtras({
  idPrefix,
  status,
  value,
  invalidOther,
  onChange,
}: {
  idPrefix: string;
  status: OrderStatus;
  value: CancelExtrasValue;
  invalidOther: boolean;
  onChange: (value: CancelExtrasValue) => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-public`}>Mensaje para el cliente (opcional)</label>
        <select
          className="select"
          id={`${idPrefix}-public`}
          value={value.publicChoice}
          onChange={(event) =>
            onChange({ ...value, publicChoice: event.target.value as PublicCancelChoice | '' })
          }
        >
          <option value="">Sin mensaje</option>
          {PUBLIC_CANCEL_MESSAGES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <span className="hint">Lo ve en el seguimiento del pedido y puedes enviárselo por WhatsApp.</span>
      </div>
      {value.publicChoice === 'Otro' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-public-other`}>Qué le decimos al cliente</label>
          <input
            className="input"
            id={`${idPrefix}-public-other`}
            maxLength={PUBLIC_CANCEL_MAX}
            value={value.publicOther}
            aria-invalid={invalidOther || undefined}
            aria-describedby={`${idPrefix}-public-count`}
            onChange={(event) => onChange({ ...value, publicOther: event.target.value })}
          />
          <span className="hint" id={`${idPrefix}-public-count`}>
            {value.publicOther.length}/{PUBLIC_CANCEL_MAX}
          </span>
        </div>
      ) : null}
      {asksRestore(status) ? (
        <fieldset className="void-reasons">
          <legend>¿Devolver insumos al inventario?</legend>
          <div className="chips">
            <label className="chip-check">
              <input
                type="radio"
                name={`${idPrefix}-restore`}
                checked={!value.restore}
                onChange={() => onChange({ ...value, restore: false })}
              />
              No, ya se usaron
            </label>
            <label className="chip-check">
              <input
                type="radio"
                name={`${idPrefix}-restore`}
                checked={value.restore}
                onChange={() => onChange({ ...value, restore: true })}
              />
              Sí, devolverlos
            </label>
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

/** Texto del aviso según lo elegido: insumos, cupón y ventas. */
function cancelNote(order: PanelOrder, extras: CancelExtrasValue): string {
  const restore = restoreFlag(order.status, extras.restore);
  return [
    restore ? 'Los insumos vuelven al inventario.' : 'Los insumos no vuelven al inventario.',
    order.coupon_code ? `El cupón ${order.coupon_code} recupera el uso.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Envía la anulación con motivo interno, mensaje público e insumos. Devuelve el resultado para avisar al cliente. */
async function sendCancel(
  order: PanelOrder,
  reason: string,
  extras: CancelExtrasValue,
  verb: CancelResult['verb'],
): Promise<CancelResult | null> {
  const message = publicCancelText(extras.publicChoice, extras.publicOther);
  await setStatus(order.id, 'cancelado', reason, {
    publicReason: message ?? null,
    restore: restoreFlag(order.status, extras.restore),
  });
  return message
    ? {
        code: order.code,
        phone: order.phone,
        name: order.customer_name,
        verb,
        message,
        coupon: order.coupon_code,
      }
    : null;
}

/** Aviso del resultado (una sola vez, por la región única del panel). */
function cancelToast(order: PanelOrder, verb: CancelResult['verb']): string {
  return `${order.code} ${verb}${order.coupon_code ? ` · el cupón ${order.coupon_code} recupera el uso` : ''}`;
}

/** Anular con motivo (D42, D59). Reemplaza al cajón mientras está abierto: Escape vuelve al pedido. */
function VoidOrder({
  order,
  onClose,
  onDone,
}: {
  order: PanelOrder;
  onClose: () => void;
  onDone: (result: CancelResult | null) => void;
}) {
  const announce = useAnnounce();
  const [choice, setChoice] = useState<VoidReason | ''>('');
  const [detail, setDetail] = useState('');
  const [extras, setExtras] = useState<CancelExtrasValue>(EMPTY_EXTRAS);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const reason = voidReasonText(choice, detail);
  const delivered = order.status === 'entregado';
  const otherMissing = publicCancelText(extras.publicChoice, extras.publicOther) === undefined;

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!reason)
      return setFailure(choice === 'Otro' ? 'Escribe el motivo (mínimo 3 letras).' : 'Elige un motivo.');
    if (otherMissing) return setFailure('Escribe el mensaje para el cliente (mínimo 3 letras).');
    setBusy(true);
    setFailure('');
    try {
      const result = await sendCancel(order, reason, extras, 'anulado');
      announce(cancelToast(order, 'anulado'));
      onDone(result);
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
          <span className="hint">Interno: solo lo ve el equipo.</span>
        </div>
        <CancelExtras
          idPrefix="void"
          status={order.status}
          value={extras}
          invalidOther={otherMissing && Boolean(failure)}
          onChange={setExtras}
        />
        <div className="note note-warn" role="note">
          <b>{cancelNote(order, extras)} El pedido sale de ventas.</b> No se borra: queda en el historial con
          el motivo.
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

/** Tras anular con mensaje público: avisar al cliente por WhatsApp (envío automático cuando cierre D48). */
function CancelDone({
  result,
  restaurant,
  onClose,
}: {
  result: CancelResult;
  restaurant: string;
  onClose: () => void;
}) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => link.current?.focus(), []);
  return (
    <Modal title={`${result.code} ${result.verb}`} onClose={onClose}>
      <div className="cancel-done">
        <p>
          Mensaje para el cliente: <b>{result.message}</b>
        </p>
        <p className="muted">
          {result.coupon ? `El cupón ${result.coupon} recuperó el uso. ` : ''}
          El cliente lo ve en el seguimiento del pedido.
        </p>
        <div className="btn-row">
          <a
            ref={link}
            className="btn btn-primary"
            href={cancelWhatsApp(result.phone, result.name, result.code, restaurant, result.message)}
            target="_blank"
            rel="noopener"
          >
            Avisar por WhatsApp
          </a>
          <button className="btn btn-soft" type="button" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </Modal>
  );
}

function OrderDetail({
  order,
  role,
  deferredUntil,
  business,
  onClose,
  onVoid,
  onDeliver,
  onCancelled,
  onChanged,
}: {
  order: PanelOrder;
  role: StaffRole | null;
  /** Fecha límite si el pedido espera los 10 s de "Deshacer" (D60): no se ofrecen acciones. */
  deferredUntil: number | null;
  business: { name: string; phone?: string; address?: string };
  onClose: () => void;
  onVoid: () => void;
  /** Pasar a Entregado: lo difiere el tablero con "Deshacer" (D60). */
  onDeliver: () => void;
  /** Cancelado por el operador; con mensaje público trae el resultado para avisar por WhatsApp. */
  onCancelled: (result: CancelResult | null) => void;
  onChanged: () => void;
}) {
  const announce = useAnnounce();
  const [reason, setReason] = useState('');
  const [extras, setExtras] = useState<CancelExtrasValue>(EMPTY_EXTRAS);
  const [busy, setBusy] = useState(false);
  const actions = orderActions(order.status, role, order.fulfillment);
  const locked = deferredUntil !== null;
  const next = locked ? null : actions.next;
  const canCancel = !locked && actions.canCancel;
  const canVoid = !locked && actions.canVoid;
  const otherMissing = publicCancelText(extras.publicChoice, extras.publicOther) === undefined;

  async function move(status: OrderStatus) {
    if (status === 'entregado') return onDeliver();
    setBusy(true);
    try {
      await setStatus(order.id, status);
      announce(`${order.code} pasó a ${STATUS_LABEL[status]}`);
      onChanged();
      onClose();
    } catch (failure) {
      announce(failure instanceof Error ? failure.message : 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!reason) return announce('Elige el motivo de la cancelación.');
    if (otherMissing) return announce('Escribe el mensaje para el cliente (mínimo 3 letras).');
    setBusy(true);
    try {
      const result = await sendCancel(order, reason, extras, 'cancelado');
      announce(cancelToast(order, 'cancelado'));
      onChanged();
      onCancelled(result);
    } catch (failure) {
      announce(failure instanceof Error ? failure.message : 'No se pudo cancelar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer title={`${order.code} · ${STATUS_LABEL[order.status]}`} onClose={onClose}>
      {locked ? (
        <p className="note" role="note">
          Se marca como entregado en unos segundos. Para evitarlo usa <b>Deshacer</b> en la tarjeta.
        </p>
      ) : null}
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
        {order.cancel_public ? (
          <>
            <dt>Al cliente</dt>
            <dd>{order.cancel_public}</dd>
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
          <span className="hint">
            Sale de ventas.{' '}
            {asksRestore(order.status)
              ? 'Eliges si los insumos vuelven al inventario.'
              : 'Los insumos vuelven al inventario.'}
          </span>
        </div>
      ) : null}
      {canCancel ? (
        <div className="cancel-box">
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
            <span className="hint">Interno: solo lo ve el equipo.</span>
          </div>
          <CancelExtras
            idPrefix="cancel"
            status={order.status}
            value={extras}
            invalidOther={false}
            onChange={setExtras}
          />
          <p className="hint">
            {cancelNote(order, extras)} "Pedido falso o broma" bloquea ese celular para nuevos pedidos.
          </p>
          <button className="btn btn-soft btn-sm" type="button" disabled={busy} onClick={() => void cancel()}>
            Cancelar con motivo
          </button>
        </div>
      ) : null}
    </Drawer>
  );
}
