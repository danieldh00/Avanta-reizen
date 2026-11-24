/**
 * ESLint-configuratie van de app (flat config).
 *
 * Basis: de aanbevolen regels van ESLint plus de beveiligingsregels van eslint-plugin-security. De regels die bij deze
 * code vooral vals alarm geven staan uit, met de reden erbij. Draait in CI in de job `test` (`npm run lint`) en lokaal
 * met `npm run lint`.
 */
'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**/*.min.js', 'coverage/**'],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Ongebruikte variabelen zijn bijna altijd een vergeten restje; een parameter of foutvariabele die met `_`
      // begint mag bewust ongebruikt blijven.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Altijd === en !==; `== null` (null én undefined) is de enige toegestane uitzondering.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      // Vals alarm bij deze code: elke `obj[sleutel]` zou een melding geven, ook bij sleutels uit vaste lijsten.
      'security/detect-object-injection': 'off',
      // Bestandsnamen komen uit eigen code (DATA_DIR, vaste mappen); de echte controle zit in de functies zelf.
      'security/detect-non-literal-fs-filename': 'off',
      // Reguliere expressies uit variabelen zijn hier alleen eigen vaste patronen.
      'security/detect-non-literal-regexp': 'off',
      // De heuristiek van safe-regex keurt ook verankerde patronen met begrensde herhaling af; alle patronen hier zijn
      // nagelopen (24-11-2026) en de invoer is vooraf in lengte begrensd.
      'security/detect-unsafe-regex': 'off',
    },
  },
  {
    // Hulpmiddelen met Playwright: Node-code met stukken die in de browser draaien (page.evaluate).
    files: ['tools/design-check/check.js', 'tools/design-check/overview.js', 'tools/layout-compare.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Browsercode: de publieke scripts en de metingen die Playwright in de pagina uitvoert.
    files: ['public/js/**/*.js', 'tools/design-check/page-checks.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // De opschoner van de teksteditor draait in de browser én in de tests (Node, via `module.exports`).
    files: ['public/js/rich-text-clean.js'],
    languageOptions: {
      globals: { ...globals.browser, module: 'readonly' },
    },
  },
  {
    // analytics.js is bewust in ES5-stijl geschreven (var), zodat het ook in oude browsers niets breekt.
    files: ['public/js/analytics.js'],
    rules: { 'no-var': 'off' },
  },
];
