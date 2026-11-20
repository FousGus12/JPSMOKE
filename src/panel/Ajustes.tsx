import { useEffect, useState } from 'react';
import { isHttps, loadSettings, publishSite, saveSettings, type SiteSettings } from './editor';
import { useToast } from './ui';

const CHANNEL_NAME: Record<string, string> = { rappi: 'Rappi', didi: 'DiDi Food' };
const channelName = (key: string) => CHANNEL_NAME[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

/** Ajustes (D41, D45): datos del negocio, horario y canales. Un solo editor; los canales se ven en la página al publicar. */
export function Ajustes({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const channelKeys = Array.from(new Set(['rappi', 'didi', ...Object.keys(settings.channels ?? {})]));

  async function save(): Promise<boolean> {
    if (!settings) return false;
    for (const key of channelKeys) {
      const channel = settings.channels[key];
      if (channel?.url.trim() && !isHttps(channel.url)) {
        toast(`El enlace de ${channelName(key)} debe empezar por https://`);
        return false;
      }
      if (channel?.visible && !channel.url.trim()) {
        toast(`Pega el enlace de ${channelName(key)} para mostrarlo.`);
        return false;
      }
    }
    setBusy(true);
    try {
      await saveSettings(restaurantId, {
        instagram: settings.instagram?.trim() || null,
        tiktok: settings.tiktok?.trim() || null,
        hours: settings.hours.filter(([days, time]) => days.trim() || time.trim()),
        channels: settings.channels,
      });
      setDirty(false);
      toast('Cambios guardados.');
      return true;
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy(true);
    const result = await publishSite();
    setBusy(false);
    if (result.ok) {
      setSettings((current) => (current ? { ...current, published_at: result.published_at } : current));
      toast('Publicado. La página se actualiza en ~1 minuto.');
    } else toast(result.message);
  }

  return (
    <>
      <div className="toolbar">
        <span className="grow muted">Los cambios en canales se ven en la página al publicar.</span>
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
      <div className="grid-2">
        <section className="card" aria-label="Datos del negocio">
          <div className="card-head">
            <div>
              <h2>Datos del negocio</h2>
              <p>Redes que se muestran en la página. El número de WhatsApp se cambia en WhatsApp.</p>
            </div>
          </div>
          <div className="form">
            <div className="form-2">
              <Field
                label="Instagram"
                value={settings.instagram ?? ''}
                max={40}
                onChange={(instagram) => edit({ instagram: instagram || null })}
              />
              <Field
                label="TikTok"
                value={settings.tiktok ?? ''}
                max={40}
                onChange={(tiktok) => edit({ tiktok: tiktok || null })}
              />
            </div>
          </div>
        </section>

        <section className="card" aria-label="Horario">
          <div className="card-head">
            <div>
              <h2>Horario</h2>
              <p>Se muestra en el pie de la página</p>
            </div>
            <button
              className="btn btn-soft btn-sm"
              type="button"
              onClick={() => edit({ hours: [...settings.hours, ['', '']] })}
            >
              ＋ Fila
            </button>
          </div>
          <div className="form">
            {settings.hours.map(([day, time], i) => (
              <div className="form-2" key={i}>
                <Field
                  label={`Días ${i + 1}`}
                  value={day}
                  max={40}
                  onChange={(value) =>
                    edit({ hours: settings.hours.map((row, index) => (index === i ? [value, row[1]] : row)) })
                  }
                />
                <Field
                  label={`Horas ${i + 1}`}
                  value={time}
                  max={40}
                  onChange={(value) =>
                    edit({ hours: settings.hours.map((row, index) => (index === i ? [row[0], value] : row)) })
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-label="Canales">
          <div className="card-head">
            <div>
              <h2>Canales</h2>
              <p>Enlace a tu tienda en cada plataforma. Solo se muestran los que enciendas.</p>
            </div>
          </div>
          <p className="ajustes-note" role="note">
            Los cambios en canales se ven en la página al publicar.
          </p>
          <div className="rows">
            {channelKeys.map((key) => {
              const channel = settings.channels[key] ?? { visible: false, url: '' };
              const name = channelName(key);
              const badUrl = channel.url.trim() !== '' && !isHttps(channel.url);
              return (
                <div className="row canal-row" key={key}>
                  <div className="grow-field">
                    <b>{name}</b>
                    <input
                      className="input"
                      type="url"
                      inputMode="url"
                      aria-label={`Enlace de ${name}`}
                      aria-invalid={badUrl}
                      value={channel.url}
                      placeholder="https://"
                      onChange={(event) =>
                        edit({
                          channels: {
                            ...settings.channels,
                            [key]: { ...channel, url: event.target.value.trim() },
                          },
                        })
                      }
                    />
                    {badUrl ? <small className="ajustes-error">Debe empezar por https://</small> : null}
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label={`Mostrar ${name} en la página`}
                      checked={channel.visible}
                      onChange={(event) =>
                        edit({
                          channels: {
                            ...settings.channels,
                            [key]: { ...channel, visible: event.target.checked },
                          },
                        })
                      }
                    />
                    <span />
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
}) {
  const id = `aj-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        className="input"
        id={id}
        maxLength={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
