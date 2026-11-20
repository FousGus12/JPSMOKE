// Panel del negocio (F5): ingreso con dos pasos, resumen y tablero de pedidos en vivo.
// Las demás pantallas (ventas, carta, promociones, eventos, editor, clientes, ajustes) llegan en F6–F8.
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { formatCop as money } from '../core/money';
import { isNewVersion } from '../core/version';
import { CHANNEL_LABEL, formatPhone } from '../core/orders';
import { currentStep, onAuthChange, signOut, type AuthStep, type Staff } from './auth';
import { loadOrders, loadSummary, watchOrders, type PanelOrder, type Summary } from './data';
import { ChangeTemp, Credentials, Enroll, Verify } from './Login';
import { ManualOrder } from './ManualOrder';
import {
  PAUSE_OPTIONS,
  activePause,
  formatClock,
  loadPausedUntil,
  minutesLeft,
  pauseOrders,
} from './ordering-data';
import { Pedidos } from './Pedidos';
import { Resumen } from './Resumen';
import { ToastProvider, beep, notify, useToast } from './ui';

const IDLE_MS = 30 * 60_000;
type View =
  | 'resumen'
  | 'pedidos'
  | 'ventas'
  | 'inventario'
  | 'whatsapp'
  | 'carta'
  | 'sitio'
  | 'promos'
  | 'eventos'
  | 'bienvenida'
  | 'resenas'
  | 'equipo'
  | 'clientes'
  | 'ajustes'
  | 'seguridad';
// Apartados del menú (D41): la base decide; el menú solo muestra lo que la persona puede usar.
const FIXED: Array<{ view: View; icon: string }> = [
  { view: 'ventas', icon: '📈' },
  { view: 'inventario', icon: '📦' },
  { view: 'whatsapp', icon: '💬' },
];
type GroupId = 'contenido' | 'administracion';
const GROUPS: Array<{ id: GroupId; label: string; items: Array<{ view: View; icon: string }> }> = [
  {
    id: 'contenido',
    label: 'Contenido',
    items: [
      { view: 'carta', icon: '🍔' },
      { view: 'sitio', icon: '✏️' },
      { view: 'promos', icon: '🎟️' },
      { view: 'eventos', icon: '📣' },
      { view: 'bienvenida', icon: '👋' },
      { view: 'resenas', icon: '⭐' },
    ],
  },
  {
    id: 'administracion',
    label: 'Administración',
    items: [
      { view: 'equipo', icon: '👥' },
      { view: 'clientes', icon: '👤' },
      { view: 'ajustes', icon: '⚙️' },
      { view: 'seguridad', icon: '🔒' },
    ],
  },
];
const TITLES: Record<View, string> = {
  resumen: 'Resumen',
  pedidos: 'Pedidos',
  ventas: 'Ventas y estadísticas',
  inventario: 'Inventario',
  whatsapp: 'WhatsApp',
  carta: 'Carta y precios',
  sitio: 'Editar página',
  promos: 'Promociones y cupones',
  eventos: 'Eventos y banners',
  bienvenida: 'Bienvenida',
  resenas: 'Reseñas',
  equipo: 'Equipo y permisos',
  clientes: 'Clientes',
  ajustes: 'Ajustes',
  seguridad: 'Seguridad',
};
const GROUPS_KEY = 'jps-panel-grupos';

