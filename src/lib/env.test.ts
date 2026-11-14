import { describe, expect, it } from 'vitest';
import { readPublicEnv } from './env';

const valid = { PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57321', PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40) };

describe('variables públicas', () => {
  it('acepta la configuración local', () =>
    expect(readPublicEnv(valid).PUBLIC_SUPABASE_URL).toBe(valid.PUBLIC_SUPABASE_URL));
  it('falla sin la clave pública', () =>
    expect(() => readPublicEnv({ ...valid, PUBLIC_SUPABASE_ANON_KEY: '' })).toThrow());
});
