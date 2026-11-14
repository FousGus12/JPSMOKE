import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { formatCop as money } from '../core/money';
import {
  createCategory,
  createProduct,
  loadCatalog,
  photoUrl,
  removeProduct,
  slugify,
  updateCategory,
  updateProduct,
  uploadPhoto,
  type EditCategory,
  type EditProduct,
} from './editor';
import { Modal, useToast } from './ui';

const toNumber = (text: string) => Number(text.replace(/\D/g, '')) || 0;

/** Carta y precios (F6): lo de disponibilidad y precio se ve en el sitio al instante; nombres, fotos y textos al publicar. */
export function Carta({ restaurantId }: { restaurantId: string }) {
  const toast = useToast();
  const [categories, setCategories] = useState<EditCategory[]>([]);
  const [products, setProducts] = useState<EditProduct[]>([]);
  const [editing, setEditing] = useState<EditProduct | 'nuevo' | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    () =>
      loadCatalog(restaurantId)
        .then((data) => {
          setCategories(data.categories);
          setProducts(data.products);
          setLoaded(true);
        })
        .catch((failure: unknown) =>
          toast(failure instanceof Error ? failure.message : 'No pudimos cargar la carta.'),
        ),
    [restaurantId, toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function patch(product: EditProduct, change: Partial<EditProduct>, message: string) {
    if (change.hero && products.filter((item) => item.hero).length >= 4) {
      toast('El inicio muestra 4 productos: quita uno antes de agregar otro.');
      return;
    }
    setProducts((list) => list.map((item) => (item.id === product.id ? { ...item, ...change } : item)));
    try {
      await updateProduct(product.id, change);
      toast(message);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      void reload();
    }
  }

  async function addCategory() {
    const name = prompt('Nombre de la nueva categoría');
    if (!name?.trim()) return;
    try {
      await createCategory(restaurantId, name, categories.length);
      toast('Categoría creada');
      void reload();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo crear.');
    }
  }

  if (!loaded) return <p className="muted">Cargando la carta…</p>;
  return (
    <>
      <div className="toolbar">
        <div className="note grow">
          <b>Precio, agotado y destacados</b> se ven en la página al instante.{' '}
          <b>Nombres, fotos y productos nuevos</b> salen al tocar <b>Publicar</b> en Editar página.
        </div>
        <button className="btn btn-soft btn-sm" type="button" onClick={() => void addCategory()}>
          ＋ Categoría
        </button>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setEditing('nuevo')}>
          ＋ Producto
        </button>
      </div>
      {categories.map((category) => {
        const items = products.filter((product) => product.category_id === category.id);
        return (
          <section className="card" key={category.id} aria-label={category.name}>
            <div className="card-head">
              <h2>
                {category.emoji} {category.name}
              </h2>
              <label className="chip-check">
                <input
                  type="checkbox"
                  checked={category.visible}
                  onChange={(event) => {
                    const visible = event.target.checked;
                    setCategories((list) =>
                      list.map((item) => (item.id === category.id ? { ...item, visible } : item)),
                    );
                    void updateCategory(category.id, { visible }).then(() =>
                      toast(visible ? 'Categoría visible' : 'Categoría oculta'),
                    );
                  }}
                />{' '}
                Visible
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Sola</th>
                    <th className="num">Combo</th>
                    <th>Disponible</th>
                    <th>Destacado</th>
                    <th>Inicio</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        Sin productos
                      </td>
                    </tr>
                  ) : null}
                  {items.map((product) => (
                    <tr key={product.id} data-testid={`fila-${product.slug}`}>
                      <td>
                        <div className="cell-name">
                          {product.image_path ? (
                            <img className="thumb" src={photoUrl(product.image_path) ?? ''} alt="" />
                          ) : (
                            <span className="thumb" />
                          )}
                          <div>
                            <b>{product.name}</b>
                            <small>{product.visible ? (product.badge ?? '') : 'Oculto en la página'}</small>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        <PriceInput
                          key={`p-${product.price}`}
                          label={`Precio de ${product.name}`}
                          value={product.price}
                          onSave={(price) =>
                            void patch(product, { price }, `Precio actualizado a ${money(price)}`)
                          }
                        />
                      </td>
                      <td className="num">
                        {product.combo_price !== null ? (
                          <PriceInput
                            key={`c-${product.combo_price}`}
                            label={`Precio combo de ${product.name}`}
                            value={product.combo_price}
                            onSave={(combo) =>
                              void patch(
                                product,
                                { combo_price: combo },
                                `Combo actualizado a ${money(combo)}`,
                              )
                            }
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Switch
                          label={`${product.name} disponible`}
                          checked={product.available}
                          onChange={(available) =>
                            void patch(
                              product,
                              { available },
                              available ? 'Disponible de nuevo' : 'Marcado como agotado',
                            )
                          }
                        />
                      </td>
                      <td>
                        <Switch
                          label={`${product.name} destacado`}
                          checked={product.featured}
                          onChange={(featured) =>
                            void patch(
                              product,
                              { featured },
                              featured ? 'Sale en el arsenal pesado' : 'Quitado de destacados',
                            )
                          }
                        />
                      </td>
                      <td>
                        <Switch
                          label={`${product.name} en el inicio`}
                          checked={product.hero}
                          onChange={(hero) =>
                            void patch(product, { hero }, hero ? 'Sale en el inicio' : 'Quitado del inicio')
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-soft btn-sm"
                          type="button"
                          onClick={() => setEditing(product)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {editing ? (
        <ProductForm
          restaurantId={restaurantId}
          categories={categories}
          product={editing === 'nuevo' ? null : editing}
          position={products.length}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span />
    </label>
  );
}

function PriceInput({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      className="input price-in"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = toNumber(text);
        if (next > 0 && next !== value) onSave(next);
        else setText(String(value));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

function ProductForm({
  restaurantId,
  categories,
  product,
  position,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  categories: EditCategory[];
  product: EditProduct | null;
  position: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: product?.name ?? '',
    category_id: product?.category_id ?? categories[0]?.id ?? '',
    badge: product?.badge ?? '',
    description: product?.description ?? '',
    price: product ? String(product.price) : '',
    combo: product?.combo_price ? String(product.combo_price) : '',
    visible: product?.visible ?? true,
  });
  const [image, setImage] = useState<string | null>(product?.image_path ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm({ ...form, [key]: event.target.value });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setImage(await uploadPhoto(restaurantId, file));
      toast('Foto subida, liviana y sin metadatos');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo subir la foto.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const price = toNumber(form.price);
    if (form.name.trim().length < 2 || !price || !form.category_id) {
      setError('Nombre, categoría y precio son obligatorios.');
      return;
    }
    const data = {
      name: form.name.trim(),
      category_id: form.category_id,
      badge: form.badge.trim() || null,
      description: form.description.trim(),
      price,
      combo_price: toNumber(form.combo) || null,
      image_path: image,
      visible: form.visible,
    };
    setBusy(true);
    setError('');
    try {
      if (product) await updateProduct(product.id, data);
      else
        await createProduct(restaurantId, {
          ...data,
          slug: slugify(data.name),
          available: true,
          featured: false,
          hero: false,
          position,
        });
      toast('Producto guardado');
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!product || !confirm(`¿Quitar ${product.name} de la carta?`)) return;
    try {
      const result = await removeProduct(product.id);
      toast(
        result === 'oculto' ? 'Tenía ventas: quedó oculto para conservar el historial' : 'Producto eliminado',
      );
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo quitar.');
    }
  }

  return (
    <Modal title={product ? `Editar · ${product.name}` : 'Nuevo producto'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-2">
          <div className="field span-2">
            <label htmlFor="pf-name">Nombre</label>
            <input className="input" id="pf-name" value={form.name} onChange={set('name')} maxLength={60} />
          </div>
          <div className="field">
            <label htmlFor="pf-cat">Categoría</label>
            <select className="select" id="pf-cat" value={form.category_id} onChange={set('category_id')}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-badge">Etiqueta</label>
            <input
              className="input"
              id="pf-badge"
              value={form.badge}
              onChange={set('badge')}
              maxLength={30}
              placeholder="La más pedida"
            />
          </div>
          <div className="field span-2">
            <label htmlFor="pf-desc">Descripción</label>
            <textarea
              className="textarea"
              id="pf-desc"
              value={form.description}
              onChange={set('description')}
              maxLength={300}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-price">Precio sola</label>
            <input
              className="input"
              id="pf-price"
              inputMode="numeric"
              value={form.price}
              onChange={set('price')}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-combo">Precio combo (vacío = sin combo)</label>
            <input
              className="input"
              id="pf-combo"
              inputMode="numeric"
              value={form.combo}
              onChange={set('combo')}
            />
          </div>
          <div className="field span-2">
            <label htmlFor="pf-photo">Foto</label>
            <div className="photo-row">
              {image ? (
                <img className="thumb thumb-lg" src={photoUrl(image) ?? ''} alt="Foto actual" />
              ) : (
                <span className="thumb thumb-lg" />
              )}
              <input
                id="pf-photo"
                type="file"
                accept="image/*"
                onChange={(event) => void onPhoto(event.target.files?.[0])}
              />
            </div>
            <span className="hint">
              Se reduce a 1200 px y se guarda liviana (WebP o JPG) sin metadatos de ubicación ni cámara.
            </span>
          </div>
          <label className="check span-2">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(event) => setForm({ ...form, visible: event.target.checked })}
            />{' '}
            Visible en la página
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          {product ? (
            <button className="btn btn-soft" type="button" onClick={() => void remove()}>
              Quitar de la carta
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
