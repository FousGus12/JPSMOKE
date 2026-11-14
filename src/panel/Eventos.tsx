import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { formatPhone } from '../core/orders';
import { photoUrl, uploadPhoto } from './editor';
import {
  deleteEvent,
  loadCoupons,
  loadEvents,
  loadIntroMode,
  loadQuotes,
  saveEvent,
  saveIntroMode,
  setIntroEvent,
  setQuoteStatus,
  type EditCoupon,
  type EditEvent,
  type Quote,
} from './promos';
import { Modal, useToast } from './ui';

type Mode = 'completa' | 'aviso' | 'ninguna';
const MODES: Array<[Mode, string, string]> = [
  ['completa', 'Pantalla completa', 'Foto grande del evento con barra de carga. Máximo impacto.'],
  ['aviso', 'Aviso centrado', 'Ventana pequeña sobre la página; si el evento capta datos, entrega un cupón.'],
  ['ninguna', 'Nada', 'La página abre directo.'],
];
const LINKS: Array<[string, string]> = [
  ['#carta', 'Carta'],
  ['#promos', 'Promociones'],
  ['#tour', 'Eventos privados'],
  ['#cobertura', 'Domicilios'],
];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Bogota',
  });

/** Eventos y banners (F7): bienvenida, franja y sección; y solicitudes de cotización (JP on Tour). */
export function Eventos({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [events, setEvents] = useState<EditEvent[]>([]);
  const [coupons, setCoupons] = useState<EditCoupon[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [mode, setMode] = useState<Mode>('completa');
  const [editing, setEditing] = useState<EditEvent | 'nuevo' | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([
        loadEvents(restaurantId),
        loadCoupons(restaurantId),
        loadQuotes(restaurantId),
        loadIntroMode(restaurantId),
      ])
        .then(([list, couponList, quoteList, intro]) => {
          setEvents(list);
          setCoupons(couponList);
          setQuotes(quoteList);
          setMode(intro);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: Promise<void>, message: string) => {
    try {
      await work;
      toast(message);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
    void reload();
  };
  const toggle = (event: EditEvent, change: Partial<EditEvent>, message: string) => {
    setEvents((list) => list.map((item) => (item.id === event.id ? { ...item, ...change } : item)));
    void run(saveEvent(restaurantId, { id: event.id, ...change }), message);
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Al abrir la página por primera vez</h2>
            <p>
              Se muestra una vez por visita con el evento marcado como "Bienvenida". Sale en la página al
              publicar.
            </p>
          </div>
        </div>
        <div className="modes" role="radiogroup" aria-label="Bienvenida">
          {MODES.map(([key, label, detail]) => (
            <label className={`mode ${mode === key ? 'is-on' : ''}`} key={key}>
              <input
                type="radio"
                name="intro-mode"
                value={key}
                checked={mode === key}
                onChange={() => {
                  setMode(key);
                  void run(saveIntroMode(restaurantId, key), `Bienvenida: ${label}`);
                }}
              />
              <b>{label}</b>
              <small>{detail}</small>
              {key !== 'ninguna' ? (
                <a href={`/?intro=${key}`} target="_blank" rel="noopener">
                  Ver ejemplo ↗
                </a>
              ) : null}
            </label>
          ))}
        </div>
      </section>

      <div className="toolbar">
        <div className="note grow">
          Cada evento puede salir en tres lugares: <b>bienvenida</b>, <b>franja</b> (cinta bajo el inicio) y{' '}
          <b>sección</b> de eventos. Se muestra entre sus fechas. Los cambios salen al tocar <b>Publicar</b>{' '}
          en Editar página.
        </div>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing('nuevo')}>
          ＋ Evento
        </button>
      </div>
      <div className="grid-2">
        {events.map((event) => {
          const live = event.active && event.starts_on <= today() && event.ends_on >= today();
          return (
            <article className="ev-card" key={event.id} data-testid={`evento-${event.title}`}>
              {event.image_path ? (
                <img src={photoUrl(event.image_path) ?? ''} alt="" />
              ) : (
                <span className="thumb" />
              )}
              <div>
                <span className={`st ${live ? 'st-entregado' : ''}`}>
                  {live ? 'En la página' : event.active ? 'Fuera de fechas' : 'Pausado'}
                </span>
                <h3 className="ev-title">{event.title}</h3>
                <p>{event.body}</p>
                <div className="chips">
                  <label className="chip-check">
                    <input
                      type="checkbox"
                      checked={event.show_intro}
                      onChange={(change) => {
                        const on = change.target.checked;
                        // Solo una bienvenida: se refleja al instante y la base lo confirma.
                        setEvents((list) =>
                          list.map((item) => ({ ...item, show_intro: on && item.id === event.id })),
                        );
                        void run(
                          setIntroEvent(on ? event.id : null),
                          on ? 'Es la bienvenida' : 'Sin bienvenida',
                        );
                      }}
                    />{' '}
                    Bienvenida
                  </label>
                  <label className="chip-check">
                    <input
                      type="checkbox"
                      checked={event.show_strip}
                      onChange={(change) =>
                        toggle(event, { show_strip: change.target.checked }, 'Franja actualizada')
                      }
                    />{' '}
                    Franja
                  </label>
                  <label className="chip-check">
                    <input
                      type="checkbox"
                      checked={event.show_section}
                      onChange={(change) =>
                        toggle(event, { show_section: change.target.checked }, 'Sección actualizada')
                      }
                    />{' '}
                    Sección
                  </label>
                  <label className="chip-check">
                    <input
                      type="checkbox"
                      checked={event.captures_leads}
                      onChange={(change) =>
                        toggle(
                          event,
                          {
                            captures_leads: change.target.checked,
                            coupon_id: event.coupon_id ?? coupons.find((item) => item.active)?.id ?? null,
                          },
                          change.target.checked ? 'Capta nombre y celular' : 'Ya no capta datos',
                        )
                      }
                    />{' '}
                    Capta datos (cupón)
                  </label>
                  <label className="chip-check">
                    <input
                      type="checkbox"
                      checked={event.active}
                      onChange={(change) =>
                        toggle(event, { active: change.target.checked }, 'Evento actualizado')
                      }
                    />{' '}
                    Activo
                  </label>
                </div>
                {event.captures_leads ? (
                  <div className="field">
                    <label htmlFor={`evc-${event.id}`}>Cupón que entrega</label>
                    <select
                      className="select"
                      id={`evc-${event.id}`}
                      value={event.coupon_id ?? ''}
                      onChange={(change) =>
                        toggle(
                          event,
                          { coupon_id: change.target.value || null },
                          'Cupón del evento actualizado',
                        )
                      }
                    >
                      <option value="">Elige un cupón</option>
                      {coupons.map((coupon) => (
                        <option key={coupon.id} value={coupon.id}>
                          {coupon.code} · {coupon.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <p className="muted small">
                  {shortDate(event.starts_on)} → {shortDate(event.ends_on)}
                </p>
                <button className="btn btn-soft btn-sm" type="button" onClick={() => setEditing(event)}>
                  Editar
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Solicitudes de cotización</h2>
            <p>Llegan desde "Cotizar mi evento" en JP on Tour</p>
          </div>
          <span className="muted">{quotes.filter((quote) => quote.status === 'nueva').length} nuevas</span>
        </div>
        {quotes.length === 0 ? <p className="muted">Aún no hay solicitudes.</p> : null}
        <div className="rows">
          {quotes.map((quote) => (
            <div className="row" key={quote.id} data-testid={`cotizacion-${quote.name}`}>
              <div>
                <b>
                  {quote.kind} · {quote.name}
                </b>
                <small>
                  {formatPhone(quote.phone)} ·{' '}
                  {quote.event_date ? shortDate(quote.event_date) : 'fecha por definir'}
                  {quote.guests ? ` · ${quote.guests} personas` : ''}
                </small>
                <p className="quote-msg">{quote.message}</p>
              </div>
              <div className="right">
                <a
                  className="btn btn-soft btn-sm"
                  href={`https://wa.me/57${quote.phone}`}
                  target="_blank"
                  rel="noopener"
                >
                  WhatsApp
                </a>
                <select
                  className="select"
                  aria-label={`Estado de la cotización de ${quote.name}`}
                  value={quote.status}
                  onChange={(change) =>
                    void run(
                      setQuoteStatus(quote.id, change.target.value as Quote['status']),
                      'Estado actualizado',
                    )
                  }
                >
                  <option value="nueva">Nueva</option>
                  <option value="contactada">Contactada</option>
                  <option value="cerrada">Cerrada</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing ? (
        <EventForm
          restaurantId={restaurantId}
          event={editing === 'nuevo' ? null : editing}
          position={events.length}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </>
  );
}

function EventForm({
  restaurantId,
  event,
  position,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  event: EditEvent | null;
  position: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: event?.title ?? '',
    kicker: event?.kicker ?? '',
    body: event?.body ?? '',
    cta_label: event?.cta_label ?? 'Pedir ahora',
    cta_href: event?.cta_href ?? '#carta',
    starts_on: event?.starts_on ?? today(),
    ends_on: event?.ends_on ?? today(),
  });
  const [image, setImage] = useState<string | null>(event?.image_path ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (change: { target: { value: string } }) =>
    setForm({ ...form, [key]: change.target.value });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      setImage(await uploadPhoto(restaurantId, file));
      toast('Imagen subida');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo subir la imagen.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(change: SyntheticEvent) {
    change.preventDefault();
    if (form.title.trim().length < 3) return setError('El título es obligatorio.');
    if (form.ends_on < form.starts_on) return setError('La fecha de fin no puede ser antes del inicio.');
    setBusy(true);
    setError('');
    try {
      await saveEvent(restaurantId, {
        ...(event ? { id: event.id } : { position, show_section: true, active: true }),
        title: form.title.trim(),
        kicker: form.kicker.trim(),
        body: form.body.trim(),
        cta_label: form.cta_label.trim() || 'Ver',
        cta_href: form.cta_href,
        starts_on: form.starts_on,
        ends_on: form.ends_on,
        image_path: image,
      });
      toast('Evento guardado');
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !confirm(`¿Borrar el evento "${event.title}"?`)) return;
    try {
      await deleteEvent(event.id);
      toast('Evento borrado');
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo borrar.');
    }
  }

  return (
    <Modal title={event ? `Editar · ${event.title}` : 'Nuevo evento o banner'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field span-2">
            <label htmlFor="ef-title">Título</label>
            <input
              className="input"
              id="ef-title"
              maxLength={60}
              value={form.title}
              onChange={set('title')}
              placeholder="Noche de costillas"
            />
          </div>
          <div className="field">
            <label htmlFor="ef-kicker">Fecha visible</label>
            <input
              className="input"
              id="ef-kicker"
              maxLength={40}
              value={form.kicker}
              onChange={set('kicker')}
              placeholder="Viernes 21 de noviembre"
            />
          </div>
          <div className="field">
            <label htmlFor="ef-cta">Botón</label>
            <input
              className="input"
              id="ef-cta"
              maxLength={30}
              value={form.cta_label}
              onChange={set('cta_label')}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="ef-body">Texto</label>
            <textarea
              className="textarea"
              id="ef-body"
              maxLength={240}
              value={form.body}
              onChange={set('body')}
            />
          </div>
          <div className="field">
            <label htmlFor="ef-href">El botón lleva a</label>
            <select className="select" id="ef-href" value={form.cta_href} onChange={set('cta_href')}>
              {LINKS.map(([href, label]) => (
                <option key={href} value={href}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ef-photo">Imagen</label>
            <input
              id="ef-photo"
              type="file"
              accept="image/*"
              onChange={(change) => void onPhoto(change.target.files?.[0])}
            />
          </div>
          <div className="field">
            <label htmlFor="ef-from">Desde</label>
            <input
              className="input"
              id="ef-from"
              type="date"
              value={form.starts_on}
              onChange={set('starts_on')}
            />
          </div>
          <div className="field">
            <label htmlFor="ef-to">Hasta</label>
            <input className="input" id="ef-to" type="date" value={form.ends_on} onChange={set('ends_on')} />
          </div>
        </div>
        {image ? (
          <img className="thumb thumb-lg" src={photoUrl(image) ?? ''} alt="Imagen del evento" />
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar evento'}
          </button>
          {event ? (
            <button className="btn btn-soft" type="button" onClick={() => void remove()}>
              Borrar
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
