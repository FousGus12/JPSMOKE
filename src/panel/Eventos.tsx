import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { formatPhone } from '../core/orders';
import {
  LEAD_COPY_LIMIT,
  LEAD_DEFAULTS,
  leadCopyLength,
  loadLeadCopy,
  photoUrl,
  saveLeadCopy,
  uploadPhoto,
  type LeadCopy,
} from './editor';
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
  ['aviso', 'Aviso pequeño', 'Ventana pequeña sobre la página; si el evento capta datos, entrega un cupón.'],
  ['ninguna', 'Apagada', 'La gente entra directo a la página.'],
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

/** Día siguiente (YYYY-MM-DD) sin pasar por zonas horarias. */
const nextDay = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Bienvenida de la página: modo global, evento que se usa, vista previa y avisos. */
export function Bienvenida({
  restaurantId,
  compact = false,
  version = 0,
  onChange,
}: {
  restaurantId: string;
  compact?: boolean;
  /** Súbelo para recargar cuando otro componente cambie eventos. */
  version?: number;
  onChange?: () => void;
}) {
  const toast = useToast();
  const [events, setEvents] = useState<EditEvent[]>([]);
  const [coupons, setCoupons] = useState<EditCoupon[]>([]);
  const [mode, setMode] = useState<Mode>('completa');
  const [editing, setEditing] = useState<EditEvent | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [leadLoaded, setLeadLoaded] = useState<{ id: string; copy: LeadCopy } | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([loadEvents(restaurantId), loadCoupons(restaurantId), loadIntroMode(restaurantId)])
        .then(([list, couponList, intro]) => {
          setEvents(list);
          setCoupons(couponList);
          setMode(intro);
          setLoaded(true);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload, version]);

  const run = async (work: Promise<void>, message: string) => {
    try {
      await work;
      toast(message);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
    await reload();
    onChange?.();
  };
  const changeMode = (key: Mode) => {
    setMode(key);
    const label = MODES.find(([value]) => value === key)?.[1] ?? '';
    void run(
      saveIntroMode(restaurantId, key),
      key === 'ninguna' ? 'Bienvenida apagada' : `Bienvenida: ${label}`,
    );
  };

  const intro = events.find((event) => event.show_intro) ?? null;
  const coupon = intro?.captures_leads ? coupons.find((item) => item.id === intro.coupon_id) : undefined;
  const expired = intro ? intro.ends_on < today() : false;
  const notYet = intro ? intro.starts_on > today() : false;
  const off = mode === 'ninguna';
  const introId = intro?.captures_leads ? intro.id : null;
  const introEdits = editing ? 1 : 0;
  useEffect(() => {
    if (!introId) return;
    let alive = true;
    loadLeadCopy(introId)
      .then((copy) => alive && setLeadLoaded({ id: introId, copy }))
      .catch(() => alive && setLeadLoaded({ id: introId, copy: {} }));
    return () => {
      alive = false;
    };
  }, [introId, introEdits]);
  const leadCopy: LeadCopy = introId && leadLoaded?.id === introId ? leadLoaded.copy : {};

  return (
    <section className="card bienvenida" data-testid="bienvenida">
      <div className="card-head">
        <div>
          <h2>Bienvenida</h2>
          <p>
            {off
              ? 'Apagada: la gente entra directo a la página.'
              : 'Se muestra una vez por visita al abrir la página.'}
          </p>
        </div>
        <button
          className={`btn btn-sm ${off ? 'btn-primary' : 'btn-soft'}`}
          type="button"
          onClick={() => changeMode(off ? 'completa' : 'ninguna')}
        >
          {off ? 'Encender bienvenida' : 'Apagar bienvenida'}
        </button>
      </div>
      <div className="modes" role="radiogroup" aria-label="Modo de la bienvenida">
        {MODES.map(([key, label, detail]) => (
          <label className={`mode ${mode === key ? 'is-on' : ''}`} key={key}>
            <input
              type="radio"
              name="intro-mode"
              value={key}
              checked={mode === key}
              onChange={() => changeMode(key)}
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

      {off ? null : (
        <div className="bienvenida-ev">
          {!loaded ? null : intro ? (
            <>
              {expired ? (
                <p className="note bienvenida-warn" role="alert">
                  La bienvenida dejó de verse sola el {shortDate(nextDay(intro.ends_on))}
                  {intro.captures_leads ? ' y ya no entrega cupón' : ''}. Cambia las fechas, elige otro evento
                  o apágala.
                </p>
              ) : null}
              {notYet ? (
                <p className="note bienvenida-warn">
                  Esta bienvenida empieza a verse el {shortDate(intro.starts_on)}.
                </p>
              ) : null}
              <div className="bienvenida-info">
                <div>
                  <small className="muted">Evento que se usa</small>
                  <h3 className="ev-title">{intro.title}</h3>
                  {compact ? null : (
                    <dl className="bienvenida-data">
                      <dt>Fecha visible</dt>
                      <dd>{intro.kicker || 'Sin fecha visible'}</dd>
                      <dt>Texto</dt>
                      <dd>{intro.body || 'Sin texto'}</dd>
                      <dt>Botón</dt>
                      <dd>{intro.cta_label}</dd>
                      <dt>Cupón</dt>
                      <dd>{coupon ? `${coupon.code} · ${coupon.title}` : 'No entrega cupón'}</dd>
                      {intro.captures_leads ? (
                        <>
                          <dt>Textos del cupón</dt>
                          <dd data-testid="lead-copy-resumen">
                            {leadCopy.title || LEAD_DEFAULTS.title}
                            {Object.keys(leadCopy).length ? '' : ' (textos por defecto)'}
                          </dd>
                        </>
                      ) : null}
                      <dt>Fechas</dt>
                      <dd>
                        {shortDate(intro.starts_on)} → {shortDate(intro.ends_on)}
                      </dd>
                    </dl>
                  )}
                </div>
                <button className="btn btn-soft btn-sm" type="button" onClick={() => setEditing(intro)}>
                  Editar bienvenida
                </button>
              </div>
              {compact ? null : (
                <div className={`bienvenida-preview mode-${mode}`} aria-label="Vista previa">
                  {intro.image_path ? <img src={photoUrl(intro.image_path) ?? ''} alt="" /> : null}
                  <div>
                    {intro.kicker ? <small>{intro.kicker}</small> : null}
                    <b>{intro.title}</b>
                    {intro.body ? <p>{intro.body}</p> : null}
                    {coupon ? <span className="st">Cupón {coupon.code}</span> : null}
                    <span className="btn btn-primary btn-sm">{intro.cta_label}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="note bienvenida-warn">
              Ningún evento está marcado como bienvenida, así que la gente entra directo. Elige uno:
            </p>
          )}
          {loaded && events.length > 0 ? (
            <div className="field">
              <label htmlFor="bienvenida-ev">{intro ? 'Usar otro evento' : 'Evento de bienvenida'}</label>
              <select
                className="select"
                id="bienvenida-ev"
                value={intro?.id ?? ''}
                onChange={(change) =>
                  void run(
                    setIntroEvent(change.target.value || null),
                    change.target.value ? 'Bienvenida actualizada' : 'Sin bienvenida',
                  )
                }
              >
                <option value="">Ninguno</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="muted small">Se ve en la página al publicar (Editar página → Publicar).</p>
        </div>
      )}

      {editing ? (
        <EventForm
          restaurantId={restaurantId}
          event={editing}
          position={events.length}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void reload();
            onChange?.();
          }}
        />
      ) : null}
    </section>
  );
}

/** Eventos y banners (F7): franja y sección; la bienvenida usa el mismo componente compacto. */
export function Eventos({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [events, setEvents] = useState<EditEvent[]>([]);
  const [coupons, setCoupons] = useState<EditCoupon[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [editing, setEditing] = useState<EditEvent | 'nuevo' | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(
    () =>
      Promise.all([loadEvents(restaurantId), loadCoupons(restaurantId), loadQuotes(restaurantId)])
        .then(([list, couponList, quoteList]) => {
          setEvents(list);
          setCoupons(couponList);
          setQuotes(quoteList);
          setVersion((value) => value + 1);
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
      <Bienvenida restaurantId={restaurantId} compact version={version} onChange={() => void reload()} />

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
  const [lead, setLead] = useState<LeadCopy>({});
  const [leadReady, setLeadReady] = useState(!event?.captures_leads);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (change: { target: { value: string } }) =>
    setForm({ ...form, [key]: change.target.value });

  useEffect(() => {
    if (!event?.captures_leads) return;
    let alive = true;
    loadLeadCopy(event.id)
      .then((copy) => {
        if (!alive) return;
        setLead(copy);
        setLeadReady(true);
      })
      .catch((failure: unknown) => {
        if (alive) setError(failure instanceof Error ? failure.message : 'No pudimos cargar el cupón.');
      });
    return () => {
      alive = false;
    };
  }, [event]);
  const leadLength = leadCopyLength(lead);
  const setLeadField = (key: keyof LeadCopy) => (change: { target: { value: string } }) =>
    setLead({ ...lead, [key]: change.target.value });

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
    if (event?.captures_leads && !leadReady)
      return setError('Espera a que carguen los textos del cupón para no borrarlos.');
    if (leadLength > LEAD_COPY_LIMIT)
      return setError(`Los textos del cupón suman ${leadLength} de ${LEAD_COPY_LIMIT} caracteres.`);
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
      if (event?.captures_leads) await saveLeadCopy(event.id, lead);
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
        {event?.captures_leads ? (
          <fieldset className="lead-copy" data-testid="lead-copy">
            <legend>Textos del aviso con cupón</legend>
            <p className="muted small">
              Lo gris es el texto actual; si dejas un campo vacío se usa ese. Enter en el título hace un salto
              de línea.
            </p>
            <div className="form-2">
              <div className="field">
                <label htmlFor="lc-kicker">Antetítulo del cupón</label>
                <input
                  className="input"
                  id="lc-kicker"
                  maxLength={40}
                  placeholder={LEAD_DEFAULTS.kicker}
                  value={lead.kicker ?? ''}
                  onChange={setLeadField('kicker')}
                />
              </div>
              <div className="field">
                <label htmlFor="lc-button">Botón del cupón</label>
                <input
                  className="input"
                  id="lc-button"
                  maxLength={30}
                  placeholder={LEAD_DEFAULTS.button}
                  value={lead.button ?? ''}
                  onChange={setLeadField('button')}
                />
              </div>
              <div className="field span-2">
                <label htmlFor="lc-title">Título del cupón</label>
                <textarea
                  className="textarea"
                  id="lc-title"
                  rows={2}
                  maxLength={90}
                  placeholder={LEAD_DEFAULTS.title}
                  value={lead.title ?? ''}
                  onChange={setLeadField('title')}
                />
              </div>
              <div className="field span-2">
                <label htmlFor="lc-text">Texto del cupón</label>
                <textarea
                  className="textarea"
                  id="lc-text"
                  rows={2}
                  maxLength={240}
                  placeholder={LEAD_DEFAULTS.text}
                  value={lead.text ?? ''}
                  onChange={setLeadField('text')}
                />
              </div>
            </div>
            <small className={leadLength > LEAD_COPY_LIMIT ? 'ajustes-error' : 'muted'}>
              {leadLength} de {LEAD_COPY_LIMIT} caracteres
            </small>
          </fieldset>
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
