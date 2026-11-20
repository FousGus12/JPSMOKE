import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  costFromPurchase,
  costPerUse,
  inPurchaseUnits,
  inputText,
  margin,
  parseInput,
  qtyText,
  recipeCost,
  servingsLeft,
  shoppingList,
  shoppingText,
  suggestedPrice,
  supplyLevel,
  whatsappShareUrl,
  type RecipeLine,
  type SupplyCost,
} from '../core/inventory';
import { formatCop as money } from '../core/money';
import {
  loadInventory,
  loadMoves,
  registerSupply,
  removeRecipeLine,
  saveSupply,
  saveTargetMargin,
  setRecipeLine,
  type InventoryProduct,
  type MoveKind,
  type Recipe,
  type Supply,
  type SupplyMove,
} from './inventory-data';
import { Modal, useToast } from './ui';

type Tab = 'insumos' | 'recetas' | 'movimientos';
type Action = { supply: Supply; kind: 'compra' | 'merma' | 'inicial' };
const LEVEL_LABEL = { agotado: 'Agotado', bajo: 'Por agotarse', ok: 'Bien' } as const;
const MOVE_LABEL: Record<MoveKind, string> = {
  compra: 'Compra',
  venta: 'Pedido',
  devolucion: 'Devolución (cancelado)',
  merma: 'Merma',
  ajuste: 'Conteo', // movimientos anteriores a D46
  inicial: 'Inicial',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
const asCost = (supply: Supply): SupplyCost => ({
  id: supply.id,
  name: supply.name,
  cost: supply.cost,
  costBasis: supply.cost_basis,
  perPurchase: supply.per_purchase,
});
/** "$12.000 por paquete" según la base del costo; null si no tiene. */
const costText = (supply: Supply) =>
  supply.cost === null
    ? null
    : `${money(supply.cost)} por ${supply.cost_basis === 'compra' ? supply.purchase_unit : supply.unit}`;

/** Inventario de insumos (F8b, D30, D46, D49): se descuenta al entrar cada pedido y vuelve si se cancela. */
export function Inventario({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('insumos');
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [targetMargin, setTargetMargin] = useState(65);
  const [moves, setMoves] = useState<SupplyMove[]>([]);
  const [moveSupply, setMoveSupply] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [editing, setEditing] = useState<Supply | 'nuevo' | null>(null);
  const [shopping, setShopping] = useState(false);

  const reloadMoves = useCallback(
    () =>
      loadMoves(restaurantId, moveSupply)
        .then(setMoves)
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, moveSupply, toast],
  );
  const reload = useCallback(
    () =>
      loadInventory(restaurantId)
        .then((inventory) => {
          setSupplies(inventory.supplies);
          setRecipes(inventory.recipes);
          setProducts(inventory.products);
          setTargetMargin(inventory.targetMargin);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    void reloadMoves();
  }, [reloadMoves]);

  const low = supplies.filter(
    (supply) =>
      supply.active &&
      supplyLevel({ id: supply.id, stock: supply.stock, minStock: supply.min_stock }) !== 'ok',
  );
  const list = useMemo(
    () =>
      shoppingList(
        supplies.map((supply) => ({
          ...asCost(supply),
          stock: supply.stock,
          minStock: supply.min_stock,
          initialStock: supply.initial_stock,
          unit: supply.unit,
          purchaseUnit: supply.purchase_unit,
          active: supply.active,
        })),
      ),
    [supplies],
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
        {tab === 'insumos' && list.items.length ? (
          <button className="btn btn-soft btn-sm" type="button" onClick={() => setShopping(true)}>
            Lista de compras
          </button>
        ) : null}
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
            <table className="inv-supplies">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th className="num">Inicial</th>
                  <th className="num">Hay ahora</th>
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
                        <small className={`block ${supply.cost === null ? 'inv-missing' : 'muted'}`}>
                          {costText(supply) ?? 'Sin costo'}
                        </small>
                      </td>
                      <td className="num" data-label="Inicial">
                        {supply.initial_stock === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {qtyText(supply.initial_stock)} {supply.unit}
                            {supply.initial_at ? (
                              <small className="block muted">{day(supply.initial_at)}</small>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="num" data-label="Hay ahora">
                        <b>
                          {qtyText(supply.stock)} {supply.unit}
                        </b>
                        <small className="block muted">
                          ≈ {qtyText(inPurchaseUnits(supply.stock, supply.per_purchase))}{' '}
                          {supply.purchase_unit}
                        </small>
                      </td>
                      <td className="num" data-label="Mínimo">
                        {qtyText(supply.min_stock)}
                      </td>
                      <td className="inv-level">
                        <span
                          className={`st ${level === 'ok' ? 'st-entregado' : level === 'bajo' ? 'st-confirmado' : 'st-cancelado'}`}
                        >
                          {LEVEL_LABEL[level]}
                        </span>
                      </td>
                      <td className="inv-actions">
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
                            onClick={() => setAction({ supply, kind: 'inicial' })}
                          >
                            Inicial
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
          targetMargin={targetMargin}
          onMargin={setTargetMargin}
          onChanged={() => void reload()}
        />
      ) : null}

      {tab === 'movimientos' ? (
        <section className="card">
          <div className="card-head">
            <div className="field">
              <label htmlFor="mv-filter">Insumo</label>
              <select
                className="select"
                id="mv-filter"
                value={moveSupply}
                onChange={(event) => setMoveSupply(event.target.value)}
              >
                <option value="">Todos</option>
                {supplies.map((supply) => (
                  <option key={supply.id} value={supply.id}>
                    {supply.name}
                  </option>
                ))}
              </select>
            </div>
            <small className="muted">Últimos 100 movimientos{moveSupply ? ' de este insumo' : ''}.</small>
          </div>
          {!moves.length ? <p className="muted">Sin movimientos.</p> : null}
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
        <MoveForm
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            void reload();
            void reloadMoves();
          }}
        />
      ) : null}
      {shopping && list.items.length ? (
        <ShoppingModal list={list} onClose={() => setShopping(false)} />
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

/** Lista de compras (D66): copiar o compartir por WhatsApp sin destinatario. */
function ShoppingModal({ list, onClose }: { list: ReturnType<typeof shoppingList>; onClose: () => void }) {
  const toast = useToast();
  const text = shoppingText(
    list,
    new Date().toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    }),
    money,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast('Lista copiada.');
    } catch {
      // Respaldo: portapapeles sin permiso o fuera de HTTPS.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'inv-copy-fallback';
      document.body.appendChild(area);
      area.select();
      let ok: boolean;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      document.body.removeChild(area);
      toast(ok ? 'Lista copiada.' : 'No pudimos copiar. Usa Compartir por WhatsApp.');
    }
  }
  return (
    <Modal title="Lista de compras" onClose={onClose}>
      <div className="table-wrap">
        <table className="inv-shopping">
          <thead>
            <tr>
              <th>Insumo</th>
              <th className="num">Comprar</th>
              <th className="num">Costo</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <b>{item.name}</b>
                </td>
                <td className="num" data-label="Comprar">
                  {qtyText(item.qty)} {item.purchaseUnit}
                </td>
                <td className={`num ${item.cost === null ? 'inv-missing' : ''}`} data-label="Costo">
                  {item.cost === null ? 'sin costo' : money(item.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inv-shopping-total">
        <b>Total estimado: {money(list.total)}</b>
        {list.withoutCost ? (
          <small className="block inv-missing">Sin contar {list.withoutCost} insumo(s) sin costo.</small>
        ) : null}
      </p>
      <div className="btn-row">
        <button className="btn btn-soft" type="button" onClick={() => void copy()}>
          Copiar
        </button>
        <a
          className="btn btn-primary"
          href={whatsappShareUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Compartir por WhatsApp
        </a>
      </div>
    </Modal>
  );
}

function MoveForm({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { supply, kind } = action;
  // El costo a mostrar en la compra siempre es por unidad de compra (lo que dice la factura).
  const currentPaid =
    supply.cost === null
      ? ''
      : inputText(supply.cost_basis === 'compra' ? supply.cost : supply.cost * supply.per_purchase);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [updateCost, setUpdateCost] = useState(false);
  const [paid, setPaid] = useState(currentPaid);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = parseInput(qty);
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
      hint: `Resta de lo que hay ahora (${qtyText(supply.stock)} ${supply.unit}) y queda registrado.`,
    },
    inicial: {
      title: `Inicial de ${supply.name}`,
      label: `¿Con cuántos ${supply.unit} arrancas?`,
      hint: `Con cuánto arrancas (p. ej. 15 ${supply.unit}). Los pedidos y la merma restan de lo que hay ahora, no del inicial. También deja «Hay ahora» en ese número.`,
    },
  }[kind];
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    if (!Number.isFinite(amount) || amount < 0 || (kind !== 'inicial' && amount === 0))
      return setError('Escribe una cantidad válida.');
    let cost: number | null = null;
    if (kind === 'compra' && updateCost) {
      const value = parseInput(paid);
      if (!Number.isFinite(value) || value <= 0 || value > 100_000_000)
        return setError('Escribe el valor pagado en pesos.');
      cost = costFromPurchase(value, supply.cost_basis, supply.per_purchase);
    }
    setBusy(true);
    try {
      const stock = await registerSupply(supply.id, kind, amount, note, cost);
      toast(`${supply.name}: quedan ${qtyText(stock)} ${supply.unit}`);
      onDone();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      setBusy(false);
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
        {kind === 'compra' ? (
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={updateCost}
                onChange={(event) => setUpdateCost(event.target.checked)}
              />{' '}
              Actualizar costo
            </label>
            {updateCost ? (
              <>
                <label htmlFor="mv-cost">Valor pagado por {supply.purchase_unit} (COP)</label>
                <input
                  className="input"
                  id="mv-cost"
                  inputMode="numeric"
                  value={paid}
                  onChange={(event) => setPaid(event.target.value)}
                  placeholder="12000"
                />
                <span className="hint">
                  {supply.cost === null
                    ? 'Este insumo aún no tiene costo.'
                    : `Hoy: ${costText(supply)}${supply.cost_at ? ` (desde el ${day(supply.cost_at)})` : ''}.`}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
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
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
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
    per_purchase: supply ? inputText(supply.per_purchase) : '1',
    min_stock: supply ? inputText(supply.min_stock) : '0',
    active: supply?.active ?? true,
    cost: supply?.cost === null || !supply ? '' : inputText(supply.cost),
    cost_basis: supply?.cost_basis ?? 'compra',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (busy) return;
    if (form.name.trim().length < 2 || !form.unit.trim() || !form.purchase_unit.trim())
      return setError('Nombre y unidades son obligatorios.');
    if (!(parseInput(form.per_purchase) > 0) || !(parseInput(form.min_stock) >= 0))
      return setError('Revisa la equivalencia y el mínimo.');
    const cost = form.cost.trim() ? parseInput(form.cost) : null;
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 100_000_000))
      return setError('Revisa el costo: en pesos, sin puntos.');
    setBusy(true);
    try {
      await saveSupply(
        restaurantId,
        supply?.id ?? null,
        {
          name: form.name.trim(),
          unit: form.unit.trim(),
          purchase_unit: form.purchase_unit.trim(),
          per_purchase: parseInput(form.per_purchase),
          min_stock: parseInput(form.min_stock),
          active: form.active,
          cost,
          cost_basis: form.cost_basis,
        },
        position,
      );
      toast('Insumo guardado');
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      setBusy(false);
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
          <div className="field">
            <label htmlFor="sp-cost">Costo (COP)</label>
            <input
              className="input"
              id="sp-cost"
              inputMode="numeric"
              value={form.cost}
              onChange={set('cost')}
              placeholder="12000"
            />
          </div>
          <div className="field">
            <label htmlFor="sp-basis">Por</label>
            <select
              className="select"
              id="sp-basis"
              value={form.cost_basis}
              onChange={(event) =>
                setForm({ ...form, cost_basis: event.target.value === 'uso' ? 'uso' : 'compra' })
              }
            >
              <option value="compra">{form.purchase_unit || 'unidad de compra'} (compra)</option>
              <option value="uso">{form.unit || 'unidad de uso'} (uso)</option>
            </select>
          </div>
          <p className="hint span-2">
            {supply?.cost_at
              ? `Último precio: ${day(supply.cost_at)}.`
              : 'Sin precio todavía. Con el costo, Recetas calcula el margen de cada producto.'}
          </p>
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
          <p className="hint">Empieza en 0: después de crearlo, registra el inicial o la primera compra.</p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
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
  targetMargin,
  onMargin,
  onChanged,
}: {
  restaurantId: string;
  supplies: Supply[];
  recipes: Recipe[];
  products: InventoryProduct[];
  targetMargin: number;
  onMargin: (value: number) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState('');
  const [newSupply, setNewSupply] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newCombo, setNewCombo] = useState(false);
  // Borrador del margen mientras se escribe; null = muestra el guardado.
  const [marginDraft, setMarginDraft] = useState<string | null>(null);
  const marginText = marginDraft ?? String(targetMargin);
  // Los productos pueden llegar después del primer render: sin elección, el primero.
  const product = products.find((item) => item.id === picked) ?? products[0];
  const productId = product?.id ?? '';
  const lines = recipes.filter((line) => line.product_id === productId);
  const stocks = useMemo(
    () => supplies.map((supply) => ({ id: supply.id, stock: supply.stock, minStock: supply.min_stock })),
    [supplies],
  );
  const costs = useMemo(() => supplies.map(asCost), [supplies]);
  const asLines: RecipeLine[] = lines.map((line) => ({
    supplyId: line.supply_id,
    qty: line.qty,
    comboOnly: line.combo_only,
  }));
  const sola = servingsLeft(asLines, stocks);
  const hasCombo = (product?.combo_price ?? null) !== null;
  const combo = hasCombo ? servingsLeft(asLines, stocks, true) : null;
  const versions = product
    ? [
        { key: 'plato', label: 'Plato', price: product.price, ...recipeCost(asLines, costs) },
        ...(product.combo_price !== null
          ? [
              {
                key: 'combo',
                label: 'Combo',
                price: product.combo_price,
                ...recipeCost(asLines, costs, true),
              },
            ]
          : []),
      ]
    : [];
  const missing = versions.at(-1)?.missing ?? [];
  const run = async (work: Promise<void>, message: string) => {
    try {
      await work;
      toast(message);
      onChanged();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
  };
  async function commitMargin() {
    const value = Number(marginText.trim().replace('%', ''));
    if (value === targetMargin) return setMarginDraft(null);
    if (!Number.isInteger(value) || value < 1 || value > 95) {
      setMarginDraft(null);
      return toast('El margen objetivo va de 1 a 95 %.');
    }
    try {
      await saveTargetMargin(restaurantId, value);
      onMargin(value);
      toast(`Margen objetivo: ${value} %`);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    }
    setMarginDraft(null);
  }
  return (
    <section className="card">
      <div className="card-head">
        <div className="field">
          <label htmlFor="rc-product">Producto</label>
          <select
            className="select"
            id="rc-product"
            value={productId}
            onChange={(event) => setPicked(event.target.value)}
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
          const unitCost = supply ? costPerUse(asCost(supply)) : null;
          return (
            <div className="row" key={`${line.supply_id}-${line.combo_only}`}>
              <div>
                <b>{supply?.name}</b>
                <small>
                  {line.combo_only ? 'Solo en combo' : 'Siempre'}
                  {' · '}
                  {unitCost === null ? (
                    <span className="inv-missing">sin costo</span>
                  ) : (
                    `${money(unitCost * line.qty)} (${money(unitCost)} por ${supply?.unit})`
                  )}
                </small>
              </div>
              <div className="right">
                <input
                  className="input price-in"
                  inputMode="decimal"
                  aria-label={`Cantidad de ${supply?.name}`}
                  defaultValue={inputText(line.qty)}
                  onBlur={(event) => {
                    const qty = parseInput(event.target.value);
                    if (qty > 0 && qty !== line.qty)
                      void run(setRecipeLine(restaurantId, { ...line, qty }), 'Receta actualizada');
                  }}
                />
                <span className="muted inv-unit">{supply?.unit}</span>
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
          const qty = parseInput(newQty);
          if (!productId || !newSupply || !(qty > 0)) return toast('Elige el insumo y la cantidad.');
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
        {hasCombo ? (
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

      {product && lines.length ? (
        <div className="inv-cost" data-testid="costo-receta">
          <div className="inv-cost-head">
            <h3>Costo y margen</h3>
            <div className="inv-target">
              <label htmlFor="rc-margin">Margen objetivo</label>
              <input
                className="input price-in"
                id="rc-margin"
                inputMode="numeric"
                value={marginText}
                onChange={(event) => setMarginDraft(event.target.value)}
                onBlur={() => void commitMargin()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              <span className="muted">%</span>
            </div>
          </div>
          {missing.length ? (
            <div className="note note-warn" role="status">
              ⚠️ Falta el costo de: <b>{missing.join(', ')}</b>. El costo y el margen salen incompletos.
            </div>
          ) : null}
          <div className="inv-cost-grid">
            {versions.map((version) => {
              const complete = !version.missing.length;
              const result = margin(version.price, version.cost);
              const suggested = complete ? suggestedPrice(version.cost, targetMargin) : null;
              return (
                <dl className="inv-cost-card" key={version.key} data-testid={`costo-${version.key}`}>
                  <dt>{version.label}</dt>
                  <dd>
                    <span>Costo</span>
                    <b>
                      {complete ? '' : 'desde '}
                      {money(version.cost)}
                    </b>
                  </dd>
                  <dd>
                    <span>Precio de venta</span>
                    <b>{money(version.price)}</b>
                  </dd>
                  <dd>
                    <span>Margen</span>
                    {complete ? (
                      <b className={result.amount < 0 ? 'down' : ''}>
                        {money(result.amount)}
                        {result.percent === null ? '' : ` · ${qtyText(result.percent)} %`}
                      </b>
                    ) : (
                      <b className="muted">—</b>
                    )}
                  </dd>
                  <dd>
                    <span>Precio sugerido ({targetMargin} %)</span>
                    <b>{suggested === null ? '—' : money(suggested)}</b>
                  </dd>
                </dl>
              );
            })}
          </div>
          <p className="inv-cost-foot">
            <span className="muted">El precio se cambia en la Carta; aquí solo se sugiere.</span>
            <a className="btn btn-soft btn-sm" href="#carta">
              Cambiar precio en Carta
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}
