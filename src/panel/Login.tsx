import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { enrollTotp, signIn, signOut, verifyTotp } from './auth';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Algo salió mal. Inténtalo de nuevo.';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="login">
      <div className="login-card">
        <p className="eyebrow">Panel del negocio</p>
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

function ErrorText({ text }: { text: string }) {
  return text ? (
    <p className="form-error" role="alert">
      {text}
    </p>
  ) : null;
}

export function Credentials({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return setError('Escribe tu correo y tu contraseña.');
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
      onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Entrar">
      <p className="muted">Acceso solo para el equipo. Las cuentas las crea el administrador.</p>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="l-mail">Correo</label>
          <input
            className="input"
            id="l-mail"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="l-pass">Contraseña</label>
          <input
            className="input"
            id="l-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <ErrorText text={error} />
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="hint center">La sesión se cierra tras 30 minutos sin actividad.</p>
    </Frame>
  );
}

function CodeForm({ factorId, onDone, label }: { factorId: string; onDone: () => void; label: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (code.replace(/\D/g, '').length !== 6) return setError('Escribe los 6 dígitos del código.');
    setBusy(true);
    setError('');
    try {
      await verifyTotp(factorId, code);
      onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="l-totp">Código de 6 dígitos</label>
        <input
          className="input totp"
          id="l-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000000"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      <ErrorText text={error} />
      <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
        {busy ? 'Verificando…' : label}
      </button>
    </form>
  );
}

function Exit() {
  return (
    <button className="btn btn-soft btn-sm" type="button" onClick={() => void signOut()}>
      Salir
    </button>
  );
}

export function Enroll({ onDone }: { onDone: () => void }) {
  const [data, setData] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(null);
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enrollTotp()
      .then(setData)
      .catch((failure) => setError(message(failure)));
  }, []);
  return (
    <Frame title="Activa tu código de seguridad">
      <p className="muted">
        Como administrador necesitas un segundo paso. Escanea el código QR con tu app de autenticación (Google
        Authenticator, Microsoft Authenticator, 1Password) y escribe el número que muestra.
      </p>
      <ErrorText text={error} />
      {data ? (
        <>
          <img
            className="qr"
            src={data.qrSvg}
            alt="Código QR para tu app de autenticación"
            width={192}
            height={192}
          />
          <p className="hint">
            ¿No puedes escanear? Escribe esta clave en la app:{' '}
            <code data-testid="totp-secret">{data.secret}</code>
          </p>
          <CodeForm factorId={data.factorId} onDone={onDone} label="Activar y entrar" />
        </>
      ) : error ? null : (
        <p className="muted" role="status">
          Preparando el código…
        </p>
      )}
      <Exit />
    </Frame>
  );
}

export function Verify({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  return (
    <Frame title="Código de seguridad">
      <p className="muted">Abre tu app de autenticación y escribe el código de 6 dígitos del panel.</p>
      <CodeForm factorId={factorId} onDone={onDone} label="Verificar y entrar" />
      <Exit />
    </Frame>
  );
}
