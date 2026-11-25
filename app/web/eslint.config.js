// @ts-check
/**
 * ESLint-configuratie van de frontend (flat config): de aanbevolen regels van ESLint, TypeScript en Vue, plus dezelfde
 * leesbaarheidsregels als de server (`app/eslint.config.js`, maatstaf in `docs/WERKWIJZE.md`, *Leesbare code*).
 *
 * `v-html` is verboden (`vue/no-v-html`): sjablonen van Vue escapen alles, net als `html\`…\`` op de server. De enige
 * toegestane uitzondering wordt later één component voor inhoud die al door de opschoning van de server is gegaan,
 * met `eslint-disable-next-line` en de reden erboven.
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: ['**/*.{ts,vue,js}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // Sjablonen escapen zelf; HTML invoegen buiten de opschoning om opent de deur voor XSS.
      'vue/no-v-html': 'error',
      // Ook geen HTML via een directe DOM-eigenschap (`el.innerHTML = …`) of `document.write`.
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Gebruik het sjabloon van Vue; HTML alleen via de opgeschoonde component.' },
        { property: 'outerHTML', message: 'Gebruik het sjabloon van Vue.' },
        { object: 'document', property: 'write', message: 'Niet gebruiken.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Ongebruikte variabelen zijn bijna altijd een vergeten restje; een naam die met `_` begint mag blijven.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      // Leesbaarheid, gelijk aan de server.
      'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'x', 'y', '_'], properties: 'never' }],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
      'max-nested-callbacks': ['error', 4],
      complexity: ['error', 20],
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Configuratie en tests draaien in Node.
    files: ['vite.config.ts', 'eslint.config.js', 'src/**/*.spec.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'max-nested-callbacks': ['error', 5], 'vue/one-component-per-file': 'off' },
  },
);
