import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Все тесты живут в корневом tests/ (зеркалит src/), не рядом с кодом — единая
// конвенция с другими проектами. jsdom глобально (компонентные тесты работают без
// докблока; node-логика в jsdom тоже ок). server/client-only → пустышка (чтобы
// тестировать модули, транзитивно их тянущие). Интеграция с БД — vitest.integration.config.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/shared/gen/**', 'src/**/*.stories.tsx'],
      reporter: ['text-summary', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./tests/empty.ts', import.meta.url)),
    },
  },
})
