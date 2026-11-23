import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/setup.ts', './tests/setup/temporal.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'modules/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['core/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}'],
      exclude: [
        'modules/*/index.ts',
        'modules/*/ui/*.module.css',
        'core/ui/*.module.css',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
      ],
    },
  },
});