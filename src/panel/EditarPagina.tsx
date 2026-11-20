import { useCallback, useEffect, useState } from 'react';
import { formatCop as money } from '../core/money';
import {
  BOGOTA_LOCALITIES,
  COPY_DEFAULTS,
  COPY_MAX,
  COPY_SECTIONS,
  cleanBlocks,
  deletePayment,
  isHttps,
  parseCoordinate,
  parseCoordinatePair,
  loadSettings,
  loadEtaPreview,
  loadZonesAndPayments,
  photoUrl,
  publishSite,
  saveSettings,
  uploadPhoto,
  upsertPayment,
  upsertZone,
  type EditPayment,
  type EditZone,
  type SectionCopy,
  type SiteBlocks,
  type SiteSettings,
} from './editor';
import { useToast } from './ui';

type Tab = 'textos' | 'secciones' | 'pedidos' | 'local';
const TABS: Array<[Tab, string]> = [
  ['textos', 'Inicio y textos'],
  ['secciones', 'Secciones'],
  ['pedidos', 'Domicilios y pagos'],
  ['local', 'Punto físico'],
];
const SECTION_LABEL: Record<string, string> = {
  arsenal: 'Arsenal pesado (destacados)',
  carta: 'Carta completa',
  promos: 'Promociones',
  eventos: 'Eventos y novedades',
  tour: 'JP on Tour (eventos privados)',
  resenas: 'Prueba social',
  cobertura: 'Domicilios',
};
const toNumber = (text: string) => Number(text.replace(/\D/g, '')) || 0;
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Bogota',
      })
    : 'nunca';

