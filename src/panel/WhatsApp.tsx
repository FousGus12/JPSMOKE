import { useCallback, useEffect, useState } from 'react';
import { buildMessage, type WaKind } from '../../supabase/functions/_shared/plantillas';
import {
  STATUS_LABEL,
  activationSteps,
  errorLabel,
  loadWhatsApp,
  normalizeBusinessPhone,
  saveWhatsApp,
  type StepState,
  type WaLog,
  type WaMode,
} from './whatsapp-data';
import { useToast } from './ui';

const MODES: Array<{ key: WaMode; label: string; lead: string; points: string[] }> = [
  {
    key: 'manual',
    label: 'Apagado',
    lead: 'No sale ningún mensaje automático.',
    points: ['Los clientes siguen pudiendo escribirte por WhatsApp.', 'Tú respondes a mano, como siempre.'],
  },
  {
    key: 'prueba',
    label: 'Prueba',
    lead: 'Se arma cada mensaje, pero no se envía.',
    points: ['Sin costo.', 'Sirve para ver cómo queda cada mensaje en "Mensajes enviados".'],
  },
  {
    key: 'activo',
    label: 'Activo',
    lead: 'Los mensajes se envían de verdad.',
    points: ['Requiere cuenta de WhatsApp Business en Meta.', 'Meta cobra por cada confirmación automática.'],
  },
];
const KIND_LABEL: Record<WaKind, string> = {
  pedido_recibido: 'Confirmación del pedido (al cliente)',
  aviso_negocio: 'Pedido nuevo (a ti)',
  en_camino: 'Va en camino (al cliente)',
  informe_semanal: 'Informe semanal (a ti, lunes 8 a. m.)',
  stock_bajo: 'Insumo en el mínimo (a ti)',
};
const KINDS = Object.keys(KIND_LABEL) as WaKind[];
const STEP_CLASS: Record<StepState, string> = { listo: 'is-ok', falta: 'is-miss', pendiente: 'is-wait' };
const STATUS_CLASS: Record<WaLog['status'], string> = {
  pendiente: 'st-nuevo',
  enviado: 'st-entregado',
  simulado: 'st-confirmado',
  fallido: 'st-cancelado',
  omitido: 'st-confirmado',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });

