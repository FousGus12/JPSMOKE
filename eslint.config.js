import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: ['dist', '.astro', 'node_modules', 'mockup', 'supabase/functions', 'src/lib/database.types.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...astro.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-implicit-coercion': 'error',
      'no-sequences': 'error',
      'id-length': ['error', { min: 2, exceptions: ['_', 'i', 'x', 'y'], properties: 'never' }],
    },
  },
  { files: ['**/*.{js,mjs}'], languageOptions: { globals: globals.node } },
);