// Apartados con carga diferida: Resumen y Pedidos (base de todo operador) van en el trozo inicial.
// La descarga no se cachea si falla, para poder reintentar.
type ViewModule = { default: ComponentType<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
function makeView(factory: () => Promise<ViewModule>) {
  let pending: Promise<ViewModule> | undefined;
  const load = () =>
    (pending ??= factory().catch((failure: unknown) => {
      pending = undefined;
      throw failure;
    }));
  const def = {
    Comp: lazy(load),
    preload: () => void load().catch(() => undefined),
    reset: () => {
      def.Comp = lazy(load);
    },
  };
  return def;
}
const VIEWS = {
  ventas: makeView(() => import('./Ventas').then((mod) => ({ default: mod.Ventas }))),
  inventario: makeView(() => import('./Inventario').then((mod) => ({ default: mod.Inventario }))),
  whatsapp: makeView(() => import('./WhatsApp').then((mod) => ({ default: mod.WhatsApp }))),
  carta: makeView(() => import('./Carta').then((mod) => ({ default: mod.Carta }))),
  sitio: makeView(() => import('./EditarPagina').then((mod) => ({ default: mod.EditarPagina }))),
  promos: makeView(() => import('./Promociones').then((mod) => ({ default: mod.Promociones }))),
  eventos: makeView(() => import('./Eventos').then((mod) => ({ default: mod.Eventos }))),
  bienvenida: makeView(() => import('./Eventos').then((mod) => ({ default: mod.Bienvenida }))),
  resenas: makeView(() => import('./Resenas').then((mod) => ({ default: mod.Resenas }))),
  equipo: makeView(() => import('./Equipo').then((mod) => ({ default: mod.Equipo }))),
  clientes: makeView(() => import('./Clientes').then((mod) => ({ default: mod.Clientes }))),
  ajustes: makeView(() => import('./Ajustes').then((mod) => ({ default: mod.Ajustes }))),
  seguridad: makeView(() => import('./Seguridad').then((mod) => ({ default: mod.Seguridad }))),
  cuenta: makeView(() => import('./Equipo').then((mod) => ({ default: mod.MiCuenta }))),
};
type LazyDef = ReturnType<typeof makeView>;
const warm = (view: View) => {
  if (view in VIEWS) VIEWS[view as keyof typeof VIEWS].preload();
};

class ViewBoundary extends Component<
  { def: LazyDef; fallback: ReactNode; children: (View: ComponentType<any>) => ReactNode }, // eslint-disable-line @typescript-eslint/no-explicit-any
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  retry = () => {
    this.props.def.reset();
    this.setState({ failed: false });
  };
  override render() {
    if (this.state.failed)
      return (
        <div className="view-error" role="alert">
          <p className="muted">
            No se pudo cargar este apartado. Si se publicó una versión nueva del panel, recárgalo.
          </p>
          <div className="btn-row">
            <button className="btn btn-soft btn-sm" type="button" onClick={this.retry}>
              Reintentar
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => location.reload()}>
              Recargar el panel
            </button>
          </div>
        </div>
      );
    return <Suspense fallback={this.props.fallback}>{this.props.children(this.props.def.Comp)}</Suspense>;
  }
}

function readGroups(): Record<GroupId, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Partial<Record<GroupId, boolean>>;
    return { contenido: raw.contenido === true, administracion: raw.administracion === true };
  } catch {
    return { contenido: false, administracion: false };
  }
}

export function PanelApp() {
  return (
    <ToastProvider>
      <Gate />
    </ToastProvider>
  );
}

