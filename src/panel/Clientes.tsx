// Clientes (D41): búsqueda, historial resumido y etiquetas. Solo administración (la base lo exige).
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCop as money } from '../core/money';
import { loadCustomers, updateCustomer, type CustomerRow } from './customers-data';
import { Modal, useToast } from './ui';

const dateFmt = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' });

export function Clientes() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const seq = useRef(0);

  const fetchPage = useCallback(async (term: string, offset: number) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await loadCustomers(term, offset);
      if (mine !== seq.current) return;
      setFailed(false);
      setTotal(page.total);
      setRows((current) => (offset === 0 ? page.rows : [...current, ...page.rows]));
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void fetchPage(search, 0), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, fetchPage]);

  async function patch(
    row: CustomerRow,
    change: Partial<Pick<CustomerRow, 'trusted' | 'blocked' | 'notes'>>,
  ) {
    try {
      await updateCustomer(row.id, change);
      setRows((list) => list.map((item) => (item.id === row.id ? { ...item, ...change } : item)));
      setEditing((current) => (current?.id === row.id ? { ...current, ...change } : current));
      return true;
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      return false;
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Clientes</h2>
        <span className="muted">{total} en total</span>
      </div>
      <div className="field">
        <label htmlFor="cli-buscar">Buscar por nombre o celular</label>
        <input
          id="cli-buscar"
          className="input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ej. Laura o 3001234567"
          autoComplete="off"
        />
      </div>
      {failed ? <p className="note">No se pudieron cargar los clientes. Intenta de nuevo.</p> : null}
      <ul className="cli-list">
        {rows.map((row) => (
          <li
            className={`cli-row ${row.blocked ? 'is-blocked' : ''}`}
            key={row.id}
            data-testid={`cliente-${row.phone}`}
          >
            <div className="cli-who">
              <b>{row.name}</b>
              <span className="muted">{row.phone}</span>
              <div className="cli-tags">
                {row.trusted ? <span className="tag tag-ok">Confiable</span> : null}
                {row.blocked ? <span className="tag tag-bad">Bloqueado</span> : null}
              </div>
              {row.notes ? <small className="muted cli-notes">{row.notes}</small> : null}
            </div>
            <dl className="cli-stats">
              <div>
                <dt>Pedidos</dt>
                <dd>{row.orders}</dd>
              </div>
              <div>
                <dt>Gastado</dt>
                <dd>{money(row.spent)}</dd>
              </div>
              <div>
                <dt>Último pedido</dt>
                <dd>{row.last_order ? dateFmt.format(new Date(row.last_order)) : 'Sin pedidos'}</dd>
              </div>
            </dl>
            <div className="cli-actions">
              <button
                className={`btn btn-sm ${row.blocked ? 'btn-soft' : 'btn-danger'}`}
                type="button"
                onClick={() => void patch(row, { blocked: !row.blocked })}
              >
                {row.blocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button className="btn btn-soft btn-sm" type="button" onClick={() => setEditing(row)}>
                Notas
              </button>
            </div>
          </li>
        ))}
      </ul>
      {loading ? <p className="muted">Cargando…</p> : null}
      {!loading && !failed && rows.length === 0 ? (
        <p className="muted">{search ? 'Nadie coincide con esa búsqueda.' : 'Aún no hay clientes.'}</p>
      ) : null}
      {!loading && rows.length < total ? (
        <button
          className="btn btn-soft btn-block"
          type="button"
          onClick={() => void fetchPage(search, rows.length)}
        >
          Ver más ({total - rows.length} restantes)
        </button>
      ) : null}
      {editing ? <NotesModal row={editing} onClose={() => setEditing(null)} onSave={patch} /> : null}
    </section>
  );
}

function NotesModal({
  row,
  onClose,
  onSave,
}: {
  row: CustomerRow;
  onClose: () => void;
  onSave: (row: CustomerRow, change: Partial<Pick<CustomerRow, 'trusted' | 'notes'>>) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState(row.notes ?? '');
  const [trusted, setTrusted] = useState(row.trusted);
  const [saving, setSaving] = useState(false);
  return (
    <Modal title={row.name} onClose={onClose}>
      <div className="field">
        <label htmlFor="cli-notas">Notas internas</label>
        <textarea
          id="cli-notas"
          className="input"
          rows={4}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Ej. Pide sin cebolla. Entregar en portería."
        />
      </div>
      <label className="chip-check">
        <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
        Cliente confiable
      </label>
      <div className="btn-row">
        <button
          className="btn btn-primary"
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            const ok = await onSave(row, { notes: notes.trim() || null, trusted });
            setSaving(false);
            if (ok) onClose();
          }}
        >
          Guardar
        </button>
        <button className="btn btn-soft" type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