/** WhatsApp automático (F9, D32). */
export function WhatsApp({ restaurantId, restaurant }: { restaurantId: string; restaurant: string }) {
  const toast = useToast();
  const [mode, setMode] = useState<WaMode>('manual');
  const [siteUrl, setSiteUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [logs, setLogs] = useState<WaLog[]>([]);
  const reload = useCallback(
    () =>
      loadWhatsApp(restaurantId)
        .then((data) => {
          setMode(data.mode);
          setSiteUrl(data.siteUrl);
          setPhone(data.phone);
          setLogs(data.logs);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function changeMode(next: WaMode) {
    if (
      next === 'activo' &&
      !confirm(
        'Activo envía mensajes reales y Meta cobra cada confirmación automática. ¿Ya tienes la cuenta de WhatsApp Business, las plantillas aprobadas y el método de pago en Meta?',
      )
    )
      return;
    setMode(next);
    try {
      await saveWhatsApp(restaurantId, { whatsapp_mode: next });
      toast(`WhatsApp: ${MODES.find((item) => item.key === next)?.label}`);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      void reload();
    }
  }

  const sample = {
    id: 'x',
    mode,
    restaurant,
    site_url: siteUrl || null,
    business_phone: phone || '573001234567',
    eta: '35–50 min',
    order: {
      code: 'JP-0042',
      status: 'nuevo',
      name: 'Ana',
      phone: '3105551234',
      total: 45000,
      items: 2,
      zone: 'Engativá',
      channel: 'web',
    },
    report: { from: '2026-10-26', to: '2026-11-01', total: 1_250_000, orders: 41, star: 'La Ahumadora' },
  };
  const steps = activationSteps(phone, logs);
  function savePhone() {
    const value = normalizeBusinessPhone(phone);
    if (value === undefined) {
      toast('El número debe ser un celular colombiano de 10 dígitos, por ejemplo 3001234567.');
      return;
    }
    void saveWhatsApp(restaurantId, { whatsapp: value })
      .then(() => {
        setPhone(value ?? '');
        toast(value ? 'Número guardado' : 'Número borrado');
      })
      .catch((failure: unknown) => toast(failure instanceof Error ? failure.message : 'No se pudo guardar.'));
  }
  const phoneShown = phone.startsWith('57') && phone.length === 12 ? phone.slice(2) : phone;
  return (
    <>
      <section className="card wa-intro">
        <h2>WhatsApp automático</h2>
        <p>
          Cuando alguien pide por la página, le llega a su WhatsApp la confirmación con su pedido y el enlace
          para seguirlo; a ti te llega el aviso.
        </p>
      </section>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>¿Cómo quieres usarlo?</h2>
            <p>Elige una opción. Puedes cambiarla cuando quieras.</p>
          </div>
        </div>
        <div className="modes" role="radiogroup" aria-label="Modo de WhatsApp">
          {MODES.map(({ key, label, lead, points }) => (
            <label className={`mode ${mode === key ? 'is-on' : ''}`} key={key}>
              <input
                type="radio"
                name="wa-mode"
                value={key}
                checked={mode === key}
                onChange={() => void changeMode(key)}
              />
              <b>{label}</b>
              <span className="wa-lead">{lead}</span>
              {points.map((point) => (
                <small key={point}>{point}</small>
              ))}
            </label>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Tus datos</h2>
            <p>El número recibe los avisos; la dirección va en el enlace de seguimiento del cliente.</p>
          </div>
        </div>
        <form
          className="wa-field"
          onSubmit={(event) => {
            event.preventDefault();
            savePhone();
          }}
        >
          <label htmlFor="wa-phone">WhatsApp del negocio (el que recibe los avisos)</label>
          <div className="inline-add">
            <input
              id="wa-phone"
              className="input"
              inputMode="tel"
              autoComplete="off"
              placeholder="3001234567"
              value={phoneShown}
              onChange={(event) => setPhone(event.target.value)}
            />
            <button className="btn btn-soft" type="submit">
              Guardar
            </button>
          </div>
        </form>
        <form
          className="wa-field"
          onSubmit={(event) => {
            event.preventDefault();
            void saveWhatsApp(restaurantId, { site_url: siteUrl.trim() || null })
              .then(() => toast('Dirección guardada'))
              .catch((failure: unknown) =>
                toast(failure instanceof Error ? failure.message : 'No se pudo guardar.'),
              );
          }}
        >
          <label htmlFor="wa-site">Dirección de la página</label>
          <div className="inline-add">
            <input
              id="wa-site"
              className="input"
              placeholder="https://jpsmoke.co"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
            />
            <button className="btn btn-soft" type="submit">
              Guardar
            </button>
          </div>
        </form>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>¿Qué falta para activarlo?</h2>
              <p>Solo hace falta si quieres el modo Activo.</p>
            </div>
          </div>
          <ol className="wa-steps">
            {steps.map((step) => (
              <li
                className={`wa-step ${STEP_CLASS[step.state]}`}
                key={step.key}
                data-testid={`wa-step-${step.key}`}
              >
                <div>
                  <b>{step.title}</b>
                  <small>{step.detail}</small>
                </div>
                <span className="wa-pill">{step.note}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>¿Cuánto cuesta?</h2>
              <p>Con la cuenta de Meta, no hay envío gratis garantizado.</p>
            </div>
          </div>
          <ul className="wa-cost">
            <li>
              <b>Confirmaciones automáticas.</b> Son plantillas y Meta cobra cada mensaje (un valor bajo, en
              pesos). Mira la tarifa vigente en tu cuenta de Meta.
            </li>
            <li>
              <b>Responder cuando el cliente te escribe primero.</b> Meta da un cupo mensual sin costo para
              estas respuestas; confirma el cupo y la tarifa vigentes en tu cuenta antes de activar.
            </li>
            <li>
              <b>Herramientas no oficiales.</b> Pueden hacer que WhatsApp bloquee tu número. No las uses.
            </li>
          </ul>
        </section>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Así se ven</h2>
              <p>Los 5 mensajes que se registran en Meta, con datos de ejemplo</p>
            </div>
          </div>
          <div className="rows">
            {KINDS.map((kind) => {
              const built = buildMessage({
                ...sample,
                kind,
                supply: { name: 'Pan brioche', stock: 6, min: 10, unit: 'und' },
              });
              return (
                <div className="row wa-preview" key={kind}>
                  <div>
                    <b>{KIND_LABEL[kind]}</b>
                    <small className="wa-tpl">{kind}</small>
                    <p className="quote-msg">{'skip' in built ? 'Sin datos suficientes' : built.preview}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Mensajes enviados</h2>
              <p>Los últimos 50. No se guardan celulares ni textos.</p>
            </div>
            <button className="btn btn-soft btn-sm" type="button" onClick={() => void reload()}>
              Actualizar
            </button>
          </div>
          {logs.length === 0 ? <p className="muted">Aún no hay mensajes.</p> : null}
          <div className="rows">
            {logs.map((log) => (
              <div
                className="row"
                key={log.id}
                data-testid={`wa-${log.kind}-${log.orders?.code ?? 'informe'}`}
              >
                <div>
                  <b>{KIND_LABEL[log.kind]}</b>
                  <small>
                    {log.orders?.code ?? (log.kind === 'stock_bajo' ? 'Inventario' : 'Semana')} ·{' '}
                    {when(log.created_at)}
                    {log.error ? ` · ${errorLabel(log.error)}` : ''}
                  </small>
                </div>
                <span className={`st ${STATUS_CLASS[log.status]}`}>{STATUS_LABEL[log.status]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
