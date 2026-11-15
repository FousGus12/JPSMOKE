// Panel del negocio (F5): ingreso con dos pasos, resumen y tablero de pedidos en vivo.
// Las demás pantallas (ventas, carta, promociones, eventos, editor, clientes, ajustes) llegan en F6–F8.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { formatCop as money } from '../core/money';
import { CHANNEL_LABEL } from '../core/orders';
import { currentStep, onAuthChange, signOut, type AuthStep, type Staff } from './auth';
import { loadOrders, loadSummary, watchOrders, type PanelOrder, type Summary } from './data';
import { ChangeTemp, Credentials, Enroll, Verify } from './Login';
import { ManualOrder } from './ManualOrder';
import { Pedidos } from './Pedidos';
import { Carta } from './Carta';
import { EditarPagina } from './EditarPagina';
import { Promociones } from './Promociones';
import { Eventos } from './Eventos';
import { Ventas } from './Ventas';
import { Inventario } from './Inventario';
import { WhatsApp } from './WhatsApp';
import { Resumen } from './Resumen';
import { Equipo, MiCuenta } from './Equipo';
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
  | 'equipo';
// Apartados del menú (D38): la base decide; el menú solo muestra lo que la persona puede usar.
const NAV: Array<{ view: View; icon: string; group?: string }> = [
  { view: 'ventas', icon: '📈' },
  { view: 'inventario', icon: '📦' },
  { view: 'whatsapp', icon: '💬' },
  { view: 'carta', icon: '🍔', group: 'Contenido' },
  { view: 'sitio', icon: '✏️', group: 'Contenido' },
  { view: 'promos', icon: '🎟️', group: 'Contenido' },
  { view: 'eventos', icon: '📣', group: 'Contenido' },
  { view: 'equipo', icon: '👥', group: 'Administración' },
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
  equipo: 'Equipo y permisos',
};
const SOON: Array<[string, string]> = [
  ['👤', 'Clientes'],
  ['⚙️', 'Ajustes y seguridad'],
];

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

function Shell({ staff }: { staff: Staff }) {
  const toast = useToast();
  const isAdmin = staff.role === 'admin';
  const can = (target: View) =>
    target === 'resumen' ||
    target === 'pedidos' ||
    isAdmin ||
    (target !== 'equipo' && staff.permissions.includes(target));
  const [view, setView] = useState<View>(() => {
    const hash = location.hash.slice(1) as View;
    return hash in TITLES && can(hash) ? hash : 'resumen';
  });
  const [account, setAccount] = useState(false);
  const [orders, setOrders] = useState<PanelOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [sideOpen, setSideOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [bell, setBell] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const known = useRef<Set<string> | null>(null);

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
      known.current = new Set(list.map((order) => order.id));
      setOrders(list);
      setSummary(sum);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No pudimos actualizar.');
    }
  }, [toast]);

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
    location.hash = view;
  }, [view]);

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
          {NAV.filter((item) => can(item.view)).map((item, index, list) => (
            <Fragment key={item.view}>
              {item.group && item.group !== list[index - 1]?.group ? (
                <div className="sep">{item.group}</div>
              ) : null}
              <button
                type="button"
                aria-current={view === item.view ? 'page' : undefined}
                onClick={() => go(item.view)}
              >
                <span className="ico">{item.icon}</span>
                {TITLES[item.view]}
              </button>
            </Fragment>
          ))}
          {isAdmin ? (
            <>
              <div className="sep">Próximas fases</div>
              {SOON.map(([icon, label]) => (
                <button type="button" disabled key={label}>
                  <span className="ico">{icon}</span>
                  {label}
                  <span className="nav-soon">Pronto</span>
                </button>
              ))}
            </>
          ) : null}
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
              orders={orders}
              fresh={fresh}
              now={now}
              restaurant={staff.restaurant}
              onChanged={() => void reload()}
            />
          ) : view === 'ventas' && can('ventas') ? (
            <Ventas restaurant={staff.restaurant} />
          ) : view === 'inventario' && can('inventario') ? (
            <Inventario restaurantId={staff.restaurant_id} />
          ) : view === 'whatsapp' && can('whatsapp') ? (
            <WhatsApp restaurantId={staff.restaurant_id} restaurant={staff.restaurant} />
          ) : view === 'carta' && can('carta') ? (
            <Carta restaurantId={staff.restaurant_id} />
          ) : view === 'sitio' && can('sitio') ? (
            <EditarPagina restaurantId={staff.restaurant_id} />
          ) : view === 'promos' && can('promos') ? (
            <Promociones restaurantId={staff.restaurant_id} />
          ) : view === 'eventos' && can('eventos') ? (
            <Eventos restaurantId={staff.restaurant_id} />
          ) : view === 'equipo' && can('equipo') ? (
            <Equipo />
          ) : null}
        </main>
      </div>
      {account ? <MiCuenta onClose={() => setAccount(false)} /> : null}
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
