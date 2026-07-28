import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Все тесты живут в корневом tests/ (зеркалит src/), не рядом с кодом — единая
// конвенция с другими проектами. server/client-only → пустышка (чтобы тестировать
// модули, транзитивно их тянущие). Интеграция с БД — vitest.integration.config.
//
// ДВА ПРОЕКТА вместо глобального jsdom. Раньше jsdom поднимался для КАЖДОГО файла,
// включая 90 тестов чистой логики, которым DOM не нужен вовсе: на прогоне это
// сотни секунд в графе `environment`. Теперь .tsx (компонентные, их 6) идут в jsdom,
// .ts — в node. Тесту на .ts, которому вдруг понадобился DOM, достаточно докблока
// `// @vitest-environment jsdom` в шапке файла.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['tests/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['tests/**/*.test.tsx'] },
      },
    ],
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
