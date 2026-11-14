import { useCallback, useEffect, useState } from 'react';
import { buildMessage, type WaKind } from '../../supabase/functions/_shared/plantillas';
import { loadWhatsApp, saveWhatsApp, type WaLog, type WaMode } from './whatsapp-data';
import { useToast } from './ui';

const MODES: Array<[WaMode, string, string]> = [
  ['manual', 'Apagado', 'No sale ningún mensaje automático. El equipo escribe por WhatsApp si quiere.'],
  [
    'prueba',
    'Prueba',
    'Se arma cada mensaje y queda en el registro como "simulado". No se envía nada ni tiene costo.',
  ],
  [
    'activo',
    'Activo',
    'Envía de verdad con WhatsApp de Meta. Requiere credenciales, plantillas aprobadas y tiene costo por mensaje.',
  ],
];
const KIND_LABEL: Record<WaKind, string> = {
  pedido_recibido: 'Pedido recibido (al cliente)',
  aviso_negocio: 'Pedido nuevo (al negocio)',
  en_camino: 'Va en camino (al cliente)',
  informe_semanal: 'Informe semanal (al negocio)',
};
const STATUS_CLASS: Record<WaLog['status'], string> = {
  pendiente: 'st-nuevo',
  enviado: 'st-entregado',
  simulado: 'st-confirmado',
  fallido: 'st-cancelado',
  omitido: '',
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
  const [logs, setLogs] = useState<WaLog[]>([]);
  const reload = useCallback(
    () =>
      loadWhatsApp(restaurantId)
        .then((data) => {
          setMode(data.mode);
          setSiteUrl(data.siteUrl);
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
        'Activo envía mensajes reales con costo por mensaje. ¿Ya están las credenciales de Meta y las plantillas aprobadas?',
      )
    )
      return;
    setMode(next);
    try {
      await saveWhatsApp(restaurantId, { whatsapp_mode: next });
      toast(`WhatsApp: ${MODES.find(([key]) => key === next)?.[1]}`);
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
    business_phone: '573001234567',
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
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Mensajes automáticos</h2>
            <p>Confirmación al cliente, aviso al negocio, "va en camino" e informe semanal (lunes 8 a. m.)</p>
          </div>
        </div>
        <div className="modes" role="radiogroup" aria-label="Modo de WhatsApp">
          {MODES.map(([key, label, detail]) => (
            <label className={`mode ${mode === key ? 'is-on' : ''}`} key={key}>
              <input
                type="radio"
                name="wa-mode"
                value={key}
                checked={mode === key}
                onChange={() => void changeMode(key)}
              />
              <b>{label}</b>
              <small>{detail}</small>
            </label>
          ))}
        </div>
        <form
          className="inline-add"
          onSubmit={(event) => {
            event.preventDefault();
            void saveWhatsApp(restaurantId, { site_url: siteUrl.trim() || null })
              .then(() => toast('Dirección guardada'))
              .catch((failure: unknown) =>
                toast(failure instanceof Error ? failure.message : 'No se pudo guardar.'),
              );
          }}
        >
          <input
            className="input"
            aria-label="Dirección de la página"
            placeholder="https://jpsmoke.co (para el enlace de seguimiento)"
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
          />
          <button className="btn btn-soft" type="submit">
            Guardar
          </button>
        </form>
      </section>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Así se ven</h2>
              <p>Estas son las plantillas que se registran en Meta</p>
            </div>
          </div>
          <div className="rows">
            {(Object.keys(KIND_LABEL) as WaKind[]).map((kind) => {
              const built = buildMessage({ ...sample, kind });
              return (
                <div className="row wa-preview" key={kind}>
                  <div>
                    <b>{KIND_LABEL[kind]}</b>
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
              <h2>Registro</h2>
              <p>Últimos 50 · no se guardan celulares ni textos</p>
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
                    {log.orders?.code ?? 'Semana'} · {when(log.created_at)}
                    {log.error ? ` · ${log.error}` : ''}
                  </small>
                </div>
                <span className={`st ${STATUS_CLASS[log.status]}`}>{log.status}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
