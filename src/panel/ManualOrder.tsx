import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { formatCop as money } from '../core/money';
import { normalizeColombianMobile } from '../core/phone';
import { createManualOrder, loadManualCatalog, type ManualCatalog, type ManualOrderInput } from './data';
import { Modal, useToast } from './ui';

/** Pedido que llega por WhatsApp directo o por llamada (D10): queda en el tablero y suma en ventas. */
export function ManualOrder({
  restaurantId,
  onClose,
  onCreated,
}: {
  restaurantId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<ManualCatalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [form, setForm] = useState({
    channel: 'whatsapp',
    phone: '',
    name: '',
    address: '',
    zone: '',
    payment: '',
  });
  useEffect(() => {
    loadManualCatalog(restaurantId)
      .then((data) => {
        setCatalog(data);
        setForm((current) => ({
          ...current,
          zone: data.zones[0]?.id ?? '',
          payment: data.payments[0]?.code ?? '',
        }));
      })
      .catch((failure: Error) => setError(failure.message));
  }, [restaurantId]);
  const subtotal = useMemo(
    () => (catalog?.products ?? []).reduce((sum, product) => sum + (qty[product.id] ?? 0) * product.price, 0),
    [catalog, qty],
  );
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const phone = normalizeColombianMobile(form.phone);
    const items = Object.entries(qty)
      .filter(([, count]) => count > 0)
      .map(([product_id, count]) => ({ product_id, qty: count, combo: false }));
    if (!phone || form.name.trim().length < 2 || form.address.trim().length < 8 || !items.length) {
      setError('Completa celular, nombre, dirección y al menos un producto.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const code = await createManualOrder({
        channel: form.channel as ManualOrderInput['channel'],
        customer: { name: form.name.trim(), phone, address: form.address.trim(), zone_id: form.zone },
        payment_code: form.payment,
        items,
      });
      toast(`Pedido ${code} creado`);
      onCreated();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo crear el pedido.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo pedido manual" onClose={onClose}>
      {!catalog ? (
        <p className="muted">{error || 'Cargando la carta…'}</p>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-2">
            <div className="field">
              <label htmlFor="mo-ch">Canal</label>
              <select className="select" id="mo-ch" value={form.channel} onChange={set('channel')}>
                <option value="whatsapp">WhatsApp</option>
                <option value="manual">Llamada</option>
                <option value="rappi">Rappi</option>
                <option value="didi">DiDi</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mo-phone">Celular</label>
              <input
                className="input"
                id="mo-phone"
                inputMode="numeric"
                value={form.phone}
                onChange={set('phone')}
                placeholder="3001234567"
              />
            </div>
            <div className="field">
              <label htmlFor="mo-name">Nombre</label>
              <input className="input" id="mo-name" value={form.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label htmlFor="mo-zone">Localidad</label>
              <select className="select" id="mo-zone" value={form.zone} onChange={set('zone')}>
                {catalog.zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name} · {money(zone.fee)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="mo-addr">Dirección y barrio</label>
              <input className="input" id="mo-addr" value={form.address} onChange={set('address')} />
            </div>
            <div className="field">
              <label htmlFor="mo-pay">Pago</label>
              <select className="select" id="mo-pay" value={form.payment} onChange={set('payment')}>
                {catalog.payments.map((method) => (
                  <option key={method.code} value={method.code}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="field">
            <legend>Productos</legend>
            <div className="picker">
              {catalog.products
                .filter((product) => product.available)
                .map((product) => (
                  <div className="pick" key={product.id}>
                    <span>
                      {product.name} <small className="muted">{money(product.price)}</small>
                    </span>
                    <span className="qty-mini">
                      <button
                        type="button"
                        aria-label={`Quitar ${product.name}`}
                        onClick={() =>
                          setQty({ ...qty, [product.id]: Math.max(0, (qty[product.id] ?? 0) - 1) })
                        }
                      >
                        −
                      </button>
                      <b>{qty[product.id] ?? 0}</b>
                      <button
                        type="button"
                        aria-label={`Agregar ${product.name}`}
                        onClick={() => setQty({ ...qty, [product.id]: (qty[product.id] ?? 0) + 1 })}
                      >
                        ＋
                      </button>
                    </span>
                  </div>
                ))}
            </div>
          </fieldset>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Crear pedido · {money(subtotal)}
          </button>
        </form>
      )}
    </Modal>
  );
}