function Gate() {
  const [step, setStep] = useState<AuthStep | null>(null);
  const refresh = useCallback(() => {
    currentStep()
      .then(setStep)
      .catch(() => setStep({ kind: 'sin_sesion' }));
  }, []);
  useEffect(() => {
    refresh();
    return onAuthChange(refresh);
  }, [refresh]);

  // Cierre por inactividad (30 min).
  useEffect(() => {
    if (step?.kind !== 'dentro') return;
    let timer = setTimeout(() => void signOut(), IDLE_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void signOut(), IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((name) => addEventListener(name, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((name) => removeEventListener(name, reset));
    };
  }, [step]);

  if (!step) return <p className="muted center">Cargando…</p>;
  if (step.kind === 'sin_sesion') return <Credentials onDone={refresh} />;
  if (step.kind === 'cambiar_clave') return <ChangeTemp onDone={refresh} />;
  if (step.kind === 'inscribir_totp') return <Enroll onDone={refresh} />;
  if (step.kind === 'verificar_totp') return <Verify factorId={step.factorId} onDone={refresh} />;
  return <Shell staff={step.staff} />;
}

// Pausar pedidos (D61): cualquier miembro del equipo; la base la reabre sola. Hora en America/Bogota.
function PauseControl({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    loadPausedUntil(restaurantId)
      .then((value) => {
        setUntil(value);
        setNow(Date.now());
      })
      .catch(() => undefined);
  }, [restaurantId]);
  // Otra persona del equipo también puede pausar: se relee cada minuto y al volver a la pestaña.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [until]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onDown = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    addEventListener('keydown', onKey);
    addEventListener('pointerdown', onDown);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  async function change(minutes: number) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const value = await pauseOrders(minutes);
      setUntil(value);
      setNow(Date.now());
      toast(
        value && minutes > 0 ? `Pedidos pausados hasta las ${formatClock(value)}.` : 'Pedidos reanudados.',
      );
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo cambiar la pausa.');
    } finally {
      setBusy(false);
    }
  }

  const resumes = activePause(until, now);
  return (
    <div className="pause" ref={box}>
      {resumes !== null ? (
        <>
          <span className="pause-state" role="status">
            ⏸ <span className="pause-long">Pausado · vuelve a las </span>
            <span className="pause-short">Hasta las </span>
            {formatClock(resumes)}
            <span className="pause-long"> ({minutesLeft(resumes, now)} min)</span>
          </span>
          <button
            className="btn btn-soft btn-sm"
            type="button"
            disabled={busy}
            onClick={() => void change(0)}
          >
            Reanudar
          </button>
        </>
      ) : (
        <button
          className="btn btn-soft btn-sm"
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          aria-label="Pausar pedidos"
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          ⏸<span className="pause-long"> Pausar pedidos</span>
        </button>
      )}
      {open ? (
        <div className="pause-menu" role="group" aria-label="Pausar pedidos por">
          {PAUSE_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              className="btn btn-soft btn-sm"
              type="button"
              onClick={() => void change(minutes)}
            >
              {minutes} min
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Shell({ staff }: { staff: Staff }) {
  const toast = useToast();
  const isAdmin = staff.role === 'admin';
  const perms: string[] = staff.permissions;
  const can = (target: View) => {
    if (target === 'resumen' || target === 'pedidos') return true;
    if (target === 'equipo' || target === 'clientes' || target === 'seguridad') return isAdmin;
    if (target === 'ajustes') return isAdmin || perms.includes('sitio');
    if (target === 'bienvenida') return isAdmin || perms.includes('eventos') || perms.includes('promos');
    return isAdmin || perms.includes(target);
  };
  const fromHash = (): View | null => {
    const hash = location.hash.slice(1) as View;
    return hash in TITLES && can(hash) ? hash : null;
  };
  const [view, setView] = useState<View>(() => {
    return fromHash() ?? 'resumen';
  });
  const [groups, setGroups] = useState(readGroups);
  const alerted = useRef<Set<string> | null>(null);
  const [account, setAccount] = useState(false);
  const [orders, setOrders] = useState<PanelOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [sideOpen, setSideOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [bell, setBell] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const known = useRef<Set<string> | null>(null);
  const [business, setBusiness] = useState<{ phone?: string; address?: string }>({});
  const [newVersion, setNewVersion] = useState(false);

  // Insumo bajo (D46): mismo aviso que un pedido nuevo, una vez por insumo y sesión. La primera
  // carga solo registra los que ya estaban bajos para no sonar al entrar.
  const alertSupplies = useCallback(
    (sum: Summary) => {
      const low = sum.low_supplies ?? [];
      if (alerted.current) {
        const added = low.filter((name) => !alerted.current?.has(name));
        if (added.length) {
          beep();
          for (const name of added) {
            toast(`⚠️ Insumo por agotarse: ${name}`);
            notify('Insumo por agotarse', name, `insumo-${name}`);
          }
        }
      }
      alerted.current = new Set([...(alerted.current ?? []), ...low]);
    },
    [toast],
  );

  const reload = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([loadOrders(), loadSummary()]);
      if (known.current) {
        const arrived = list.filter((order) => order.status === 'nuevo' && !known.current?.has(order.id));
        if (arrived.length) {
          beep();
          setFresh((current) => new Set([...current, ...arrived.map((order) => order.id)]));
          for (const order of arrived) {
            toast(
              `🔥 Pedido nuevo ${order.code} por ${CHANNEL_LABEL[order.channel]} · ${money(order.total)}`,
            );
            notify(
              `Pedido nuevo ${order.code}`,
              order.order_items.map((item) => `${item.qty}× ${item.name}`).join(', '),
              order.code,
            );
          }
        }
      }
      alertSupplies(sum);
      known.current = new Set(list.map((order) => order.id));
      setOrders(list);
      setSummary(sum);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No pudimos actualizar.');
    }
  }, [toast, alertSupplies]);

  // Revisión ligera de insumos cada 2 min con la pestaña visible (el inventario también baja por
  // ajustes, no solo por pedidos). Reusa el mismo registro por sesión: no repite sonidos.
  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      loadSummary()
        .then((sum) => {
          alertSupplies(sum);
          setSummary(sum);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(check, 120_000);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [alertSupplies]);

  // Datos del negocio para el recibo (D54): una sola lectura de los ajustes. El módulo del editor
  // se pide aparte para no engordar la carga inicial del panel.
  useEffect(() => {
    let alive = true;
    void import('./editor')
      .then(({ loadSettings }) => loadSettings(staff.restaurant_id))
      .then((settings) => {
        if (!alive) return;
        const phone = settings.whatsapp ? formatPhone(settings.whatsapp.replace(/^57(?=\d{10}$)/, '')) : '';
        const address = settings.store_address?.trim() ?? '';
        setBusiness({ ...(phone ? { phone } : {}), ...(address ? { address } : {}) });
      })
      .catch(() => undefined); // sin datos el recibo sale solo con el nombre
    return () => {
      alive = false;
    };
  }, [staff.restaurant_id]);

  // Tras un despliegue los trozos viejos ya no existen: se sugiere recargar.
  useEffect(() => {
    const onPreloadError = () => setNewVersion(true);
    addEventListener('vite:preloadError', onPreloadError);
    return () => removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  // D67: sondeo de /version.json cada 10 min y al volver a la pestaña. Un fallo de red no avisa nada.
  useEffect(() => {
    const mine = import.meta.env.PUBLIC_BUILD_ID as string | undefined;
    let last = 0;
    let stopped = false;
    const check = () => {
      if (stopped || document.hidden || Date.now() - last < 60_000) return;
      last = Date.now();
      fetch('/version.json', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: unknown) => {
          if (!stopped && isNewVersion(mine, json)) setNewVersion(true);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(check, 10 * 60_000);
    const onVisible = () => check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    void reload();
    const stop = watchOrders(staff.restaurant_id, () => void reload());
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stop();
      clearInterval(clock);
    };
  }, [reload, staff.restaurant_id]);

  useEffect(() => {
    if (location.hash.slice(1) !== view) location.hash = view;
  }, [view]);

  // Enlaces con #vista (p. ej. desde el Resumen) y botones atrás/adelante.
  useEffect(() => {
    const onHash = () => {
      const next = fromHash();
      if (next) setView(next);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff]);

  // El grupo de la vista actual se abre solo (ajuste durante el render al cambiar de vista).
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    const group = GROUPS.find((item) => item.items.some((entry) => entry.view === view));
    if (group && !groups[group.id]) setGroups({ ...groups, [group.id]: true });
  }
  // Y al entrar directo a una vista de un grupo.
  const [seeded, setSeeded] = useState(false);
  if (!seeded) {
    setSeeded(true);
    const group = GROUPS.find((item) => item.items.some((entry) => entry.view === view));
    if (group && !groups[group.id]) setGroups({ ...groups, [group.id]: true });
  }

  const toggleGroup = (id: GroupId) =>
    setGroups((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });

  const go = (next: View) => {
    setView(next);
    setSideOpen(false);
  };
  const waiting = orders.filter((order) => order.status === 'nuevo').length;

  async function askBell() {
    if (!('Notification' in window)) return toast('Este navegador no permite avisos.');
    if (Notification.permission === 'default') await Notification.requestPermission();
    setBell(Notification.permission);
    if (Notification.permission === 'denied')
      toast('Los avisos están bloqueados; actívalos en la configuración del sitio.');
    beep();
  }

  return (
    <div className="app">
      {sideOpen ? <div className="side-backdrop" onClick={() => setSideOpen(false)} /> : null}
      <aside className={`side ${sideOpen ? 'is-open' : ''}`}>
        <a className="logo" href="/" target="_blank" rel="noopener" title="Ver la página">
          <b>{staff.restaurant}</b>
        </a>
        <nav className="side-nav" aria-label="Panel">
          <button
            type="button"
            aria-current={view === 'resumen' ? 'page' : undefined}
            onClick={() => go('resumen')}
          >
            <span className="ico">◎</span>Resumen
          </button>
          <button
            type="button"
            aria-current={view === 'pedidos' ? 'page' : undefined}
            onClick={() => go('pedidos')}
          >
            <span className="ico">🔥</span>Pedidos
            {waiting ? <span className="badge">{waiting}</span> : null}
          </button>
          {FIXED.filter((item) => can(item.view)).map((item) => (
            <button
              type="button"
              key={item.view}
              aria-current={view === item.view ? 'page' : undefined}
              onPointerEnter={() => warm(item.view)}
              onPointerDown={() => warm(item.view)}
              onFocus={() => warm(item.view)}
              onClick={() => go(item.view)}
            >
              <span className="ico">{item.icon}</span>
              {TITLES[item.view]}
            </button>
          ))}
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => can(item.view));
            if (!items.length) return null;
            return (
              <div key={group.id}>
                <button
                  type="button"
                  className="nav-group-head"
                  aria-expanded={groups[group.id]}
                  aria-controls={`nav-${group.id}`}
                  onClick={() => toggleGroup(group.id)}
                >
                  {group.label}
                  <span className="chev" aria-hidden="true">
                    ›
                  </span>
                </button>
                <div className="nav-group" id={`nav-${group.id}`} hidden={!groups[group.id]}>
                  {items.map((item) => (
                    <button
                      type="button"
                      key={item.view}
                      aria-current={view === item.view ? 'page' : undefined}
                      onPointerEnter={() => warm(item.view)}
                      onPointerDown={() => warm(item.view)}
                      onFocus={() => warm(item.view)}
                      onClick={() => go(item.view)}
                    >
                      <span className="ico">{item.icon}</span>
                      {TITLES[item.view]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="avatar">{staff.name.charAt(0)}</span>
            <div>
              <b>{staff.name}</b>
              <small>
                {isAdmin
                  ? 'Administrador · 2 pasos activos'
                  : staff.permissions.length
                    ? 'Operador · 2 pasos activos'
                    : 'Operador de pedidos'}
              </small>
            </div>
          </div>
          <button className="btn btn-soft btn-sm btn-block" type="button" onClick={() => setAccount(true)}>
            Mi cuenta
          </button>
          <button className="btn btn-soft btn-sm btn-block" type="button" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-btn"
            id="side-toggle"
            type="button"
            aria-label="Menú"
            onClick={() => setSideOpen(true)}
          >
            ☰
          </button>
          <h1>{TITLES[view]}</h1>
          <div className="topbar-actions">
            <PauseControl restaurantId={staff.restaurant_id} />
            <span className="live">
              <span className="dot" /> En vivo
            </span>
            <button
              className="btn btn-soft btn-sm"
              type="button"
              aria-pressed={bell === 'granted'}
              onClick={() => void askBell()}
            >
              {bell === 'granted' ? '🔔 Avisos activos' : '🔕 Activar avisos'}
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setManual(true)}>
              ＋ Pedido manual
            </button>
          </div>
        </header>
        <main className="view">
          {newVersion ? (
            <div className="note note-warn new-version" role="alert">
              <span>Hay una versión nueva del panel. Recárgalo para seguir sin errores.</span>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => location.reload()}>
                Recargar el panel
              </button>
            </div>
          ) : null}
          {view === 'resumen' ? (
            <Resumen
              summary={summary}
              orders={orders}
              isAdmin={can('ventas')}
              now={now}
              onOpenBoard={() => go('pedidos')}
            />
          ) : view === 'pedidos' ? (
            <Pedidos
              isAdmin={isAdmin}
              orders={orders}
              fresh={fresh}
              now={now}
              restaurant={staff.restaurant}
              {...(business.phone ? { restaurantPhone: business.phone } : {})}
              {...(business.address ? { restaurantAddress: business.address } : {})}
              onChanged={() => void reload()}
            />
          ) : (
            (Object.keys(VIEWS) as Array<keyof typeof VIEWS>).map((key) => {
              if (key === 'cuenta' || view !== key || !can(key)) return null;
              const id = staff.restaurant_id;
              return (
                <ViewBoundary key={key} def={VIEWS[key]} fallback={<p className="muted center">Cargando…</p>}>
                  {(View) =>
                    key === 'ventas' || key === 'whatsapp' ? (
                      <View restaurant={staff.restaurant} restaurantId={id} />
                    ) : key === 'equipo' || key === 'clientes' || key === 'seguridad' ? (
                      <View />
                    ) : (
                      <View restaurantId={id} />
                    )
                  }
                </ViewBoundary>
              );
            })
          )}
        </main>
      </div>
      {account ? (
        <ViewBoundary def={VIEWS.cuenta} fallback={null}>
          {(View) => <View onClose={() => setAccount(false)} />}
        </ViewBoundary>
      ) : null}
      {manual ? (
        <ManualOrder
          restaurantId={staff.restaurant_id}
          onClose={() => setManual(false)}
          onCreated={() => void reload()}
        />
      ) : null}
    </div>
  );
}