/** Editar página (F6). Lo de pedidos (zonas, pagos, mínimo, abierto/cerrado) aplica al instante; los textos, al publicar. */
export function EditarPagina({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('textos');
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coordsInvalid, setCoordsInvalid] = useState(false);
  const [etaVersion, setEtaVersion] = useState(0);

  useEffect(() => {
    loadSettings(restaurantId)
      .then((data) => {
        setSettings(data);
        setDirty(false);
      })
      .catch((failure: unknown) => toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'));
  }, [restaurantId, toast]);

  if (!settings) return <p className="muted">Cargando…</p>;
  const edit = (patch: Partial<SiteSettings>) => {
    setSettings({ ...settings, ...patch });
    setDirty(true);
  };

  async function save() {
    if (!settings) return;
    const address = settings.store_address?.trim() || null;
    const maps = settings.store_maps_url?.trim() || null;
    if (settings.store_open && !address) return toast('Escribe la dirección del local para mostrarlo.');
    if (maps && !isHttps(maps)) return toast('El enlace del mapa debe empezar por https://');
    if (coordsInvalid) return toast('Revisa las coordenadas del local antes de guardar.');
    setBusy(true);
    try {
      const {
        hero,
        sections,
        blocks,
        delivery_min,
        delivery_eta,
        eta_dynamic,
        eta_per_order_min,
        eta_max_extra_min,
        accepting_orders,
        store_open,
        store_hours,
      } = settings;
      // Campos vacíos no se guardan: la página usa el texto por defecto (D56).
      const cleanedBlocks = cleanBlocks(blocks);
      await saveSettings(restaurantId, {
        hero,
        sections,
        blocks: cleanedBlocks,
        delivery_min,
        delivery_eta,
        eta_dynamic,
        eta_per_order_min,
        eta_max_extra_min,
        accepting_orders,
        store_open,
        store_address: address,
        store_maps_url: maps,
        store_lat: settings.store_lat,
        store_lng: settings.store_lng,
        store_hours: store_hours.filter(([days, time]) => days.trim() || time.trim()),
        // Recoger exige local abierto y dirección (la base también lo exige).
        pickup_enabled: settings.pickup_enabled && store_open && Boolean(address),
      });
      setSettings((current) => (current ? { ...current, blocks: cleanedBlocks } : current));
      setEtaVersion((value) => value + 1);
      setDirty(false);
      toast('Cambios guardados. Toca Publicar para verlos en la página.');
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (dirty) await save();
    setBusy(true);
    const result = await publishSite();
    setBusy(false);
    if (result.ok) {
      setSettings((current) => (current ? { ...current, published_at: result.published_at } : current));
      toast('Publicado. La página se actualiza en ~1 minuto ✔');
    } else toast(result.message);
  }

  const setBlocks = (patch: Partial<SiteBlocks>) => edit({ blocks: { ...settings.blocks, ...patch } });
  const promo = settings.blocks.promo ?? {};
  const tour = settings.blocks.tour ?? {};
  const cards = tour.cards ?? [
    { title: '', text: '' },
    { title: '', text: '' },
  ];
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Secciones del editor">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="grow muted">Última publicación: {when(settings.published_at)}</span>
        <button
          className="btn btn-soft btn-sm"
          type="button"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          Guardar
        </button>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={busy}
          onClick={() => void publish()}
        >
          Publicar
        </button>
      </div>

      {tab === 'textos' ? (
        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Inicio</h2>
                <p>Lo primero que se ve</p>
              </div>
            </div>
            <div className="form">
              <Text
                label="Titular"
                value={settings.hero.title}
                max={30}
                onChange={(title) => edit({ hero: { ...settings.hero, title } })}
              />
              <Text
                label="Antetítulo"
                value={settings.hero.kicker}
                max={60}
                onChange={(kicker) => edit({ hero: { ...settings.hero, kicker } })}
              />
              <Text
                label="Texto"
                area
                value={settings.hero.text}
                max={200}
                onChange={(text) => edit({ hero: { ...settings.hero, text } })}
              />
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Promo destacada</h2>
                <p>El bloque grande de la sección Promociones</p>
              </div>
              <label className="chip-check">
                <input
                  type="checkbox"
                  checked={promo.visible !== false}
                  onChange={(event) =>
                    edit({
                      blocks: { ...settings.blocks, promo: { ...promo, visible: event.target.checked } },
                    })
                  }
                />{' '}
                Visible
              </label>
            </div>
            <div className="form">
              <Text
                label="Etiqueta"
                value={promo.tag}
                max={30}
                onChange={(tag) => edit({ blocks: { ...settings.blocks, promo: { ...promo, tag } } })}
              />
              <Text
                label="Título de la promo"
                value={promo.title}
                max={60}
                onChange={(title) => edit({ blocks: { ...settings.blocks, promo: { ...promo, title } } })}
              />
              <Text
                label="Texto de la promo"
                area
                value={promo.text}
                max={200}
                onChange={(text) => edit({ blocks: { ...settings.blocks, promo: { ...promo, text } } })}
              />
              <ImageField
                label="Imagen de la promo"
                restaurantId={restaurantId}
                value={promo.image}
                fallback="sitio/brasas.webp"
                onChange={(image) =>
                  edit({ blocks: { ...settings.blocks, promo: { ...promo, image: image ?? undefined } } })
                }
              />
              <div className="form-2">
                <Text
                  label="Botón"
                  value={promo.cta}
                  max={30}
                  onChange={(cta) => edit({ blocks: { ...settings.blocks, promo: { ...promo, cta } } })}
                />
                <Text
                  label="Cupón que aplica"
                  value={promo.coupon}
                  max={20}
                  onChange={(coupon) =>
                    edit({
                      blocks: { ...settings.blocks, promo: { ...promo, coupon: coupon.toUpperCase() } },
                    })
                  }
                />
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>JP on Tour</h2>
                <p>Eventos privados y catering</p>
              </div>
            </div>
            <div className="form">
              <Text
                label="Título de eventos"
                value={tour.title}
                max={40}
                onChange={(title) => edit({ blocks: { ...settings.blocks, tour: { ...tour, title } } })}
              />
              <Text
                label="Texto de eventos"
                area
                value={tour.text}
                max={200}
                onChange={(text) => edit({ blocks: { ...settings.blocks, tour: { ...tour, text } } })}
              />
              <ImageField
                label="Imagen de eventos"
                restaurantId={restaurantId}
                value={tour.image}
                fallback="sitio/costillas-parrilla.webp"
                onChange={(image) =>
                  edit({ blocks: { ...settings.blocks, tour: { ...tour, image: image ?? undefined } } })
                }
              />
              {cards.map((card, i) => (
                <div className="form-2" key={i}>
                  <Text
                    label={`Tarjeta ${i + 1}`}
                    value={card.title}
                    max={40}
                    onChange={(title) =>
                      edit({
                        blocks: {
                          ...settings.blocks,
                          tour: {
                            ...tour,
                            cards: cards.map((item, index) => (index === i ? { ...item, title } : item)),
                          },
                        },
                      })
                    }
                  />
                  <Text
                    label={`Detalle tarjeta ${i + 1}`}
                    value={card.text}
                    max={100}
                    onChange={(text) =>
                      edit({
                        blocks: {
                          ...settings.blocks,
                          tour: {
                            ...tour,
                            cards: cards.map((item, index) => (index === i ? { ...item, text } : item)),
                          },
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
          <section className="card span-2 titulos-card" aria-label="Títulos de sección">
            <div className="card-head">
              <div>
                <h2>Títulos de sección</h2>
                <p>
                  Lo gris es el texto actual. Si dejas un campo vacío, la página usa ese texto. En el título,
                  Enter hace un salto de línea.
                </p>
              </div>
            </div>
            <div className="copy-grid">
              {COPY_SECTIONS.map((key) => (
                <CopyCard
                  key={key}
                  name={`titles-${key}`}
                  heading={SECTION_LABEL[key] ?? key}
                  value={settings.blocks.titles?.[key]}
                  defaults={COPY_DEFAULTS.titles[key]}
                  onChange={(value) => setBlocks({ titles: { ...settings.blocks.titles, [key]: value } })}
                />
              ))}
            </div>
          </section>
          <section className="card" aria-label="Cierre">
            <div className="card-head">
              <div>
                <h2>Cierre</h2>
                <p>El bloque con humo al final de la página</p>
              </div>
            </div>
            <CopyCard
              name="final"
              ariaName="Cierre"
              value={settings.blocks.final}
              defaults={COPY_DEFAULTS.final}
              button={{ label: 'Botón', max: COPY_MAX.button }}
              onChange={(value) => setBlocks({ final: { ...settings.blocks.final, ...value } })}
            />
          </section>
          <section className="card" aria-label="Botones del inicio">
            <div className="card-head">
              <div>
                <h2>Botones del inicio</h2>
                <p>Los botones de arriba, el de WhatsApp y la nota bajo ellos</p>
              </div>
            </div>
            <div className="form">
              <Text
                label="Botón principal"
                name="cta-primary"
                value={settings.blocks.cta?.primary}
                placeholder={COPY_DEFAULTS.cta.primary}
                max={COPY_MAX.button}
                onChange={(primary) => setBlocks({ cta: { ...settings.blocks.cta, primary } })}
              />
              <Text
                label="Botón de WhatsApp"
                name="cta-whatsapp"
                value={settings.blocks.cta?.whatsapp}
                placeholder={COPY_DEFAULTS.cta.whatsapp}
                max={COPY_MAX.button}
                onChange={(whatsapp) => setBlocks({ cta: { ...settings.blocks.cta, whatsapp } })}
              />
              <Text
                label="Nota sin local abierto"
                name="cta-note-closed"
                value={settings.blocks.cta?.note_closed}
                placeholder={COPY_DEFAULTS.cta.note_closed}
                max={COPY_MAX.note}
                onChange={(note_closed) => setBlocks({ cta: { ...settings.blocks.cta, note_closed } })}
              />
              <Text
                label="Nota con local abierto"
                name="cta-note-open"
                value={settings.blocks.cta?.note_open}
                placeholder={COPY_DEFAULTS.cta.note_open}
                max={COPY_MAX.note}
                onChange={(note_open) => setBlocks({ cta: { ...settings.blocks.cta, note_open } })}
              />
              <small className="muted">
                La nota cambia sola según el interruptor “El local está abierto al público” (Punto físico).
              </small>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'secciones' ? (
        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Secciones visibles</h2>
                <p>Apaga una sección sin borrar su contenido</p>
              </div>
            </div>
            <div className="rows">
              {Object.entries(SECTION_LABEL).map(([key, label]) => (
                <div className="row" key={key}>
                  <b>{label}</b>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={settings.sections[key] !== false}
                      onChange={(event) =>
                        edit({ sections: { ...settings.sections, [key]: event.target.checked } })
                      }
                    />
                    <span />
                  </label>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'pedidos' ? (
        <DeliveryAndPayments
          restaurantId={restaurantId}
          settings={settings}
          edit={edit}
          etaVersion={etaVersion}
        />
      ) : null}

      {tab === 'local' ? <Store settings={settings} edit={edit} onInvalid={setCoordsInvalid} /> : null}
    </>
  );
}

/** Punto físico (F10, D33): dirección y horario se ven al publicar; "Recoger en tienda" aplica al guardar. */
function Store({
  settings,
  edit,
  onInvalid,
}: {
  settings: SiteSettings;
  edit: (patch: Partial<SiteSettings>) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const hours = settings.store_hours;
  const [latText, setLatText] = useState(String(settings.store_lat ?? ''));
  const [lngText, setLngText] = useState(String(settings.store_lng ?? ''));
  const [pasteText, setPasteText] = useState('');
  const latCheck = parseCoordinate(latText, 'lat');
  const lngCheck = parseCoordinate(lngText, 'lng');
  const half = (latText.trim() === '') !== (lngText.trim() === '');
  const invalid = !latCheck.ok || !lngCheck.ok || half;
  useEffect(() => {
    onInvalid(invalid);
    return () => onInvalid(false);
  }, [invalid, onInvalid]);
  const setLat = (text: string) => {
    setLatText(text);
    const check = parseCoordinate(text, 'lat');
    if (check.ok) edit({ store_lat: check.value });
  };
  const setLng = (text: string) => {
    setLngText(text);
    const check = parseCoordinate(text, 'lng');
    if (check.ok) edit({ store_lng: check.value });
  };
  const paste = (text: string) => {
    setPasteText(text);
    const pair = parseCoordinatePair(text);
    if (!pair) return;
    setLat(pair.lat);
    setLng(pair.lng);
    setPasteText('');
  };
  return (
    <section className="card" aria-label="Punto físico">
      <div className="card-head">
        <div>
          <h2>Punto físico</h2>
          <p>Mientras esté apagado, la página dice “Punto físico · Próximamente”.</p>
        </div>
      </div>
      <div className="form">
        <div className="row">
          <span>
            <b>El local está abierto al público</b>
            <br />
            <small className="muted">
              Muestra la dirección, el horario y el enlace al mapa en la página.
            </small>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Local abierto al público"
              checked={settings.store_open}
              onChange={(event) =>
                edit({
                  store_open: event.target.checked,
                  pickup_enabled: event.target.checked && settings.pickup_enabled,
                })
              }
            />
            <span />
          </label>
        </div>
        <Text
          label="Dirección del local"
          value={settings.store_address ?? ''}
          max={160}
          onChange={(value) => edit({ store_address: value })}
        />
        <Text
          label="Enlace de Google Maps (https://)"
          value={settings.store_maps_url ?? ''}
          max={300}
          onChange={(value) => edit({ store_maps_url: value })}
        />
        <div className="field">
          <label htmlFor="ed-coords">Coordenadas del local (pega las dos juntas)</label>
          <input
            className="input"
            id="ed-coords"
            inputMode="decimal"
            placeholder="4.68, -74.08"
            value={pasteText}
            onChange={(event) => paste(event.target.value)}
          />
          <small className="muted coords-help">
            Copia las coordenadas desde Google Maps (clic derecho sobre el local). Sirven para el mapa de
            cobertura.
          </small>
        </div>
        <div className="form-2">
          <div className="field">
            <label htmlFor="ed-lat">Latitud</label>
            <input
              className="input"
              id="ed-lat"
              inputMode="decimal"
              placeholder="4.68"
              aria-invalid={!latCheck.ok}
              value={latText}
              onChange={(event) => setLat(event.target.value)}
            />
            {!latCheck.ok ? <small className="ajustes-error">{latCheck.message}</small> : null}
          </div>
          <div className="field">
            <label htmlFor="ed-lng">Longitud</label>
            <input
              className="input"
              id="ed-lng"
              inputMode="decimal"
              placeholder="-74.08"
              aria-invalid={!lngCheck.ok}
              value={lngText}
              onChange={(event) => setLng(event.target.value)}
            />
            {!lngCheck.ok ? <small className="ajustes-error">{lngCheck.message}</small> : null}
          </div>
        </div>
        {half && latCheck.ok && lngCheck.ok ? (
          <small className="ajustes-error">Escribe latitud y longitud, o deja las dos vacías.</small>
        ) : null}
        {hours.map(([days, time], i) => (
          <div className="form-2" key={i}>
            <Text
              label={`Días del local ${i + 1}`}
              value={days}
              max={40}
              onChange={(value) =>
                edit({ store_hours: hours.map((row, index) => (index === i ? [value, row[1]] : row)) })
              }
            />
            <Text
              label={`Horas del local ${i + 1}`}
              value={time}
              max={40}
              onChange={(value) =>
                edit({ store_hours: hours.map((row, index) => (index === i ? [row[0], value] : row)) })
              }
            />
          </div>
        ))}
        <button
          className="btn btn-soft btn-sm"
          type="button"
          onClick={() => edit({ store_hours: [...hours, ['', '']] })}
        >
          ＋ Horario del local
        </button>
        <div className="row">
          <span>
            <b>Permitir “Recoger en tienda”</b>
            <br />
            <small className="muted">
              El cliente elige recoger al pedir: no paga domicilio ni escribe dirección. Aplica al guardar.
            </small>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Permitir recoger en tienda"
              checked={settings.pickup_enabled}
              disabled={!settings.store_open || !settings.store_address?.trim()}
              onChange={(event) => edit({ pickup_enabled: event.target.checked })}
            />
            <span />
          </label>
        </div>
      </div>
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  max,
  area = false,
  name,
  placeholder,
  ariaLabel,
  rows,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  max: number;
  area?: boolean;
  /** Identificador estable cuando la misma etiqueta se repite en varias tarjetas. */
  name?: string | undefined;
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  rows?: number | undefined;
}) {
  const id = `ed-${(name ?? label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area ? (
        <textarea
          className="textarea"
          id={id}
          maxLength={max}
          rows={rows}
          placeholder={placeholder}
          aria-label={ariaLabel}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="input"
          id={id}
          maxLength={max}
          placeholder={placeholder}
          aria-label={ariaLabel}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

/** Antetítulo, título (Enter = salto) y texto de una sección; opcionalmente un botón. El marcador es el texto actual. */
function CopyCard({
  name,
  heading,
  value,
  defaults,
  button,
  onChange,
  ariaName,
}: {
  name: string;
  heading?: string;
  /** Nombre para las etiquetas accesibles cuando la tarjeta no lleva título propio (p. ej. "Cierre"). */
  ariaName?: string;
  value: (SectionCopy & { button?: string }) | undefined;
  defaults: SectionCopy & { button?: string };
  button?: { label: string; max: number };
  onChange: (value: SectionCopy & { button?: string }) => void;
}) {
  const current = value ?? {};
  const set = (key: 'kicker' | 'title' | 'text' | 'button') => (text: string) =>
    onChange({ ...current, [key]: text });
  const tag = heading || ariaName ? ` de ${heading ?? ariaName}` : '';
  return (
    <div className="copy-card" data-testid={`copy-${name}`}>
      {heading ? <h3>{heading}</h3> : null}
      <Text
        label="Antetítulo"
        name={`${name}-kicker`}
        ariaLabel={`Antetítulo${tag}`}
        value={current.kicker}
        placeholder={defaults.kicker}
        max={COPY_MAX.kicker}
        onChange={set('kicker')}
      />
      <Text
        label="Título"
        name={`${name}-title`}
        ariaLabel={`Título${tag}`}
        area
        rows={2}
        value={current.title}
        placeholder={defaults.title}
        max={COPY_MAX.title}
        onChange={set('title')}
      />
      <Text
        label="Texto"
        name={`${name}-text`}
        ariaLabel={`Texto${tag}`}
        area
        rows={2}
        value={current.text}
        placeholder={defaults.text}
        max={COPY_MAX.text}
        onChange={set('text')}
      />
      {button ? (
        <Text
          label={button.label}
          name={`${name}-button`}
          ariaLabel={`${button.label}${tag}`}
          value={current.button}
          placeholder={defaults.button}
          max={button.max}
          onChange={set('button')}
        />
      ) : null}
    </div>
  );
}

/** Imagen de un bloque: se sube con la misma función que la carta (carpeta del restaurante). Sin imagen = la original. */
function ImageField({
  label,
  restaurantId,
  value,
  fallback,
  onChange,
}: {
  label: string;
  restaurantId: string;
  value: string | undefined;
  fallback: string;
  onChange: (path: string | null) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadPhoto(restaurantId, file));
      toast('Imagen subida. Guarda y publica para verla.');
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo subir la imagen.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="field">
      <label htmlFor={`img-${label}`}>{label}</label>
      <div className="photo-row">
        <img
          className="thumb thumb-lg"
          src={photoUrl(value || fallback) ?? ''}
          alt={value ? `${label} actual` : `${label} original`}
        />
        <input
          id={`img-${label}`}
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {value ? (
          <button className="btn btn-soft btn-sm" type="button" onClick={() => onChange(null)}>
            Volver a la original
          </button>
        ) : null}
      </div>
      <span className="hint">Se reduce a 1200 px y se guarda liviana, sin metadatos de ubicación.</span>
    </div>
  );
}

function DeliveryAndPayments({
  restaurantId,
  settings,
  edit,
  etaVersion,
}: {
  restaurantId: string;
  settings: SiteSettings;
  edit: (patch: Partial<SiteSettings>) => void;
  etaVersion: number;
}) {
  const toast = useToast();
  const [eta, setEta] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadEtaPreview().then((text) => {
      if (alive) setEta(text);
    });
    return () => {
      alive = false;
    };
  }, [etaVersion]);
  const [zones, setZones] = useState<EditZone[]>([]);
  const [payments, setPayments] = useState<EditPayment[]>([]);
  const [newZone, setNewZone] = useState('');
  const [newLocality, setNewLocality] = useState('');
  const [newPayment, setNewPayment] = useState('');
  const reload = useCallback(
    () =>
      loadZonesAndPayments(restaurantId)
        .then((data) => {
          setZones(data.zones);
          setPayments(data.payments);
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

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Pedidos</h2>
            <p>Mínimo, tiempo y si se reciben pedidos (se guarda con Guardar; aplica sin publicar)</p>
          </div>
        </div>
        <div className="rows">
          <div className="row">
            <div>
              <b>Recibiendo pedidos</b>
              <small>Apágalo si hoy no hay servicio: la carta se ve pero no se puede pedir</small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-label="Recibiendo pedidos"
                checked={settings.accepting_orders}
                onChange={(event) => edit({ accepting_orders: event.target.checked })}
              />
              <span />
            </label>
          </div>
        </div>
        <div className="form-2">
          <div className="field">
            <label htmlFor="ed-min">Pedido mínimo</label>
            <input
              className="input"
              id="ed-min"
              inputMode="numeric"
              value={settings.delivery_min}
              onChange={(event) => edit({ delivery_min: toNumber(event.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="ed-eta">Tiempo de entrega</label>
            <input
              className="input"
              id="ed-eta"
              maxLength={20}
              value={settings.delivery_eta}
              onChange={(event) => edit({ delivery_eta: event.target.value })}
            />
          </div>
        </div>
        <div className="rows">
          <div className="row">
            <div>
              <b>Hora estimada dinámica</b>
              <small>
                Suma minutos al tiempo de entrega según los pedidos activos (nuevo, confirmado, en el barril y
                en camino).
              </small>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-label="Hora estimada dinámica"
                checked={settings.eta_dynamic}
                onChange={(event) => edit({ eta_dynamic: event.target.checked })}
              />
              <span />
            </label>
          </div>
        </div>
        {settings.eta_dynamic ? (
          <div className="form-2">
            <div className="field">
              <label htmlFor="ed-eta-per">Minutos por pedido activo</label>
              <input
                className="input"
                id="ed-eta-per"
                inputMode="numeric"
                value={settings.eta_per_order_min}
                onChange={(event) => edit({ eta_per_order_min: Math.min(30, toNumber(event.target.value)) })}
              />
            </div>
            <div className="field">
              <label htmlFor="ed-eta-max">Máximo de minutos extra</label>
              <input
                className="input"
                id="ed-eta-max"
                inputMode="numeric"
                value={settings.eta_max_extra_min}
                onChange={(event) => edit({ eta_max_extra_min: Math.min(180, toNumber(event.target.value)) })}
              />
            </div>
          </div>
        ) : null}
        <p className="hint eta-preview" data-testid="eta-preview" role="status">
          {eta === undefined
            ? 'Calculando la hora estimada…'
            : eta
              ? `Ahora mismo el cliente ve: ${eta}.`
              : 'No pudimos consultar la hora estimada.'}{' '}
          {settings.eta_dynamic
            ? 'El tiempo base debe verse como “30–40 min” o “35 min”; si no, se muestra tal cual. Guarda para actualizar esta vista.'
            : 'Con la opción apagada se muestra el tiempo base.'}
        </p>
        <div className="card-head">
          <div>
            <h2>Zonas de domicilio</h2>
            <p>
              Costo y cobertura (aplican al instante). La localidad ubica la zona en el mapa de cobertura.
            </p>
          </div>
        </div>
        <div className="rows">
          {zones.map((zone) => (
            <div className="row" key={zone.id}>
              <b>{zone.name}</b>
              <div className="right">
                <select
                  className={`input zone-locality${zone.locality_code ? '' : ' sin-localidad'}`}
                  aria-label={`Localidad de ${zone.name}`}
                  value={zone.locality_code ?? ''}
                  onChange={(event) => {
                    const locality_code = event.target.value || null;
                    setZones((list) =>
                      list.map((item) => (item.id === zone.id ? { ...item, locality_code } : item)),
                    );
                    void run(upsertZone(restaurantId, { ...zone, locality_code }), 'Localidad actualizada');
                  }}
                >
                  <option value="">Sin localidad</option>
                  {BOGOTA_LOCALITIES.map((locality) => (
                    <option key={locality.code} value={locality.code}>
                      {locality.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input price-in"
                  inputMode="numeric"
                  aria-label={`Costo ${zone.name}`}
                  defaultValue={zone.fee}
                  onBlur={(event) => {
                    const fee = toNumber(event.target.value);
                    if (fee !== zone.fee)
                      void run(upsertZone(restaurantId, { ...zone, fee }), `${zone.name}: ${money(fee)}`);
                  }}
                />
                <label className="switch">
                  <input
                    type="checkbox"
                    aria-label={`${zone.name} activa`}
                    checked={zone.active}
                    onChange={(event) => {
                      const active = event.target.checked;
                      setZones((list) =>
                        list.map((item) => (item.id === zone.id ? { ...item, active } : item)),
                      );
                      void run(upsertZone(restaurantId, { ...zone, active }), 'Zona actualizada');
                    }}
                  />
                  <span />
                </label>
              </div>
            </div>
          ))}
        </div>
        <form
          className="inline-add"
          onSubmit={(event) => {
            event.preventDefault();
            const locality = BOGOTA_LOCALITIES.find((item) => item.code === newLocality);
            const name = newZone.trim() || locality?.name || '';
            if (name.length < 2) return;
            void run(
              upsertZone(restaurantId, {
                name,
                fee: 6000,
                position: zones.length,
                locality_code: locality?.code ?? null,
              }),
              `${name} agregada`,
            );
            setNewZone('');
            setNewLocality('');
          }}
        >
          <input
            className="input"
            aria-label="Nueva zona"
            placeholder="Nueva localidad"
            value={newZone}
            onChange={(event) => setNewZone(event.target.value)}
          />
          <select
            className="input zone-locality"
            aria-label="Localidad de la nueva zona"
            value={newLocality}
            onChange={(event) => setNewLocality(event.target.value)}
          >
            <option value="">Localidad…</option>
            {BOGOTA_LOCALITIES.map((locality) => (
              <option key={locality.code} value={locality.code}>
                {locality.name}
              </option>
            ))}
          </select>
          <button className="btn btn-soft" type="submit">
            Agregar
          </button>
        </form>
      </section>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Medios de pago</h2>
            <p>Lo que el cliente puede elegir al pedir (D17)</p>
          </div>
        </div>
        <div className="rows">
          {payments.map((method) => (
            <div className="row" key={method.id}>
              <div>
                <b>{method.label}</b>
                <small>{method.asks_change ? 'Pide "¿con cuánto pagas?"' : ''}</small>
              </div>
              <div className="right">
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Quitar ${method.label}`}
                  onClick={() => void run(deletePayment(method.id), `${method.label} quitado`)}
                >
                  🗑
                </button>
                <label className="switch">
                  <input
                    type="checkbox"
                    aria-label={`${method.label} disponible`}
                    checked={method.active}
                    onChange={(event) => {
                      const active = event.target.checked;
                      setPayments((list) =>
                        list.map((item) => (item.id === method.id ? { ...item, active } : item)),
                      );
                      void run(
                        upsertPayment(restaurantId, { ...method, active }),
                        active ? 'Disponible' : 'Oculto en el pedido',
                      );
                    }}
                  />
                  <span />
                </label>
              </div>
            </div>
          ))}
        </div>
        <form
          className="inline-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (newPayment.trim().length < 2) return;
            void run(
              upsertPayment(restaurantId, { label: newPayment.trim(), position: payments.length }),
              `${newPayment.trim()} agregado`,
            );
            setNewPayment('');
          }}
        >
          <input
            className="input"
            aria-label="Nuevo medio de pago"
            placeholder="Ej. Bold, Llave Bre-B"
            value={newPayment}
            onChange={(event) => setNewPayment(event.target.value)}
          />
          <button className="btn btn-soft" type="submit">
            Agregar
          </button>
        </form>
        <p className="hint">¿Hoy no hay datáfono? Apágalo y desaparece del pedido al instante.</p>
      </section>
    </div>
  );
}
