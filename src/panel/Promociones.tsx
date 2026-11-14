import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { formatCop as money } from '../core/money';
import { formatPhone } from '../core/orders';
import {
  KIND_LABEL,
  loadCoupons,
  loadLeads,
  saveCoupon,
  type CouponKind,
  type EditCoupon,
  type Lead,
} from './promos';
import { Modal, useToast } from './ui';

const date = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00-05:00`).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'short',
        timeZone: 'America/Bogota',
      })
    : 'Sin fecha';

/** Promociones y cupones (F7). Validar y descontar lo hace siempre el servidor (place_order). */
export function Promociones({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [coupons, setCoupons] = useState<EditCoupon[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [editing, setEditing] = useState<EditCoupon | 'nuevo' | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([loadCoupons(restaurantId), loadLeads(restaurantId)])
        .then(([list, captured]) => {
          setCoupons(list);
          setLeads(captured);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(coupon: EditCoupon, change: Partial<EditCoupon>, message: string) {
    setCoupons((list) => list.map((item) => (item.id === coupon.id ? { ...item, ...change } : item)));
    try {
      await saveCoupon(restaurantId, { id: coupon.id, ...change });
      toast(message);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      void reload();
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="note grow">
          Los cupones <b>visibles</b> salen en la sección de promociones (al publicar); los <b>secretos</b>{' '}
          solo funcionan si el cliente conoce el código. Activar, pausar y las reglas aplican al instante: el
          servidor valida vigencia, mínimo y usos en cada pedido.
        </div>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing('nuevo')}>
          ＋ Cupón
        </button>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th className="num">Mínimo</th>
                <th>Vence</th>
                <th className="num">Usos</th>
                <th>Visible</th>
                <th>Activo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id} data-testid={`cupon-${coupon.code}`}>
                  <td>
                    <div className="cell-name">
                      <div>
                        <b className="coupon-name">{coupon.code}</b>
                        <small>{coupon.title}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {KIND_LABEL[coupon.kind]}
                    {coupon.kind === 'porcentaje'
                      ? ` · ${coupon.value}%`
                      : coupon.kind === 'valor'
                        ? ` · ${money(coupon.value)}`
                        : ''}
                  </td>
                  <td className="num">{money(coupon.min_total)}</td>
                  <td>{date(coupon.ends_on)}</td>
                  <td className="num">
                    {coupon.uses}
                    {coupon.max_uses ? ` / ${coupon.max_uses}` : ''}
                  </td>
                  <td>
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label={`${coupon.code} visible en la página`}
                        checked={coupon.visible}
                        onChange={(event) =>
                          void toggle(
                            coupon,
                            { visible: event.target.checked },
                            event.target.checked ? 'Visible en la página' : 'Ahora es secreto',
                          )
                        }
                      />
                      <span />
                    </label>
                  </td>
                  <td>
                    <label className="switch">
                      <input
                        type="checkbox"
                        aria-label={`${coupon.code} activo`}
                        checked={coupon.active}
                        onChange={(event) =>
                          void toggle(
                            coupon,
                            { active: event.target.checked },
                            event.target.checked ? 'Cupón activo' : 'Cupón pausado',
                          )
                        }
                      />
                      <span />
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-soft btn-sm" type="button" onClick={() => setEditing(coupon)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Clientes captados con la bienvenida</h2>
            <p>Con autorización de datos; sirven para enviar promociones</p>
          </div>
          <span className="muted">{leads.length}</span>
        </div>
        {leads.length === 0 ? (
          <p className="muted">
            Aún nadie. Activa en Eventos un evento de bienvenida en modo aviso que capte datos.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Celular</th>
                  <th>Cupón</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.phone}>
                    <td>{lead.name}</td>
                    <td>{formatPhone(lead.phone)}</td>
                    <td>{lead.coupon ?? '—'}</td>
                    <td>{date(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing ? (
        <CouponForm
          restaurantId={restaurantId}
          coupon={editing === 'nuevo' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </>
  );
}

function CouponForm({
  restaurantId,
  coupon,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  coupon: EditCoupon | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    code: coupon?.code ?? '',
    kind: coupon?.kind ?? ('porcentaje' as CouponKind),
    value: coupon ? String(coupon.value) : '',
    min_total: coupon ? String(coupon.min_total) : '30000',
    title: coupon?.title ?? '',
    detail: coupon?.detail ?? '',
    starts_on: coupon?.starts_on ?? '',
    ends_on: coupon?.ends_on ?? '',
    max_uses: coupon?.max_uses ? String(coupon.max_uses) : '',
    once_per_phone: coupon?.once_per_phone ?? true,
    visible: coupon?.visible ?? false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });
  const number = (text: string) => Number(text.replace(/\D/g, '')) || 0;

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const code = form.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const value = number(form.value);
    if (code.length < 4 || form.title.trim().length < 3)
      return setError('Código (mínimo 4 letras o números) y texto para el cliente son obligatorios.');
    if (form.kind === 'porcentaje' && (value < 1 || value > 100))
      return setError('El porcentaje va de 1 a 100.');
    if (form.kind === 'valor' && value < 1) return setError('Escribe el valor del descuento.');
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on)
      return setError('La fecha de fin no puede ser antes del inicio.');
    setBusy(true);
    setError('');
    try {
      await saveCoupon(restaurantId, {
        ...(coupon ? { id: coupon.id } : { active: true }),
        code,
        kind: form.kind,
        value: form.kind === 'porcentaje' || form.kind === 'valor' ? value : 0,
        min_total: number(form.min_total),
        title: form.title.trim(),
        detail: form.detail.trim(),
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        max_uses: number(form.max_uses) || null,
        once_per_phone: form.once_per_phone,
        visible: form.visible,
      });
      toast(`Cupón ${code} guardado`);
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={coupon ? `Editar · ${coupon.code}` : 'Nuevo cupón'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field">
            <label htmlFor="cf-code">Código</label>
            <input
              className="input upper"
              id="cf-code"
              value={form.code}
              maxLength={20}
              onChange={set('code')}
              placeholder="BARRIL10"
            />
          </div>
          <div className="field">
            <label htmlFor="cf-kind">Tipo</label>
            <select className="select" id="cf-kind" value={form.kind} onChange={set('kind')}>
              {Object.entries(KIND_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {form.kind === 'porcentaje' || form.kind === 'valor' ? (
            <div className="field">
              <label htmlFor="cf-value">
                {form.kind === 'porcentaje' ? 'Porcentaje' : 'Valor del descuento'}
              </label>
              <input
                className="input"
                id="cf-value"
                inputMode="numeric"
                value={form.value}
                onChange={set('value')}
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="cf-min">Pedido mínimo</label>
            <input
              className="input"
              id="cf-min"
              inputMode="numeric"
              value={form.min_total}
              onChange={set('min_total')}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="cf-title">Texto para el cliente</label>
            <input
              className="input"
              id="cf-title"
              maxLength={60}
              value={form.title}
              onChange={set('title')}
              placeholder={form.kind === 'regalo' ? 'Limonada de cortesía' : '10% en tu primer pedido'}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="cf-detail">Condiciones</label>
            <input
              className="input"
              id="cf-detail"
              maxLength={160}
              value={form.detail}
              onChange={set('detail')}
              placeholder="En pedidos desde $30.000."
            />
          </div>
          <div className="field">
            <label htmlFor="cf-start">Desde</label>
            <input
              className="input"
              id="cf-start"
              type="date"
              value={form.starts_on}
              onChange={set('starts_on')}
            />
          </div>
          <div className="field">
            <label htmlFor="cf-end">Hasta</label>
            <input className="input" id="cf-end" type="date" value={form.ends_on} onChange={set('ends_on')} />
          </div>
          <div className="field">
            <label htmlFor="cf-max">Usos máximos (vacío = sin límite)</label>
            <input
              className="input"
              id="cf-max"
              inputMode="numeric"
              value={form.max_uses}
              onChange={set('max_uses')}
            />
          </div>
          <label className="check span-2">
            <input
              type="checkbox"
              checked={form.once_per_phone}
              onChange={(event) => setForm({ ...form, once_per_phone: event.target.checked })}
            />{' '}
            Un uso por celular
          </label>
          <label className="check span-2">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(event) => setForm({ ...form, visible: event.target.checked })}
            />{' '}
            Mostrar en la página
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cupón'}
        </button>
      </form>
    </Modal>
  );
}
