import next from 'eslint-config-next'

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
]
