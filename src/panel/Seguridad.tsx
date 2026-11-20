// Seguridad (D43, D65): pedidos frenados (con acciones si hay cliente ligado), registro de auditoría y código de dos pasos del equipo. Solo administración.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCop as money } from '../core/money';
import {
  BLOCK_REASONS,
  auditDetailText,
  blockedActions,
  maskPhone,
  nextAuditCursor,
  reasonLabel,
} from '../core/security';
import { updateCustomer } from './customers-data';
import { AUDIT_PAGE, loadAudit, loadBlocked, type AuditRow, type BlockedAttempt } from './security-data';
import { loadTeam, type Member } from './team-data';
import { useToast } from './ui';

const dateTime = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function Seguridad() {
  return (
    <>
      <Frenados />
      <DosPasos />
      <Auditoria />
    </>
  );
}

function Frenados() {
  const toast = useToast();
  const [rows, setRows] = useState<BlockedAttempt[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    loadBlocked()
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);
  const shown = useMemo(() => (rows ?? []).filter((row) => !reason || row.reason === reason), [rows, reason]);

  async function unblock(row: BlockedAttempt) {
    const id = row.customer_id;
    if (!id || !row.customer || busy) return;
    const who = row.customer.name;
    if (!confirm(`¿Desbloquear a ${who}? Podrá volver a hacer pedidos de inmediato.`)) return;
    setBusy(id);
    try {
      await updateCustomer(id, { blocked: false });
      // El mismo cliente puede tener varios frenados: todos quedan desbloqueados.
      setRows((list) =>
        (list ?? []).map((item) =>
          item.customer_id === id && item.customer
            ? { ...item, customer: { ...item.customer, blocked: false } }
            : item,
        ),
      );
      toast(`${who} quedó desbloqueado.`);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo desbloquear.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card" aria-labelledby="seg-frenados">
      <div className="card-head">
        <h2 id="seg-frenados">Pedidos frenados · últimos 30 días</h2>
        <span className="muted">{rows ? rows.length : '…'}</span>
      </div>
      <div className="field">
        <label htmlFor="seg-motivo">Motivo</label>
        <select
          id="seg-motivo"
          className="select"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="">Todos</option>
          {Object.entries(BLOCK_REASONS).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {failed ? <p className="note">No se pudieron cargar los pedidos frenados.</p> : null}
      {!rows && !failed ? <p className="muted">Cargando…</p> : null}
      {rows && shown.length === 0 ? <p className="muted">Sin pedidos frenados.</p> : null}
      {shown.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Motivo</th>
                <th>Nombre</th>
                <th>Celular</th>
                <th>Zona</th>
                <th>Total intentado</th>
                <th>Productos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>{dateTime.format(new Date(row.at))}</td>
                  <td>{reasonLabel(row.reason)}</td>
                  <td>{row.customer_name ?? '—'}</td>
                  <td>{maskPhone(row.phone_last4)}</td>
                  <td>{row.zone_name ?? '—'}</td>
                  <td>{typeof row.total_attempt === 'number' ? money(row.total_attempt) : '—'}</td>
                  <td>{row.items_count ?? '—'}</td>
                  <td>
                    <FrenadoActions
                      row={row}
                      busy={busy === row.customer_id}
                      onUnblock={() => void unblock(row)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function FrenadoActions({
  row,
  busy,
  onUnblock,
}: {
  row: BlockedAttempt;
  busy: boolean;
  onUnblock: () => void;
}) {
  const actions = blockedActions(row, row.customer_name);
  if (!actions || (!actions.unblock && !actions.whatsapp)) return <span className="muted">—</span>;
  return (
    <div className="seg-actions">
      {actions.unblock ? (
        <button className="btn btn-soft btn-sm" type="button" disabled={busy} onClick={onUnblock}>
          Desbloquear
        </button>
      ) : null}
      {actions.whatsapp ? (
        <a className="btn btn-soft btn-sm" href={actions.whatsapp} target="_blank" rel="noopener noreferrer">
          Escribir por WhatsApp
        </a>
      ) : null}
    </div>
  );
}

function DosPasos() {
  const [team, setTeam] = useState<Member[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadTeam()
      .then(setTeam)
      .catch(() => setFailed(true));
  }, []);
  return (
    <section className="card" aria-labelledby="seg-2pasos">
      <div className="card-head">
        <h2 id="seg-2pasos">Código de dos pasos</h2>
      </div>
      {failed ? <p className="note">No se pudo cargar el equipo.</p> : null}
      {!team && !failed ? <p className="muted">Cargando…</p> : null}
      <ul className="seg-team">
        {(team ?? []).map((member) => (
          <li key={member.user_id}>
            <span>
              <b>{member.full_name}</b> <span className="muted">{member.email}</span>
            </span>
            <span className={`tag ${member.has_totp ? 'tag-ok' : 'tag-warn'}`}>
              {member.has_totp ? 'Activo' : 'Pendiente'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Auditoria() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchMore = useCallback(async (before: string | null) => {
    setLoading(true);
    try {
      const page = await loadAudit(before);
      setFailed(false);
      setRows((current) => (before ? [...current, ...page] : page));
      setCursor(nextAuditCursor(page, AUDIT_PAGE));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void fetchMore(null), 0);
    return () => clearTimeout(timer);
  }, [fetchMore]);

  return (
    <section className="card" aria-labelledby="seg-audit">
      <div className="card-head">
        <h2 id="seg-audit">Registro de auditoría</h2>
      </div>
      {failed ? <p className="note">No se pudo cargar el registro.</p> : null}
      {!loading && !failed && rows.length === 0 ? <p className="muted">Aún no hay movimientos.</p> : null}
      <ul className="seg-audit">
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <b>{row.action}</b>
              {row.entity ? <span className="muted"> · {row.entity}</span> : null}
            </div>
            <small className="muted">
              {dateTime.format(new Date(row.at))} · {row.actor}
            </small>
            {auditDetailText(row.detail) ? (
              <small className="seg-detail">{auditDetailText(row.detail)}</small>
            ) : null}
          </li>
        ))}
      </ul>
      {loading ? <p className="muted">Cargando…</p> : null}
      {!loading && cursor ? (
        <button className="btn btn-soft btn-block" type="button" onClick={() => void fetchMore(cursor)}>
          Ver más
        </button>
      ) : null}
    </section>
  );
}
