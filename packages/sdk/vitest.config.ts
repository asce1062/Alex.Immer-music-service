import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 20,
        functions: 65,
        branches: 70,
        statements: 20,
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
