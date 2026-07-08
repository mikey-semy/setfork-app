import next from 'eslint-config-next'
import boundaries from 'eslint-plugin-boundaries'

// Flat-config для ESLint 9 / Next 16 (eslint-config-next — готовый flat-массив).
// Экспериментальные react-compiler-правила Next 16 приглушены до warn: они агрессивно
// флагают валидные паттерны (guard-эффекты, запись cookie); чистка под них — отдельная задача.
export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/features/git/gen/**', 'drizzle/**', 'public/**'] },
  ...next,
  {
    rules: {
      // preview react-compiler набор (Next 16) — агрессивен на валидных паттернах; держим как warn.
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      // Барьер видимости: сырые getListMeta/getTemplateDetail отдают данные БЕЗ canViewList.
      // Забытый гейт = утечка приватного/черновика/снятого модерацией (так родились дыры
      // blame/versions/insights/suggest). Чтение списка идёт ТОЛЬКО через чокпоинт guard.ts.
      // guard.ts импортит из relative './queries' и правилом не задевается (это его законный дом).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/features/library/queries',
              importNames: ['getListMeta', 'getTemplateDetail'],
              message:
                'Сырой загрузчик не гейтит видимость. Используй requireViewableMeta/requireViewableDetail из @/features/library/guard. Иная модель доступа (анонимный isPubliclyVisible, owner-only, git/MCP-скоуп) — оставь // eslint-disable-next-line no-restricted-imports с причиной.',
            },
          ],
        },
      ],
    },
  },
  // ── Архитектурные границы слоёв (аудит 2026-07-08) ─────────────────────────
  // Направление зависимостей: app → widgets → features → { core, shared }.
  // Фичи не видят друг друга; core не видит никого; shared не видит фичи.
  // Существующие нарушения заморожены в eslint-suppressions.json (baseline):
  // НОВЫЕ кросс-импорты — ошибка сразу; починил старое — запусти
  // `npx eslint . --prune-suppressions`, чтобы усушить baseline.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core' },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'features', pattern: 'src/features/*', capture: ['feature'] },
        { type: 'widgets', pattern: 'src/widgets' },
        { type: 'app', pattern: 'src/app' },
      ],
      'import/resolver': { typescript: {} },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Слой «{{ from.type }}» не должен импортировать «{{ to.type }}» (границы: app → widgets → features → core/shared)',
          policies: [
            // Внутри своего элемента (та же фича, свой слой) — можно всегда.
            { allow: { dependency: { relationship: { to: 'internal' } } } },
            { from: { type: 'shared' }, allow: { to: [{ type: 'core' }] } },
            // Фича видит только себя (internal выше) + core/shared — кросс-импорт фич запрещён.
            { from: { type: 'features' }, allow: { to: [{ type: 'shared' }, { type: 'core' }] } },
            { from: { type: 'widgets' }, allow: { to: [{ type: 'features' }, { type: 'shared' }, { type: 'core' }] } },
            {
              from: { type: 'app' },
              allow: { to: [{ type: 'widgets' }, { type: 'features' }, { type: 'shared' }, { type: 'core' }] },
            },
          ],
        },
      ],
    },
  },
]
