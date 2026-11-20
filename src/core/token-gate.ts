// Compuerta del token de Cloudflare Turnstile (D50 / v0.18): el widget entrega el token por callback y el
// envío lo espera con un tope. El token es de un solo uso: `wait` lo consume para que un reintento no
// mande uno ya gastado.

export interface TokenGate {
  /** Llega un token nuevo (callback del widget): despierta a quien espera. */
  set(token: string): void;
  /** El token venció, falló o se reinició el widget. */
  clear(): void;
  /** Hay token listo sin esperar. */
  ready(): boolean;
  /** Espera el token hasta `ms`; lo consume. `null` si no llegó a tiempo. */
  wait(ms: number): Promise<string | null>;
}

export function createTokenGate(): TokenGate {
  let token = '';
  let waiters: Array<(value: string) => void> = [];
  const take = () => {
    const value = token;
    token = '';
    return value;
  };
  return {
    set(value) {
      token = value;
      if (!value || !waiters.length) return;
      const first = waiters[0];
      waiters = waiters.slice(1);
      first?.(take());
    },
    clear() {
      token = '';
    },
    ready() {
      return Boolean(token);
    },
    wait(ms) {
      if (token) return Promise.resolve(take());
      return new Promise((resolve) => {
        const done = (value: string) => {
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          waiters = waiters.filter((fn) => fn !== done);
          resolve(null);
        }, ms);
        waiters.push(done);
      });
    },
  };
}
