import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'generated/**', 'scripts/templates/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Product modules must route all privileged capabilities through Core.
    files: ['modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Module code must use the Network Broker via ModuleContext.' },
        { name: 'XMLHttpRequest', message: 'Module code must use the Network Broker via ModuleContext.' },
        { name: 'WebSocket', message: 'Module code must use the Network Broker via ModuleContext.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='chrome'][property.name='permissions']",
          message: 'Module code must use the Permission Service via ModuleContext.',
        },
        {
          selector: "MemberExpression[object.name='browser'][property.name='permissions']",
          message: 'Module code must use the Permission Service via ModuleContext.',
        },
        // Bare-identifier bans alone let window.fetch / globalThis.fetch /
        // self.XMLHttpRequest slip through; pin the receiver forms too.
        {
          selector: "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='fetch']",
          message: 'Module code must use the Network Broker via ModuleContext.',
        },
        {
          selector: "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='XMLHttpRequest']",
          message: 'Module code must use the Network Broker via ModuleContext.',
        },
        {
          selector: "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='WebSocket']",
          message: 'Module code must use the Network Broker via ModuleContext.',
        },
        { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden.' },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function is forbidden.',
        },
      ],
    },
  },
  {
    // Never import the Temporal polyfill into production code paths.
    files: ['modules/**/*.ts', 'core/**/*.ts', 'entrypoints/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@js-temporal/polyfill'], message: 'Production code must use native globalThis.Temporal.' }] },
      ],
    },
  },
);