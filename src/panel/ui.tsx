// Piezas compartidas del panel: avisos, ventana lateral, modal, sonido y notificación del navegador.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** Aviso del panel. `toast: false` solo lo lee el lector de pantalla (sin aviso visible). */
type Announce = (message: string, options?: { toast?: boolean }) => void;
const ToastContext = createContext<Announce>(() => undefined);
/** Avisos visibles; cada uno se anuncia una sola vez por la región única del panel. */
export const useToast = () => useContext(ToastContext);
/** Igual que useToast; el nombre aclara que también sirve para anuncios solo para lectores de pantalla. */
export const useAnnounce = useToast;

/**
 * Avisos del panel con UNA sola región aria-live (la de los toasts): cada aviso es un nodo nuevo y se lee
 * una vez, también dos seguidos o iguales. Los anuncios sin toast van ahí mismo, ocultos a la vista.
 * Antes el tablero tenía otra región (.board-live) y cada cambio se oía dos veces.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; message: string; toast: boolean }>>([]);
  const next = useRef(0);
  const push = useCallback<Announce>((message, options) => {
    next.current += 1;
    const id = next.current;
    setItems((list) => [...list, { id, message, toast: options?.toast !== false }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite" data-testid="panel-live">
        {items.map((item) => (
          <div className={item.toast ? 'toast' : 'sr-only'} key={item.id}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    addEventListener('keydown', handler);
    return () => removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer-r" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button ref={closeRef} className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Dos pitidos cortos para un pedido nuevo (necesita que la persona haya tocado la página una vez). */
export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.16);
    });
  } catch {
    /* sin audio */
  }
}

/** Aviso del sistema aunque el panel esté en otra pestaña (en el celular instalado: push, P9). */
export function notify(title: string, body: string, tag: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification(title, { body, tag, icon: '/favicon.svg' });
  } catch {
    /* sin notificaciones */
  }
}
