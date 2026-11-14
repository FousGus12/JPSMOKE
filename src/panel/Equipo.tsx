// Equipo (D38): el admin crea cuentas, cambia rol, delega apartados, activa/desactiva y da claves
// temporales. La base valida todo; aquí solo se muestra lo que la base devuelve.
import { useCallback, useEffect, useState } from 'react';
import {
  AREAS,
  changeMyPassword,
  createMember,
  loadTeam,
  resetPassword,
  updateMember,
  type Area,
  type Member,
  type Role,
} from './team-data';
import { Modal, useToast } from './ui';

const AREA_LABEL = Object.fromEntries(AREAS) as Record<Area, string>;

function when(iso: string | null): string {
  if (!iso) return 'Nunca ha entrado';
  return `Último ingreso ${new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))}`;
}

function AreaPicker({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: Area[];
  onChange: (next: Area[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="chips" role="group" aria-label="Apartados">
      {AREAS.map(([key, label]) => (
        <label className="chip-check" key={key}>
          <input
            type="checkbox"
            id={`${idPrefix}-${key}`}
            disabled={disabled}
            checked={value.includes(key)}
            onChange={(event) =>
              onChange(event.target.checked ? [...value, key] : value.filter((area) => area !== key))
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function OneTimePassword({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <Modal title="Contraseña temporal" onClose={onClose}>
      <p className="note">
        Entrégasela a <b>{email}</b> en persona o por un canal privado. <b>No se vuelve a mostrar.</b> La
        persona debe cambiarla en "Mi cuenta" al entrar.
      </p>
      <p className="temp-pass" data-testid="temp-pass">
        {password}
      </p>
      <div className="team-actions">
        <button
          className="btn btn-soft"
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(password)
              .then(() => toast('Copiada'))
              .catch(() => toast('Cópiala a mano'))
          }
        >
          Copiar
        </button>
        <button className="btn btn-primary" type="button" onClick={onClose}>
          Listo
        </button>
      </div>
    </Modal>
  );
}

function NewMember({ onCreated }: { onCreated: (email: string, password: string) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('operador');
  const [areas, setAreas] = useState<Area[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await createMember({
      email: email.trim(),
      full_name: name.trim(),
      role,
      permissions: role === 'admin' ? [] : areas,
    });
    setBusy(false);
    if (!result.ok) return toast(result.message);
    onCreated(email.trim().toLowerCase(), result.password);
    setEmail('');
    setName('');
    setRole('operador');
    setAreas([]);
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Agregar persona</h2>
          <p>Se crea con una contraseña temporal que verás una sola vez</p>
        </div>
      </div>
      <form
        className="team-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Nombre</span>
          <input
            className="input"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Correo</span>
          <input
            className="input"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <div className="field">
          <span>Rol</span>
          <div className="modes" role="radiogroup" aria-label="Rol">
            <label className="mode">
              <input
                type="radio"
                name="new-role"
                checked={role === 'operador'}
                onChange={() => setRole('operador')}
              />
              <b>Operador</b>
              <small>Resumen y Pedidos, más los apartados que le des</small>
            </label>
            <label className="mode">
              <input
                type="radio"
                name="new-role"
                checked={role === 'admin'}
                onChange={() => setRole('admin')}
              />
              <b>Administrador</b>
              <small>Todo el panel, incluido Equipo. Exige código de dos pasos</small>
            </label>
          </div>
        </div>
        {role === 'operador' ? (
          <div className="field">
            <span>Apartados extra</span>
            <AreaPicker value={areas} onChange={setAreas} idPrefix="new" />
            {areas.length ? (
              <small className="muted">
                Con apartados extra, la persona también activa el código de dos pasos.
              </small>
            ) : null}
          </div>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
    </section>
  );
}

function MemberRow({
  member,
  onChanged,
  onPassword,
}: {
  member: Member;
  onChanged: () => void;
  onPassword: (email: string, password: string) => void;
}) {
  const toast = useToast();
  const [areas, setAreas] = useState<Area[]>(member.permissions);
  const dirty = areas.slice().sort().join() !== member.permissions.slice().sort().join();
  const locked = member.is_me;

  async function save(patch: Parameters<typeof updateMember>[1], done: string) {
    try {
      await updateMember(member.user_id, patch);
      toast(done);
      onChanged();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'No se pudo guardar.');
      setAreas(member.permissions);
    }
  }

  return (
    <div className={`team-row ${member.active ? '' : 'is-off'}`} data-testid={`miembro-${member.email}`}>
      <div className="team-who">
        <b>
          {member.full_name}
          {member.is_me ? <span className="tag">Tú</span> : null}
          {!member.active ? <span className="tag">Desactivada</span> : null}
        </b>
        <small>{member.email}</small>
        <small>
          {when(member.last_sign_in_at)} ·{' '}
          {member.has_totp ? 'Código de dos pasos activo' : 'Sin código de dos pasos'}
        </small>
      </div>
      <div className="team-controls">
        <label className="field">
          <span>Rol</span>
          <select
            className="select"
            value={member.role}
            disabled={locked}
            onChange={(event) =>
              void save(
                { role: event.target.value as Role },
                event.target.value === 'admin' ? 'Ahora es administrador' : 'Ahora es operador',
              )
            }
          >
            <option value="operador">Operador</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        {member.role === 'operador' ? (
          <div className="field">
            <span>Apartados extra (además de Resumen y Pedidos)</span>
            <AreaPicker value={areas} onChange={setAreas} disabled={locked} idPrefix={member.user_id} />
            {dirty ? (
              <div className="team-actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => void save({ permissions: areas }, 'Apartados guardados')}
                >
                  Guardar apartados
                </button>
                <button
                  className="btn btn-soft btn-sm"
                  type="button"
                  onClick={() => setAreas(member.permissions)}
                >
                  Deshacer
                </button>
              </div>
            ) : (
              <small className="muted">
                {member.permissions.length
                  ? member.permissions.map((area) => AREA_LABEL[area]).join(' · ')
                  : 'Solo Resumen y Pedidos'}
              </small>
            )}
          </div>
        ) : (
          <small className="muted">Acceso completo, incluido Equipo</small>
        )}
        {locked ? (
          <small className="muted">Tu propio acceso lo cambia otro administrador.</small>
        ) : (
          <div className="team-actions">
            <button
              className="btn btn-soft btn-sm"
              type="button"
              onClick={() =>
                void save(
                  { active: !member.active },
                  member.active ? 'Cuenta desactivada: ya no puede entrar' : 'Cuenta activada',
                )
              }
            >
              {member.active ? 'Desactivar' : 'Activar'}
            </button>
            <button
              className="btn btn-soft btn-sm"
              type="button"
              onClick={() =>
                void resetPassword(member.user_id).then((result) =>
                  result.ok ? onPassword(member.email, result.password) : toast(result.message),
                )
              }
            >
              Nueva contraseña temporal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Equipo() {
  const toast = useToast();
  const [team, setTeam] = useState<Member[] | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);

  const reload = useCallback(() => {
    loadTeam()
      .then(setTeam)
      .catch((failure: unknown) => toast(failure instanceof Error ? failure.message : 'No se pudo cargar.'));
  }, [toast]);
  useEffect(reload, [reload]);

  const showPassword = (email: string, password: string) => {
    setShown({ email, password });
    reload();
  };

  return (
    <>
      <NewMember onCreated={showPassword} />
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Personas</h2>
            <p>
              Desactivar corta el acceso de inmediato. El restaurante siempre conserva al menos un
              administrador.
            </p>
          </div>
        </div>
        {team === null ? <p className="muted">Cargando…</p> : null}
        <div className="team-list">
          {(team ?? []).map((member) => (
            <MemberRow
              key={`${member.user_id}-${member.permissions.join()}-${member.role}-${member.active}`}
              member={member}
              onChanged={reload}
              onPassword={showPassword}
            />
          ))}
        </div>
      </section>
      {shown ? <OneTimePassword {...shown} onClose={() => setShown(null)} /> : null}
    </>
  );
}

/** "Mi cuenta": cambiar la propia contraseña (todas las personas). */
export function MiCuenta({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Mi cuenta" onClose={onClose}>
      <form
        className="team-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (password !== again) return toast('Las dos contraseñas no coinciden.');
          setBusy(true);
          void changeMyPassword(password)
            .then(() => {
              toast('Contraseña cambiada');
              onClose();
            })
            .catch((failure: unknown) =>
              toast(failure instanceof Error ? failure.message : 'No se pudo cambiar.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Nueva contraseña (mínimo 12 caracteres)</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Repítela</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={again}
            onChange={(event) => setAgain(event.target.value)}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </Modal>
  );
}
