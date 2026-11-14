import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { inPurchaseUnits, qtyText, servingsLeft, supplyLevel } from '../core/inventory';
import {
  loadInventory,
  loadMoves,
  registerSupply,
  removeRecipeLine,
  saveSupply,
  setRecipeLine,
  type Recipe,
  type Supply,
  type SupplyMove,
} from './inventory-data';
import { Modal, useToast } from './ui';

type Tab = 'insumos' | 'recetas' | 'movimientos';
type Action = { supply: Supply; kind: 'compra' | 'merma' | 'ajuste' };
const LEVEL_LABEL = { agotado: 'Agotado', bajo: 'Por agotarse', ok: 'Bien' } as const;
const MOVE_LABEL: Record<SupplyMove['kind'], string> = {
  compra: 'Compra',
  venta: 'Pedido',
  devolucion: 'Devolución (cancelado)',
  merma: 'Merma',
  ajuste: 'Conteo',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });

/** Inventario de insumos (F8b, D30): se descuenta al entrar cada pedido y vuelve si se cancela. */
export function Inventario({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('insumos');
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; combo_price: number | null }>>(
    [],
  );
  const [moves, setMoves] = useState<SupplyMove[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState<Supply | 'nuevo' | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([loadInventory(restaurantId), loadMoves(restaurantId)])
        .then(([inventory, list]) => {
          setSupplies(inventory.supplies);
          setRecipes(inventory.recipes);
          setProducts(inventory.products);
          setMoves(list);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const low = supplies.filter(
    (supply) =>
      supply.active &&
      supplyLevel({ id: supply.id, stock: supply.stock, minStock: supply.min_stock }) !== 'ok',
  );
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Inventario">
          {(
            [
              ['insumos', 'Insumos'],
              ['recetas', 'Recetas'],
              ['movimientos', 'Movimientos'],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
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
        <span className="grow" />
        {tab === 'insumos' ? (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing('nuevo')}>
            ＋ Insumo
          </button>
        ) : null}
      </div>
      {low.length ? (
        <div className="note note-warn" role="status">
          ⚠️ <b>{low.length} insumos por agotarse:</b> {low.map((supply) => supply.name).join(', ')}.
        </div>
      ) : null}

      {tab === 'insumos' ? (
        <section className="card">
          <div className="note">
            Cada pedido descuenta sus insumos apenas entra (según la receta) y los devuelve si se cancela. Si
            no alcanza, ese producto sale como agotado en la página.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th className="num">Hay</th>
                  <th className="num">Mínimo</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {supplies.map((supply) => {
                  const level = supplyLevel({
                    id: supply.id,
                    stock: supply.stock,
                    minStock: supply.min_stock,
                  });
                  return (
                    <tr key={supply.id} data-testid={`insumo-${supply.name}`}>
                      <td>
                        <b>{supply.name}</b>
                        <small className="block muted">
                          1 {supply.purchase_unit} = {qtyText(supply.per_purchase)} {supply.unit}
                        </small>
                      </td>
                      <td className="num">
                        <b>
                          {qtyText(supply.stock)} {supply.unit}
                        </b>
                        <small className="block muted">
                          ≈ {qtyText(inPurchaseUnits(supply.stock, supply.per_purchase))}{' '}
                          {supply.purchase_unit}
                        </small>
                      </td>
                      <td className="num">{qtyText(supply.min_stock)}</td>
                      <td>
                        <span
                          className={`st ${level === 'ok' ? 'st-entregado' : level === 'bajo' ? 'st-confirmado' : 'st-cancelado'}`}
                        >
                          {LEVEL_LABEL[level]}
                        </span>
                      </td>
                      <td>
                        <div className="btn-row nowrap">
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            onClick={() => setAction({ supply, kind: 'compra' })}
                          >
                            Compra
                          </button>
                          <button
                            className="btn btn-soft btn-sm"
                            type="button"
                            onClick={() => setAction({ supply, kind: 'merma' })}
                          >
                            Merma
                          </button>
                          <button
                            className="btn btn-soft btn-sm"
                            type="button"
                            onClick={() => setAction({ supply, kind: 'ajuste' })}
                          >
                            Conteo
                          </button>
                          <button
                            className="btn btn-soft btn-sm"
                            type="button"
                            onClick={() => setEditing(supply)}
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'recetas' ? (
        <Recipes
          restaurantId={restaurantId}
          supplies={supplies}
          recipes={recipes}
          products={products}
          onChanged={() => void reload()}
        />
      ) : null}

      {tab === 'movimientos' ? (
        <section className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Insumo</th>
                  <th>Movimiento</th>
                  <th className="num">Cantidad</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((move) => (
                  <tr key={move.id}>
                    <td>{when(move.at)}</td>
                    <td>{move.supplies?.name}</td>
                    <td>{MOVE_LABEL[move.kind]}</td>
                    <td className={`num ${move.qty < 0 ? 'down' : 'up'}`}>
                      {move.qty > 0 ? '+' : ''}
                      {qtyText(move.qty)} {move.supplies?.unit}
                    </td>
                    <td>{move.orders?.code ?? move.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {action ? (
        <MoveForm action={action} onClose={() => setAction(null)} onDone={() => void reload()} />
      ) : null}
      {editing ? (
        <SupplyForm
          restaurantId={restaurantId}
          supply={editing === 'nuevo' ? null : editing}
          position={supplies.length}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </>
  );
}

function MoveForm({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { supply, kind } = action;
  const [qty, setQty] = useState(kind === 'ajuste' ? String(supply.stock) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const amount = Number(qty.replace(',', '.'));
  const copy = {
    compra: {
      title: `Compra de ${supply.name}`,
      label: `¿Cuántos ${supply.purchase_unit} compraste?`,
      hint:
        Number.isFinite(amount) && amount > 0
          ? `Suma ${qtyText(amount * supply.per_purchase)} ${supply.unit} al inventario.`
          : `1 ${supply.purchase_unit} = ${qtyText(supply.per_purchase)} ${supply.unit}.`,
    },
    merma: {
      title: `Merma de ${supply.name}`,
      label: `¿Cuántos ${supply.unit} se dañaron o perdieron?`,
      hint: 'Resta del inventario y queda registrado.',
    },
    ajuste: {
      title: `Conteo de ${supply.name}`,
      label: `¿Cuántos ${supply.unit} hay contados?`,
      hint: `El sistema dice ${qtyText(supply.stock)}; queda lo que cuentes.`,
    },
  }[kind];
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!Number.isFinite(amount) || amount < 0 || (kind !== 'ajuste' && amount === 0))
      return setError('Escribe una cantidad válida.');
    try {
      const stock = await registerSupply(supply.id, kind, amount, note);
      toast(`${supply.name}: quedan ${qtyText(stock)} ${supply.unit}`);
      onDone();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
  }
  return (
    <Modal title={copy.title} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="mv-qty">{copy.label}</label>
          <input
            className="input"
            id="mv-qty"
            inputMode="decimal"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
          <span className="hint">{copy.hint}</span>
        </div>
        <div className="field">
          <label htmlFor="mv-note">Nota</label>
          <input
            className="input"
            id="mv-note"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={kind === 'compra' ? 'Proveedor, factura…' : ''}
          />
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary btn-block" type="submit">
          Guardar
        </button>
      </form>
    </Modal>
  );
}

function SupplyForm({
  restaurantId,
  supply,
  position,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  supply: Supply | null;
  position: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: supply?.name ?? '',
    unit: supply?.unit ?? 'unidad',
    purchase_unit: supply?.purchase_unit ?? 'paquete',
    per_purchase: supply ? String(supply.per_purchase) : '1',
    min_stock: supply ? String(supply.min_stock) : '0',
    active: supply?.active ?? true,
  });
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });
  const num = (text: string) => Number(text.replace(',', '.'));
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (form.name.trim().length < 2 || !form.unit.trim() || !form.purchase_unit.trim())
      return setError('Nombre y unidades son obligatorios.');
    if (!(num(form.per_purchase) > 0) || num(form.min_stock) < 0)
      return setError('Revisa la equivalencia y el mínimo.');
    try {
      await saveSupply(restaurantId, {
        ...(supply ? { id: supply.id } : { position }),
        name: form.name.trim(),
        unit: form.unit.trim(),
        purchase_unit: form.purchase_unit.trim(),
        per_purchase: num(form.per_purchase),
        min_stock: num(form.min_stock),
        active: form.active,
      });
      toast('Insumo guardado');
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
  }
  return (
    <Modal title={supply ? `Editar · ${supply.name}` : 'Nuevo insumo'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field span-2">
            <label htmlFor="sp-name">Nombre</label>
            <input
              className="input"
              id="sp-name"
              maxLength={60}
              value={form.name}
              onChange={set('name')}
              placeholder="Lechuga"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-unit">Unidad de uso</label>
            <input
              className="input"
              id="sp-unit"
              maxLength={20}
              value={form.unit}
              onChange={set('unit')}
              placeholder="hoja"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-punit">Unidad de compra</label>
            <input
              className="input"
              id="sp-punit"
              maxLength={20}
              value={form.purchase_unit}
              onChange={set('purchase_unit')}
              placeholder="lechuga"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-per">
              1 {form.purchase_unit || 'compra'} = ¿cuántos {form.unit || 'de uso'}?
            </label>
            <input
              className="input"
              id="sp-per"
              inputMode="decimal"
              value={form.per_purchase}
              onChange={set('per_purchase')}
            />
          </div>
          <div className="field">
            <label htmlFor="sp-min">Avisar cuando queden (mínimo)</label>
            <input
              className="input"
              id="sp-min"
              inputMode="decimal"
              value={form.min_stock}
              onChange={set('min_stock')}
            />
          </div>
          <label className="check span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
            />{' '}
            En uso
          </label>
        </div>
        {!supply ? (
          <p className="hint">Empieza en 0: registra la primera compra o un conteo después de crearlo.</p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary btn-block" type="submit">
          Guardar insumo
        </button>
      </form>
    </Modal>
  );
}

function Recipes({
  restaurantId,
  supplies,
  recipes,
  products,
  onChanged,
}: {
  restaurantId: string;
  supplies: Supply[];
  recipes: Recipe[];
  products: Array<{ id: string; name: string; combo_price: number | null }>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [newSupply, setNewSupply] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newCombo, setNewCombo] = useState(false);
  const product = products.find((item) => item.id === productId);
  const lines = recipes.filter((line) => line.product_id === productId);
  const stocks = useMemo(
    () => supplies.map((supply) => ({ id: supply.id, stock: supply.stock, minStock: supply.min_stock })),
    [supplies],
  );
  const asLines = lines.map((line) => ({
    supplyId: line.supply_id,
    qty: line.qty,
    comboOnly: line.combo_only,
  }));
  const sola = servingsLeft(asLines, stocks);
  const combo = product?.combo_price ? servingsLeft(asLines, stocks, true) : null;
  const run = async (work: Promise<void>, message: string) => {
    try {
      await work;
      toast(message);
      onChanged();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <div className="field">
          <label htmlFor="rc-product">Producto</label>
          <select
            className="select"
            id="rc-product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="servings" data-testid="alcanza">
          {sola === null ? (
            <span className="muted">Sin receta: no se controla el inventario de este producto.</span>
          ) : (
            <>
              <b>Alcanza para {sola}</b>
              {combo !== null ? <span className="muted"> · {combo} en combo</span> : null}
            </>
          )}
        </div>
      </div>
      <div className="rows">
        {lines.map((line) => {
          const supply = supplies.find((item) => item.id === line.supply_id);
          return (
            <div className="row" key={`${line.supply_id}-${line.combo_only}`}>
              <div>
                <b>{supply?.name}</b>
                <small>{line.combo_only ? 'Solo en combo' : 'Siempre'}</small>
              </div>
              <div className="right">
                <input
                  className="input price-in"
                  inputMode="decimal"
                  aria-label={`Cantidad de ${supply?.name}`}
                  defaultValue={qtyText(line.qty)}
                  onBlur={(event) => {
                    const qty = Number(event.target.value.replace(',', '.'));
                    if (qty > 0 && qty !== line.qty)
                      void run(setRecipeLine(restaurantId, { ...line, qty }), 'Receta actualizada');
                  }}
                />
                <span className="muted">{supply?.unit}</span>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`Quitar ${supply?.name}`}
                  onClick={() => void run(removeRecipeLine(line), 'Quitado de la receta')}
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <form
        className="inline-add"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(newQty.replace(',', '.'));
          if (!newSupply || !(qty > 0)) return toast('Elige el insumo y la cantidad.');
          void run(
            setRecipeLine(restaurantId, {
              product_id: productId,
              supply_id: newSupply,
              qty,
              combo_only: newCombo,
            }),
            'Agregado a la receta',
          );
          setNewSupply('');
        }}
      >
        <select
          className="select"
          aria-label="Insumo para la receta"
          value={newSupply}
          onChange={(event) => setNewSupply(event.target.value)}
        >
          <option value="">Agregar insumo…</option>
          {supplies.map((supply) => (
            <option key={supply.id} value={supply.id}>
              {supply.name} ({supply.unit})
            </option>
          ))}
        </select>
        <input
          className="input price-in"
          aria-label="Cantidad por unidad"
          inputMode="decimal"
          value={newQty}
          onChange={(event) => setNewQty(event.target.value)}
        />
        {product?.combo_price ? (
          <label className="chip-check">
            <input
              type="checkbox"
              checked={newCombo}
              onChange={(event) => setNewCombo(event.target.checked)}
            />{' '}
            Solo en combo
          </label>
        ) : null}
        <button className="btn btn-soft" type="submit">
          Agregar
        </button>
      </form>
    </section>
  );
}
