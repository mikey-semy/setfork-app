import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Юнит-тесты чистой логики в node; компонентные (.test.tsx) — в jsdom через докблок
// `// @vitest-environment jsdom` в самом файле. globals:true → авто-cleanup Testing
// Library + jest-dom матчеры (setup ниже). Алиасы: '@'→src; server/client-only →
// пустышка (чтобы тестировать модули, которые их транзитивно тянут).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/gen/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)),
    },
  },
})
